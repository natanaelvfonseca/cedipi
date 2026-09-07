import { getDatabasePool } from "./database.js";
import { businessTimezone, materializeScheduleSlots } from "./schedule-slots-repository.js";

export { businessTimezone };

export async function listDoctors() {
  const result = await getDatabasePool().query(`
    SELECT id, name, active, appointment_duration_minutes
    FROM doctors
    ORDER BY name;
  `);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active,
    appointmentDurationMinutes: row.appointment_duration_minutes,
  }));
}

export async function listAvailability({ date, doctor }) {
  const pool = getDatabasePool();
  const client = await pool.connect();
  const parameters = [date, businessTimezone];
  let doctorFilter = "";
  if (doctor) {
    parameters.push(doctor);
    doctorFilter = "AND (doctors.id::text = $3 OR doctors.name = $3)";
  }

  try {
    await client.query("BEGIN;");
    await materializeScheduleSlots(client, { date, doctor });
    const result = await client.query(`
      SELECT
        doctor_availability.id,
        doctor_availability.starts_at,
        doctor_availability.ends_at,
        CASE
          WHEN doctor_availability.status <> 'available' THEN doctor_availability.status
          WHEN active_blocks.id IS NOT NULL THEN 'blocked'
          WHEN active_appointments.id IS NOT NULL THEN 'booked'
          ELSE 'available'
        END AS effective_status,
        doctor_availability.source,
        doctor_availability.notes,
        active_blocks.id AS block_id,
        active_blocks.reason AS block_reason,
        doctors.id AS doctor_id,
        doctors.name AS doctor_name,
        to_char(
          doctor_availability.starts_at AT TIME ZONE $2,
          'YYYY-MM-DD"T"HH24:MI:SS'
        ) AS starts_at_local,
        to_char(
          doctor_availability.ends_at AT TIME ZONE $2,
          'YYYY-MM-DD"T"HH24:MI:SS'
        ) AS ends_at_local
      FROM doctor_availability
      JOIN doctors ON doctors.id = doctor_availability.doctor_id
      LEFT JOIN LATERAL (
        SELECT blocks.id, blocks.reason
        FROM doctor_schedule_blocks blocks
        WHERE blocks.doctor_id = doctor_availability.doctor_id
          AND blocks.removed_at IS NULL
          AND blocks.starts_at < doctor_availability.ends_at
          AND blocks.ends_at > doctor_availability.starts_at
        ORDER BY blocks.created_at
        LIMIT 1
      ) active_blocks ON TRUE
      LEFT JOIN LATERAL (
        SELECT appointments.id
        FROM appointments
        WHERE appointments.doctor_id = doctor_availability.doctor_id
          AND appointments.status IN ('pending', 'confirmed', 'scheduled')
          AND appointments.starts_at < doctor_availability.ends_at
          AND appointments.ends_at > doctor_availability.starts_at
        ORDER BY appointments.created_at
        LIMIT 1
      ) active_appointments ON TRUE
      WHERE doctor_availability.starts_at >= ($1::date::timestamp AT TIME ZONE $2)
        AND doctor_availability.starts_at < (($1::date + 1)::timestamp AT TIME ZONE $2)
        AND EXISTS (
          SELECT 1
          FROM doctor_weekly_schedules schedules
          WHERE schedules.doctor_id = doctor_availability.doctor_id
            AND schedules.active = TRUE
            AND schedules.weekday = EXTRACT(ISODOW FROM $1::date)
            AND (doctor_availability.starts_at AT TIME ZONE $2)::time >= schedules.starts_at
            AND (doctor_availability.ends_at AT TIME ZONE $2)::time <= schedules.ends_at
            AND MOD(
              EXTRACT(EPOCH FROM (
                (doctor_availability.starts_at AT TIME ZONE $2)::time - schedules.starts_at
              ))::integer,
              schedules.slot_duration_minutes * 60
            ) = 0
        )
        ${doctorFilter}
      ORDER BY doctor_availability.starts_at, doctors.name;
    `, parameters);
    await client.query("COMMIT;");

    return result.rows.map((row) => ({
      id: row.id,
      doctor: { id: row.doctor_id, name: row.doctor_name },
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      startsAtLocal: row.starts_at_local,
      endsAtLocal: row.ends_at_local,
      status: row.effective_status,
      source: row.source,
      notes: row.notes,
      block: row.block_id ? { id: row.block_id, reason: row.block_reason } : null,
    }));
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listAppointments() {
  const result = await getDatabasePool().query(`
    SELECT
      appointments.id,
      appointments.exam_name,
      appointments.starts_at,
      appointments.ends_at,
      appointments.status,
      appointments.source,
      appointments.external_provider,
      appointments.external_event_id,
      appointments.notes,
      doctors.id AS doctor_id,
      doctors.name AS doctor_name,
      patients.id AS patient_id,
      patients.name AS patient_name,
      patients.phone AS patient_phone
    FROM appointments
    JOIN doctors ON doctors.id = appointments.doctor_id
    LEFT JOIN patients ON patients.id = appointments.patient_id
    ORDER BY appointments.starts_at;
  `);

  return result.rows.map((row) => ({
    id: row.id,
    doctor: { id: row.doctor_id, name: row.doctor_name },
    patient: row.patient_id
      ? { id: row.patient_id, name: row.patient_name, phone: row.patient_phone }
      : null,
    examName: row.exam_name,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    source: row.source,
    externalProvider: row.external_provider,
    externalEventId: row.external_event_id,
    notes: row.notes,
  }));
}
