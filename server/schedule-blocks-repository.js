import { getDatabasePool } from "./database.js";
import { businessTimezone, materializeScheduleSlots } from "./schedule-slots-repository.js";

const activeAppointmentStatuses = ["pending", "confirmed", "scheduled"];

export class ScheduleBlockError extends Error {
  constructor(code, status = 409, conflicts = []) {
    super(code);
    this.name = "ScheduleBlockError";
    this.code = code;
    this.status = status;
    this.conflicts = conflicts;
  }
}

function mapBlock(row) {
  return {
    id: row.id,
    doctor: { id: row.doctor_id, name: row.doctor_name },
    slotId: row.availability_id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    startsAtLocal: row.starts_at_local,
    endsAtLocal: row.ends_at_local,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

async function audit(client, event, actorUserId, details) {
  await client.query(
    `INSERT INTO auth_audit_log (event, actor_user_id, subject_user_id, details)
     VALUES ($1, $2, $2, $3::jsonb);`,
    [event, actorUserId, JSON.stringify(details)],
  );
}

export async function listScheduleBlocks({ date, doctor }, pool = getDatabasePool()) {
  const parameters = [date, businessTimezone];
  let doctorFilter = "";
  if (doctor) {
    parameters.push(doctor);
    doctorFilter = "AND (blocks.doctor_id::text = $3 OR doctors.name = $3)";
  }
  const result = await pool.query(
    `SELECT blocks.*, doctors.name AS doctor_name,
       to_char(blocks.starts_at AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at_local,
       to_char(blocks.ends_at AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at_local
     FROM doctor_schedule_blocks blocks
     JOIN doctors ON doctors.id = blocks.doctor_id
     WHERE blocks.removed_at IS NULL
       AND blocks.starts_at >= ($1::date::timestamp AT TIME ZONE $2)
       AND blocks.starts_at < (($1::date + 1)::timestamp AT TIME ZONE $2)
       ${doctorFilter}
     ORDER BY blocks.starts_at, doctors.name;`,
    parameters,
  );
  return result.rows.map(mapBlock);
}

export async function createScheduleBlocks({ doctorId, date, times, slotIds, reason, actorUserId }, pool = getDatabasePool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    const doctorResult = await client.query(
      "SELECT id, name, active FROM doctors WHERE id = $1;",
      [doctorId],
    );
    const doctor = doctorResult.rows[0];
    if (!doctor) throw new ScheduleBlockError("doctor_not_found", 404);
    if (!doctor.active) throw new ScheduleBlockError("doctor_unavailable");

    await materializeScheduleSlots(client, { date, doctor: doctorId });
    const slotsResult = await client.query(
      `SELECT availability.id, availability.doctor_id, availability.starts_at,
              availability.ends_at, availability.status,
              to_char(availability.starts_at AT TIME ZONE $3, 'HH24:MI') AS local_time
       FROM doctor_availability
       AS availability
       WHERE availability.doctor_id = $1
         AND (availability.starts_at AT TIME ZONE $3)::date = $2::date
         AND (
           ($4::text[] IS NOT NULL AND to_char(availability.starts_at AT TIME ZONE $3, 'HH24:MI') = ANY($4::text[]))
           OR ($5::uuid[] IS NOT NULL AND availability.id = ANY($5::uuid[]))
         )
         AND EXISTS (
           SELECT 1 FROM doctor_weekly_schedules schedules
           WHERE schedules.doctor_id = availability.doctor_id
             AND schedules.active = TRUE
             AND schedules.weekday = EXTRACT(ISODOW FROM $2::date)
             AND (availability.starts_at AT TIME ZONE $3)::time >= schedules.starts_at
             AND (availability.ends_at AT TIME ZONE $3)::time <= schedules.ends_at
             AND MOD(EXTRACT(EPOCH FROM (
               (availability.starts_at AT TIME ZONE $3)::time - schedules.starts_at
             ))::integer, schedules.slot_duration_minutes * 60) = 0
         )
       ORDER BY availability.starts_at, availability.id
       FOR UPDATE;`,
      [doctorId, date, businessTimezone, times ?? null, slotIds ?? null],
    );
    const byId = new Map(slotsResult.rows.map((slot) => [slot.id, slot]));
    const byTime = new Map(slotsResult.rows.map((slot) => [slot.local_time, slot]));
    const requested = times ?? slotIds;
    const conflicts = [];
    for (const key of requested) {
      const slot = times ? byTime.get(key) : byId.get(key);
      if (!slot) {
        conflicts.push(times ? { time: key, reason: "outside_schedule" } : { slotId: key, reason: "slot_not_found" });
      } else if (slot.starts_at <= new Date()) {
        conflicts.push({ slotId: slot.id, time: slot.local_time, reason: "past_slot" });
      } else if (slot.status !== "available") {
        conflicts.push({ slotId: slot.id, time: slot.local_time, reason: "slot_unavailable" });
      }
    }

    const selectedSlots = requested.map((key) => times ? byTime.get(key) : byId.get(key)).filter(Boolean);
    const selectedSlotIds = selectedSlots.map((slot) => slot.id);
    if (conflicts.length === 0) {
      const occupied = await client.query(
        `SELECT slots.id AS slot_id,
                to_char(slots.starts_at AT TIME ZONE $3, 'HH24:MI') AS local_time
         FROM doctor_availability slots
         JOIN appointments ON appointments.doctor_id = slots.doctor_id
           AND appointments.starts_at < slots.ends_at
           AND appointments.ends_at > slots.starts_at
           AND appointments.status = ANY($2::varchar[])
         WHERE slots.id = ANY($1::uuid[]);`,
        [selectedSlotIds, activeAppointmentStatuses, businessTimezone],
      );
      conflicts.push(...occupied.rows.map((row) => ({ slotId: row.slot_id, time: row.local_time, reason: "appointment_exists" })));
      const blocked = await client.query(
        `SELECT availability_id AS slot_id,
                to_char(starts_at AT TIME ZONE $2, 'HH24:MI') AS local_time
         FROM doctor_schedule_blocks
         WHERE availability_id = ANY($1::uuid[]) AND removed_at IS NULL;`,
        [selectedSlotIds, businessTimezone],
      );
      conflicts.push(...blocked.rows.map((row) => ({ slotId: row.slot_id, time: row.local_time, reason: "already_blocked" })));
    }
    if (conflicts.length > 0) throw new ScheduleBlockError("slot_conflict", 409, conflicts);

    const created = [];
    for (const slot of selectedSlots) {
      const slotId = slot.id;
      const result = await client.query(
        `INSERT INTO doctor_schedule_blocks (
           doctor_id, availability_id, starts_at, ends_at, reason, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *;`,
        [doctorId, slotId, slot.starts_at, slot.ends_at, reason, actorUserId],
      );
      created.push(mapBlock({ ...result.rows[0], doctor_name: doctor.name,
        starts_at_local: null, ends_at_local: null }));
    }
    await client.query(
      "UPDATE doctor_availability SET status = 'blocked', updated_at = NOW() WHERE id = ANY($1::uuid[]);",
      [selectedSlotIds],
    );
    await audit(client, "schedule_block_created", actorUserId, {
      userId: actorUserId, doctorId, date, times: selectedSlots.map((slot) => slot.local_time),
      slotIds: selectedSlotIds, reason,
    });
    await client.query("COMMIT;");
    return created;
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    if (error?.code === "23505") throw new ScheduleBlockError("slot_conflict", 409);
    throw error;
  } finally {
    client.release();
  }
}

export async function removeScheduleBlocks({ blockIds, actorUserId }, pool = getDatabasePool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    const result = await client.query(
      `SELECT id, availability_id, doctor_id
       FROM doctor_schedule_blocks
       WHERE id = ANY($1::uuid[]) AND removed_at IS NULL
       ORDER BY availability_id
       FOR UPDATE;`,
      [blockIds],
    );
    if (result.rows.length !== blockIds.length) {
      throw new ScheduleBlockError("block_not_found", 404);
    }
    const slotIds = result.rows.map((row) => row.availability_id);
    await client.query(
      `SELECT id FROM doctor_availability
       WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE;`,
      [slotIds],
    );
    await client.query(
      `UPDATE doctor_schedule_blocks
       SET removed_at = NOW(), removed_by = $2
       WHERE id = ANY($1::uuid[]) AND removed_at IS NULL;`,
      [blockIds, actorUserId],
    );
    await client.query(
      "UPDATE doctor_availability SET status = 'available', updated_at = NOW() WHERE id = ANY($1::uuid[]);",
      [slotIds],
    );
    await audit(client, "schedule_block_removed", actorUserId, {
      userId: actorUserId, blockIds, slotIds,
    });
    await client.query("COMMIT;");
    return { removed: blockIds.length };
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
