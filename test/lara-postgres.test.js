import assert from "node:assert/strict";
import test from "node:test";
import { getDatabasePool, closeDatabasePool } from "../server/database.js";
import {
  enqueueLaraMessage, claimNextLaraJob, claimLaraBatch,
  relevantLaraKnowledge, addLaraKnowledge, setLaraKnowledgeActive,
  createLaraHandoff, listLaraHandoffs, closeLaraHandoff,
  hasNewerPendingMessages, prepareLaraSend, finishLaraDelivery,
  releaseLaraLease,
} from "../server/lara-inbox-repository.js";
import {
  canLaraReply, setConversationAiEnabled,
} from "../server/ai-conversation-control-repository.js";

const phone = "5511999999999";
const event = { instance: "Cedipi", messageId: "ci-inbound-1",
  phone, remoteJid: phone + "@s.whatsapp.net", text: "Onde fica a unidade?" };

test("native Lara queue performs idempotent ingest and safe delivery on PostgreSQL", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const pool = getDatabasePool();
  try {
    const first = await enqueueLaraMessage(event, { pool, debounceMs: 1000 });
    const second = await enqueueLaraMessage(event, { pool, debounceMs: 1000 });
    assert.equal(first.accepted, true);
    assert.equal(second.duplicate, true);

    const source = await addLaraKnowledge({
      title: "Endereço da CEDIPI",
      content: "A clínica fica na Rua das Flores, perto da praça central.",
    }, pool);
    assert.ok(source.id);
    assert.equal((await relevantLaraKnowledge("Flores", pool)).length, 1);
    assert.equal((await setLaraKnowledgeActive(source.id, false, pool)).active, false);
    assert.equal((await relevantLaraKnowledge("Flores", pool)).length, 0);
    await setLaraKnowledgeActive(source.id, true, pool);

    assert.equal(await canLaraReply(phone, pool), true);
    await setConversationAiEnabled(phone, false, pool);
    assert.equal(await canLaraReply(phone, pool), false);
    await setConversationAiEnabled(phone, true, pool);

    await pool.query("UPDATE lara_conversation_jobs SET run_after=NOW() WHERE phone=$1;",[phone]);
    const job = await claimNextLaraJob(pool);
    assert.equal(job.phone, phone);
    const batch = await claimLaraBatch(job, pool);
    assert.equal(batch.length, 1);
    assert.equal(batch[0].body, event.text);
    assert.equal(await hasNewerPendingMessages(job,pool), false);
    assert.equal(await prepareLaraSend(job,pool), true);
    await finishLaraDelivery(job, batch, "Resposta de teste aprovada.", "wa-123", pool);
    await releaseLaraLease(job,pool);

    const counts = await pool.query(
      "SELECT status, outbound_id FROM lara_inbound_messages WHERE message_id=$1;",
      [event.messageId],
    );
    assert.deepEqual(counts.rows, [{ status:"sent", outbound_id:"wa-123" }]);
    const history = await pool.query("SELECT role,content FROM lara_history WHERE phone=$1 ORDER BY id;",[phone]);
    assert.deepEqual(history.rows.map((row) => row.role), ["user","assistant"]);

    await createLaraHandoff(phone, "scheduling",pool);
    await createLaraHandoff(phone, "human",pool);
    const open = (await listLaraHandoffs(pool)).filter((item)=>item.phone===phone);
    assert.equal(open.length,1);
    assert.equal(open[0].reason,"human");
    assert.equal((await closeLaraHandoff(open[0].id,pool)).status,"closed");

    await pool.query("DELETE FROM lara_history WHERE phone=$1;",[phone]);
    await pool.query("DELETE FROM lara_inbound_messages WHERE phone=$1;",[phone]);
    await pool.query("DELETE FROM lara_conversation_jobs WHERE phone=$1;",[phone]);
    await pool.query("DELETE FROM lara_handoffs WHERE phone=$1;",[phone]);
    await pool.query("DELETE FROM ai_conversation_control WHERE phone=$1;",[phone]);
    await pool.query("DELETE FROM lara_knowledge_sources WHERE id=$1;",[source.id]);
  } finally {
    await closeDatabasePool();
  }
});
