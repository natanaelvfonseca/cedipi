import { getDatabasePool } from "./database.js";

export const businessTimezone = "America/Sao_Paulo";

export async function materializeScheduleSlots(client, { date, doctor }) {
  const parameters = [date, businessTimezone];
  let doctorFilter = "";
  if (doctor) {
    parameters.push(doctor);
    doctorFilter = "AND (doctors.id::text = $3 OR doctors.name = $3)";
  }

  await client.query(
    `
      WITH generated_slots AS (
        SELECT
          md5(
            doctors.id::text || '|' || $1::date::text || '|'
            || to_char(schedules.starts_at + slot_index * make_interval(mins => schedules.slot_duration_minutes), 'HH24:MI')
          )::uuid AS id,
          doctors.id AS doctor_id,
          (($1::date + schedules.starts_at
            + slot_index * make_interval(mins => schedules.slot_duration_minutes)) AT TIME ZONE $2) AS starts_at,
          (($1::date + schedules.starts_at
            + slot_index * make_interval(mins => schedules.slot_duration_minutes)
            + make_interval(mins => schedules.slot_duration_minutes)) AT TIME ZONE $2) AS ends_at
        FROM doctor_weekly_schedules schedules
        JOIN doctors ON doctors.id = schedules.doctor_id AND doctors.active = TRUE
        CROSS JOIN LATERAL generate_series(
          0,
          (EXTRACT(EPOCH FROM (schedules.ends_at - schedules.starts_at))::integer
            / (schedules.slot_duration_minutes * 60)) - 1
        ) AS slot_index
        WHERE schedules.active = TRUE
          AND schedules.weekday = EXTRACT(ISODOW FROM $1::date)
          ${doctorFilter}
      )
      INSERT INTO doctor_availability (
        id, doctor_id, starts_at, ends_at, status, source
      )
      SELECT id, doctor_id, starts_at, ends_at, 'available', 'schedule'
      FROM generated_slots
      ON CONFLICT (doctor_id, starts_at) DO NOTHING;
    `,
    parameters,
  );
}

export async function ensureScheduleSlots(filters, pool = getDatabasePool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    await materializeScheduleSlots(client, filters);
    await client.query("COMMIT;");
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
