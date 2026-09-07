import { randomUUID } from "node:crypto";
import { getDatabasePool } from "./database.js";
import { businessTimezone } from "./schedule-slots-repository.js";

const activeStatuses = ["pending", "confirmed", "scheduled"];

export class AppointmentReservationError extends Error {
  constructor(code) {
    super(code);
    this.name = "AppointmentReservationError";
    this.code = code;
  }
}

function mapAppointment(row) {
  return {
    id: row.id,
    status: row.status,
    exam: row.exam_name,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    doctor: { id: row.doctor_id, name: row.doctor_name },
    patient: {
      id: row.patient_id,
      name: row.patient_name,
      phone: row.patient_phone,
    },
  };
}

export async function reservePendingAppointment({
  doctorId,
  slotId,
  patient,
  exam,
}, pool = getDatabasePool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");

    const doctorResult = await client.query(
      "SELECT id, name, active FROM doctors WHERE id = $1;",
      [doctorId],
    );
    const doctor = doctorResult.rows[0];
    if (!doctor) throw new AppointmentReservationError("doctor_not_found");
    if (!doctor.active) throw new AppointmentReservationError("doctor_unavailable");

    const slotResult = await client.query(
      `
        SELECT availability.id, availability.doctor_id, availability.starts_at,
               availability.ends_at, availability.status,
               EXISTS (
                 SELECT 1 FROM doctor_weekly_schedules schedules
                 WHERE schedules.doctor_id = availability.doctor_id
                   AND schedules.active = TRUE
                   AND schedules.weekday = EXTRACT(ISODOW FROM availability.starts_at AT TIME ZONE $2)
                   AND (availability.starts_at AT TIME ZONE $2)::time >= schedules.starts_at
                   AND (availability.ends_at AT TIME ZONE $2)::time <= schedules.ends_at
                   AND MOD(EXTRACT(EPOCH FROM (
                     (availability.starts_at AT TIME ZONE $2)::time - schedules.starts_at
                   ))::integer, schedules.slot_duration_minutes * 60) = 0
               ) AS in_schedule
        FROM doctor_availability availability
        WHERE availability.id = $1
        FOR UPDATE;
      `,
      [slotId, businessTimezone],
    );
    const slot = slotResult.rows[0];
    if (!slot) throw new AppointmentReservationError("slot_not_found");
    if (slot.doctor_id !== doctorId) {
      throw new AppointmentReservationError("slot_doctor_mismatch");
    }
    if (!slot.in_schedule) {
      throw new AppointmentReservationError("slot_unavailable");
    }
    if (slot.status !== "available") {
      throw new AppointmentReservationError("slot_unavailable");
    }
    if (slot.starts_at <= new Date()) {
      throw new AppointmentReservationError("slot_in_past");
    }

    const blockResult = await client.query(
      `SELECT id
       FROM doctor_schedule_blocks
       WHERE availability_id = $1 AND removed_at IS NULL
       LIMIT 1;`,
      [slotId],
    );
    if (blockResult.rows[0]) {
      throw new AppointmentReservationError("slot_blocked");
    }

    const occupiedResult = await client.query(
      `
        SELECT
          appointments.id,
          appointments.status,
          appointments.exam_name,
          appointments.starts_at,
          appointments.ends_at,
          doctors.id AS doctor_id,
          doctors.name AS doctor_name,
          patients.id AS patient_id,
          patients.name AS patient_name,
          patients.phone AS patient_phone
        FROM appointments
        JOIN doctors ON doctors.id = appointments.doctor_id
        JOIN patients ON patients.id = appointments.patient_id
        WHERE appointments.status = ANY($1::varchar[])
          AND (
            appointments.availability_id = $2
            OR (
              appointments.availability_id IS NULL
              AND appointments.doctor_id = $3
              AND appointments.starts_at < $5
              AND appointments.ends_at > $4
            )
          )
        ORDER BY appointments.created_at
        LIMIT 1;
      `,
      [activeStatuses, slotId, doctorId, slot.starts_at, slot.ends_at],
    );
    const occupied = occupiedResult.rows[0];
    if (occupied) {
      const samePatient = occupied.patient_phone === patient.phone;
      if (samePatient && ["confirmed", "scheduled"].includes(occupied.status)) {
        await client.query("COMMIT;");
        return { outcome: "idempotent", appointment: mapAppointment(occupied) };
      }
      if (samePatient && occupied.status === "pending") {
        await client.query("COMMIT;");
        return { outcome: "in_progress", appointment: mapAppointment(occupied) };
      }
      await client.query("COMMIT;");
      return { outcome: "occupied" };
    }

    const patientResult = await client.query(
      `
        INSERT INTO patients (id, name, phone, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (phone) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, patients.name),
          email = COALESCE(EXCLUDED.email, patients.email),
          updated_at = NOW()
        RETURNING id, name, phone;
      `,
      [randomUUID(), patient.name, patient.phone, patient.email ?? null],
    );
    const savedPatient = patientResult.rows[0];

    const appointmentResult = await client.query(
      `
        INSERT INTO appointments (
          id,
          patient_id,
          doctor_id,
          availability_id,
          exam_name,
          starts_at,
          ends_at,
          status,
          source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'panel')
        RETURNING id, status, exam_name, starts_at, ends_at;
      `,
      [
        randomUUID(),
        savedPatient.id,
        doctorId,
        slotId,
        exam ?? null,
        slot.starts_at,
        slot.ends_at,
      ],
    );

    await client.query("COMMIT;");
    return {
      outcome: "created",
      appointment: mapAppointment({
        ...appointmentResult.rows[0],
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        patient_id: savedPatient.id,
        patient_name: savedPatient.name,
        patient_phone: savedPatient.phone,
      }),
      slot: {
        id: slot.id,
        startsAt: slot.starts_at.toISOString(),
        endsAt: slot.ends_at.toISOString(),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    if (
      error?.code === "23505"
      && error?.constraint === "appointments_active_availability_unique_idx"
    ) {
      return { outcome: "occupied" };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmAppointment({
  appointmentId,
  googleEventId,
  googleCalendarId,
  startsAt,
  endsAt,
}, pool = getDatabasePool()) {
  const result = await pool.query(
    `
      UPDATE appointments
      SET
        status = 'confirmed',
        external_provider = 'google_calendar',
        external_event_id = $2,
        external_calendar_id = $3,
        starts_at = COALESCE($4, starts_at),
        ends_at = COALESCE($5, ends_at),
        updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, status, starts_at, ends_at;
    `,
    [appointmentId, googleEventId, googleCalendarId, startsAt, endsAt],
  );
  return result.rows[0] ?? null;
}

export async function failAppointment(appointmentId, reason, pool = getDatabasePool()) {
  await pool.query(
    `
      UPDATE appointments
      SET
        status = 'failed',
        notes = CASE
          WHEN $2::text IS NULL THEN notes
          ELSE concat_ws(E'\n', notes, 'n8n: ' || $2::text)
        END,
        updated_at = NOW()
      WHERE id = $1 AND status = 'pending';
    `,
    [appointmentId, reason ?? null],
  );
}
