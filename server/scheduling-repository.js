import { getDatabasePool } from "./database.js";

export const businessTimezone = "America/Sao_Paulo";

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
  const parameters = [date, businessTimezone];
  let doctorFilter = "";
  if (doctor) {
    parameters.push(doctor);
    doctorFilter = "AND (doctors.id::text = $3 OR doctors.name = $3)";
  }

  const result = await getDatabasePool().query(
    `
      SELECT
        doctor_availability.id,
        doctor_availability.starts_at,
        doctor_availability.ends_at,
        doctor_availability.status,
        doctor_availability.source,
        doctor_availability.notes,
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
      WHERE doctor_availability.starts_at >= ($1::date::timestamp AT TIME ZONE $2)
        AND doctor_availability.starts_at < (($1::date + 1)::timestamp AT TIME ZONE $2)
        ${doctorFilter}
      ORDER BY doctor_availability.starts_at, doctors.name;
    `,
    parameters,
  );

  return result.rows.map((row) => ({
    id: row.id,
    doctor: { id: row.doctor_id, name: row.doctor_name },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    startsAtLocal: row.starts_at_local,
    endsAtLocal: row.ends_at_local,
    status: row.status,
    source: row.source,
    notes: row.notes,
  }));
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
