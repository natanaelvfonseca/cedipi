import { getDatabasePool } from "./database.js";

export async function getGlobalAiEnabled(pool = getDatabasePool()) {
  const current = await pool.query(
    "SELECT global_enabled FROM ai_control_settings WHERE id = $1::smallint;",
    [1],
  );

  if (current.rows[0]) {
    return current.rows[0].global_enabled;
  }

  const initialized = await pool.query(
    `
      INSERT INTO ai_control_settings (id, global_enabled)
      VALUES ($1::smallint, TRUE)
      ON CONFLICT (id) DO UPDATE SET
        global_enabled = ai_control_settings.global_enabled
      RETURNING global_enabled;
    `,
    [1],
  );

  return initialized.rows[0].global_enabled;
}

export async function setGlobalAiEnabled(enabled, pool = getDatabasePool()) {
  const result = await pool.query(
    `
      INSERT INTO ai_control_settings (id, global_enabled)
      VALUES ($1::smallint, $2::boolean)
      ON CONFLICT (id) DO UPDATE SET
        global_enabled = EXCLUDED.global_enabled,
        updated_at = NOW()
      RETURNING global_enabled;
    `,
    [1, enabled],
  );

  return result.rows[0].global_enabled;
}
