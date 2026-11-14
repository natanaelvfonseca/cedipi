import { getDatabasePool } from "./database.js";
import { getGlobalAiEnabled } from "./ai-control-repository.js";

// A new contact inherits enabled=true; database errors must never mean enabled.
export async function getConversationAiEnabled(phone, pool = getDatabasePool()) {
  const result = await pool.query(
    "SELECT enabled FROM ai_conversation_control WHERE phone = $1;",
    [phone],
  );
  return result.rows.length > 0 ? result.rows[0].enabled === true : true;
}

export async function setConversationAiEnabled(phone, enabled, pool = getDatabasePool()) {
  const result = await pool.query(
    "INSERT INTO ai_conversation_control (phone, enabled) VALUES ($1, $2::boolean) "
      + "ON CONFLICT (phone) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW() "
      + "RETURNING enabled;",
    [phone, enabled],
  );
  return result.rows[0].enabled === true;
}

// Gate for the future Lara worker: on database error, throw; never send.
export async function canLaraReply(phone, pool = getDatabasePool()) {
  const globalEnabled = await getGlobalAiEnabled(pool);
  if (globalEnabled !== true) return false;
  return (await getConversationAiEnabled(phone, pool)) === true;
}
