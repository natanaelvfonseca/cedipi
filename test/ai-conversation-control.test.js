import assert from "node:assert/strict";
import test from "node:test";
import {
  getConversationAiEnabled,
  setConversationAiEnabled,
  canLaraReply,
} from "../server/ai-conversation-control-repository.js";
import {
  AiControlUnavailableError,
  createAiConversationControlClient,
} from "../server/ai-conversation-control-client.js";
import { createWhatsAppConversationsService } from "../server/whatsapp-conversations-service.js";

function fakePool() {
  const overrides = new Map();
  let globalEnabled = true;
  return {
    setGlobal(value) { globalEnabled = value; },
    fail: false,
    async query(sql, params) {
      if (this.fail) throw new Error("private database credentials");
      if (sql.includes("SELECT global_enabled")) return { rows: [{ global_enabled: globalEnabled }] };
      if (sql.includes("SELECT enabled FROM ai_conversation_control")) {
        return { rows: overrides.has(params[0]) ? [{ enabled: overrides.get(params[0]) }] : [] };
      }
      if (sql.includes("INSERT INTO ai_conversation_control")) {
        overrides.set(params[0], params[1]);
        return { rows: [{ enabled: params[1] }] };
      }
      throw new Error("Unexpected SQL query");
    },
  };
}
const phone = "5547999999999";

test("persist pause/resume and idempotence", async () => {
  const pool = fakePool();
  assert.equal(await getConversationAiEnabled(phone, pool), true);
  assert.equal(await setConversationAiEnabled(phone, false, pool), false);
  assert.equal(await setConversationAiEnabled(phone, false, pool), false);
  assert.equal(await getConversationAiEnabled(phone, pool), false);
  assert.equal(await setConversationAiEnabled(phone, true, pool), true);
  assert.equal(await getConversationAiEnabled(phone, pool), true);
});

test("Lara gate respects global and per-contact controls and fails closed", async () => {
  const pool = fakePool();
  assert.equal(await canLaraReply(phone, pool), true);
  await setConversationAiEnabled(phone, false, pool);
  assert.equal(await canLaraReply(phone, pool), false);
  await setConversationAiEnabled(phone, true, pool);
  pool.setGlobal(false);
  assert.equal(await canLaraReply(phone, pool), false);
  pool.setGlobal(true);
  pool.fail = true;
  await assert.rejects(canLaraReply(phone, pool));
});

test("legacy n8n remains default with no database calls", async () => {
  const legacy = { getStatus: async () => false };
  const client = createAiConversationControlClient({
    mode: "n8n",
    legacyFactory: () => legacy,
    repository: { getStatus: () => { throw new Error("DB should not be used"); } },
  });
  assert.equal(client, legacy);
});

test("native mode does not invoke n8n", async () => {
  const pool = fakePool();
  const client = createAiConversationControlClient({
    mode: "database",
    legacyFactory: () => { throw new Error("n8n should not be used"); },
    repository: {
      getStatus: (number) => getConversationAiEnabled(number, pool),
      setEnabled: (number, enabled) => setConversationAiEnabled(number, enabled, pool),
    },
  });
  assert.equal(await client.getStatus(phone), true);
  assert.equal(await client.setEnabled(phone, false), false);
  assert.equal(await client.getStatus(phone), false);
});

test("native mode reports errors safely and never invents AI status", async () => {
  const pool = fakePool();
  pool.fail = true;
  const client = createAiConversationControlClient({
    mode: "database",
    repository: { getStatus: (number) => getConversationAiEnabled(number, pool) },
  });
  await assert.rejects(client.getStatus(phone), (error) => {
    assert.equal(error instanceof AiControlUnavailableError, true);
    assert.equal(error.status, 503);
    assert.equal(JSON.stringify(error).includes("credentials"), false);
    return true;
  });
});

test("manual message is not sent if pausing Lara fails", async () => {
  let sent = 0;
  const service = createWhatsAppConversationsService({
    aiControl: { setEnabled: async () => { throw new AiControlUnavailableError(); } },
    evolution: { sendText: async () => { sent += 1; return {}; } },
  });
  await assert.rejects(service.sendManualMessage({
    remoteJid: phone + "@s.whatsapp.net", phone, text: "Olá",
  }), (error) => error instanceof AiControlUnavailableError);
  assert.equal(sent, 0);
});

test("reject unknown AI-control backend", () => {
  assert.throws(() => createAiConversationControlClient({ mode: "other" }),
    (error) => error instanceof AiControlUnavailableError && error.code === "ai_control_invalid_backend");
});
