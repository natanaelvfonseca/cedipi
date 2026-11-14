import { randomUUID } from "node:crypto";
import { getDatabasePool } from "./database.js";

export async function enqueueLaraMessage(message, {
  pool = getDatabasePool(), debounceMs = 5000,
} = {}) {
  const boundedDelay = Math.min(20000, Math.max(1000, Number(debounceMs) || 5000));
  const result = await pool.query(
    "WITH incoming AS ("
    + " INSERT INTO lara_inbound_messages (instance_name,message_id,phone,remote_jid,body)"
    + " VALUES ($1,$2,$3,$4,$5) ON CONFLICT (instance_name,message_id) DO NOTHING RETURNING phone"
    + ") INSERT INTO lara_conversation_jobs (phone,run_after)"
    + " SELECT phone, NOW() + make_interval(secs => $6::double precision / 1000) FROM incoming"
    + " ON CONFLICT (phone) DO UPDATE SET"
    + " run_after = GREATEST(lara_conversation_jobs.run_after, EXCLUDED.run_after),"
    + " updated_at = NOW() RETURNING phone;",
    [message.instance, message.messageId, message.phone, message.remoteJid,
      message.text, boundedDelay],
  );
  return { accepted: result.rowCount > 0, duplicate: result.rowCount === 0 };
}

export async function claimNextLaraJob(pool = getDatabasePool(), {
  leaseSeconds = 180,
} = {}) {
  const id = randomUUID();
  const result = await pool.query(
    "WITH next_job AS ("
    + " SELECT phone FROM lara_conversation_jobs"
    + " WHERE run_after <= NOW() AND (lease_until IS NULL OR lease_until <= NOW())"
    + " ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1"
    + ") UPDATE lara_conversation_jobs jobs SET lease_id=$1::uuid,"
    + " lease_until=NOW() + make_interval(secs => $2::int), updated_at=NOW()"
    + " FROM next_job WHERE jobs.phone=next_job.phone"
    + " RETURNING jobs.phone, jobs.lease_id;",
    [id, leaseSeconds],
  );
  return result.rows[0] ?? null;
}

export async function claimLaraBatch(job, pool = getDatabasePool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    // Recovery only for processing: "sending" is never retried automatically.
    await client.query(
      "UPDATE lara_inbound_messages SET status='pending', claim_id=NULL"
      + " WHERE phone=$1 AND status='processing' AND claim_id <> $2::uuid;",
      [job.phone, job.lease_id],
    );
    const result = await client.query(
      "UPDATE lara_inbound_messages SET status='processing', claim_id=$2::uuid,"
      + " attempts=attempts + 1"
      + " WHERE phone=$1 AND status='pending'"
      + " RETURNING id, body, message_id, remote_jid, attempts, received_at;",
      [job.phone, job.lease_id],
    );
    await client.query("COMMIT;");
    return result.rows.sort((a,b) => Number(a.id) - Number(b.id));
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function latestLaraHistory(phone, pool = getDatabasePool(), limit = 12) {
  const result = await pool.query(
    "SELECT role, content FROM ("
    + " SELECT id, role, content FROM lara_history"
    + " WHERE phone=$1 ORDER BY id DESC LIMIT $2"
    + ") messages ORDER BY id ASC;",
    [phone, Math.min(20, Math.max(1, limit))],
  );
  return result.rows;
}

export async function relevantLaraKnowledge(query, pool = getDatabasePool()) {
  const result = await pool.query(
    "SELECT title, left(content, 2000) AS content FROM lara_knowledge_sources"
    + " WHERE active = TRUE AND to_tsvector('portuguese', content || ' ' || title)"
    + " @@ plainto_tsquery('portuguese', $1)"
    + " ORDER BY ts_rank(to_tsvector('portuguese', content || ' ' || title),"
    + " plainto_tsquery('portuguese', $1)) DESC LIMIT 4;",
    [query.slice(0, 400)],
  );
  return result.rows;
}

export async function listLaraKnowledge(pool = getDatabasePool()) {
  const result = await pool.query(
    "SELECT id,title,active,created_at,updated_at FROM lara_knowledge_sources ORDER BY title;"
  );
  return result.rows;
}
export async function addLaraKnowledge({ title, content }, pool = getDatabasePool()) {
  const result = await pool.query(
    "INSERT INTO lara_knowledge_sources(title,content) VALUES($1,$2) RETURNING id,title,active;",
    [title,content],
  );
  return result.rows[0];
}

export async function createLaraHandoff(phone, reason, pool = getDatabasePool()) {
  await pool.query(
    "INSERT INTO lara_handoffs(phone,reason) VALUES($1,$2)"
    + " ON CONFLICT (phone) WHERE status='open'"
    + " DO UPDATE SET reason=EXCLUDED.reason,updated_at=NOW();",
    [phone,reason],
  );
}
export async function listLaraHandoffs(pool = getDatabasePool()) {
  const result = await pool.query(
    "SELECT id,phone,reason,status,created_at FROM lara_handoffs"
    + " WHERE status='open' ORDER BY created_at ASC LIMIT 100;"
  );
  return result.rows;
}

export async function releaseLaraLease(job, pool = getDatabasePool(), retrySeconds = 0) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    if (retrySeconds > 0) {
      await client.query(
        "UPDATE lara_conversation_jobs SET run_after=GREATEST(run_after,"
        + "NOW()+make_interval(secs => $3::int)) WHERE phone=$1 AND lease_id=$2;",
        [job.phone,job.lease_id,retrySeconds],
      );
    }
    await client.query(
      "UPDATE lara_conversation_jobs SET lease_id=NULL,lease_until=NULL,"
      + "updated_at=NOW() WHERE phone=$1 AND lease_id=$2;",
      [job.phone,job.lease_id],
    );
    await client.query(
      "DELETE FROM lara_conversation_jobs jobs WHERE phone=$1"
      + " AND lease_id IS NULL"
      + " AND NOT EXISTS (SELECT 1 FROM lara_inbound_messages m"
      + " WHERE m.phone=jobs.phone AND m.status='pending');",
      [job.phone],
    );
    await client.query("COMMIT;");
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function hasNewerPendingMessages(job, pool = getDatabasePool()) {
  const result = await pool.query(
    "SELECT EXISTS (SELECT 1 FROM lara_inbound_messages"
    + " WHERE phone=$1 AND status='pending') AS has_new"
    + " FROM lara_conversation_jobs WHERE phone=$1 AND lease_id=$2::uuid"
    + " AND lease_until > NOW();",
    [job.phone,job.lease_id],
  );
  // A missing/expired lease is not permission to send.
  if (!result.rows[0]) return null;
  return result.rows[0].has_new;
}

export async function prepareLaraSend(job, pool = getDatabasePool()) {
  const result = await pool.query(
    "UPDATE lara_inbound_messages SET status='sending'"
    + " WHERE phone=$1 AND claim_id=$2::uuid AND status='processing'"
    + " AND EXISTS (SELECT 1 FROM lara_conversation_jobs j"
    + " WHERE j.phone=$1 AND j.lease_id=$2::uuid AND j.lease_until>NOW())"
    + " AND NOT EXISTS (SELECT 1 FROM lara_inbound_messages pending"
    + " WHERE pending.phone=$1 AND pending.status='pending')"
    + " RETURNING id;",
    [job.phone,job.lease_id],
  );
  return result.rowCount > 0;
}

export async function requeueLaraBatch(job, pool = getDatabasePool(), {
  retry = false, code = null,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    const maxAttempts = 3;
    await client.query(
      "UPDATE lara_inbound_messages"
      + " SET status=CASE WHEN $3::boolean=TRUE AND attempts >= $4::int"
      + " THEN 'manual_review' ELSE 'pending' END,"
      + " claim_id=NULL, failure_code=$5"
      + " WHERE phone=$1 AND claim_id=$2::uuid AND status='processing';",
      [job.phone, job.lease_id, retry, maxAttempts, code],
    );
    await client.query("COMMIT;");
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function markLaraDeliveryUncertain(job, reason, pool = getDatabasePool()) {
  await pool.query(
    "UPDATE lara_inbound_messages SET status='manual_review',"
    + " failure_code=$3,processed_at=NOW()"
    + " WHERE phone=$1 AND claim_id=$2::uuid AND status='sending';",
    [job.phone,job.lease_id,reason],
  );
}

export async function finishLaraDelivery(job, batch, responseText, outboundId,
  pool = getDatabasePool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    for (const message of batch) {
      await client.query(
        "INSERT INTO lara_history(phone,role,content,inbound_id)"
        + " VALUES($1,'user',$2,$3) ON CONFLICT (inbound_id) DO NOTHING;",
        [job.phone,message.body,message.id],
      );
    }
    await client.query(
      "INSERT INTO lara_history(phone,role,content) VALUES($1,'assistant',$2);",
      [job.phone,responseText],
    );
    const result = await client.query(
      "UPDATE lara_inbound_messages SET status='sent',processed_at=NOW(),"
      + " response_text=$3,outbound_id=$4"
      + " WHERE phone=$1 AND claim_id=$2::uuid AND status='sending' RETURNING id;",
      [job.phone,job.lease_id,responseText,outboundId ?? null],
    );
    if (result.rowCount !== batch.length) throw new Error("delivery_state_mismatch");
    await client.query("COMMIT;");
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function markLaraSuppressed(job, reason = "ai_paused", pool = getDatabasePool()) {
  await pool.query(
    "UPDATE lara_inbound_messages SET status='manual_review',processed_at=NOW(),"
    + " failure_code=$3 WHERE phone=$1 AND claim_id=$2::uuid AND status='processing';",
    [job.phone,job.lease_id,reason],
  );
}

export async function countRecentLaraReplies(phone, pool = getDatabasePool()) {
  const result = await pool.query(
    "SELECT count(DISTINCT claim_id)::int AS total FROM lara_inbound_messages"
    + " WHERE phone=$1 AND status='sent' AND processed_at > NOW() - interval '24 hours';",
    [phone],
  );
  return result.rows[0]?.total ?? 0;
}

export async function setLaraKnowledgeActive(id, active, pool = getDatabasePool()) {
  const result = await pool.query(
    "UPDATE lara_knowledge_sources SET active=$2::boolean, updated_at=NOW()"
    + " WHERE id=$1::uuid RETURNING id,title,active;",
    [id, active],
  );
  return result.rows[0] ?? null;
}
export async function closeLaraHandoff(id, pool = getDatabasePool()) {
  const result = await pool.query(
    "UPDATE lara_handoffs SET status='closed', updated_at=NOW()"
    + " WHERE id=$1::uuid AND status='open' RETURNING id,status;",
    [id],
  );
  return result.rows[0] ?? null;
}
