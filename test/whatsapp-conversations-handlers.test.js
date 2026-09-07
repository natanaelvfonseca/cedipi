import assert from "node:assert/strict";
import test from "node:test";
import { N8nAiControlError } from "../server/n8n-ai-control-client.js";
import {
  createGetConversationAiControlHandler,
  createListWhatsAppConversationsHandler,
  createListWhatsAppMessagesHandler,
  createPatchConversationAiControlHandler,
  createSendWhatsAppMessageHandler,
} from "../server/whatsapp-conversations-handlers.js";

function responseRecorder() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("GET lista conversas normalizadas", async () => {
  const response = responseRecorder();
  await createListWhatsAppConversationsHandler({ async listConversations() { return [{ id: "jid" }]; } })({}, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, conversations: [{ id: "jid" }] });
});

test("GET busca mensagens usando o JID individual", async () => {
  let received;
  const response = responseRecorder();
  await createListWhatsAppMessagesHandler({ async listMessages(jid) { received = jid; return []; } })(
    { params: { conversationId: "5547999999999@s.whatsapp.net" } },
    response,
  );
  assert.equal(received, "5547999999999@s.whatsapp.net");
  assert.deepEqual(response.body, { ok: true, messages: [] });
});

test("POST rejeita mensagem vazia", async () => {
  let called = false;
  const response = responseRecorder();
  await createSendWhatsAppMessageHandler({ async sendManualMessage() { called = true; } })(
    { params: { conversationId: "5547999999999@s.whatsapp.net" }, body: { text: "  " } },
    response,
  );
  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});

test("POST envia texto normalizado", async () => {
  let received;
  const response = responseRecorder();
  await createSendWhatsAppMessageHandler({ async sendManualMessage(input) { received = input; return { id: "sent" }; } })(
    { params: { conversationId: "5547999999999@s.whatsapp.net" }, body: { text: " Olá " } },
    response,
  );
  assert.equal(response.statusCode, 201);
  assert.equal(received.text, "Olá");
  assert.equal(received.phone, "5547999999999");
  assert.deepEqual(response.body, { ok: true, message: { id: "sent" } });
});

test("GET consulta status individual", async () => {
  let received;
  const response = responseRecorder();
  await createGetConversationAiControlHandler({ async getAiControl(phone) { received = phone; return true; } })(
    { params: { phone: "+55 (47) 99999-9999" } }, response,
  );
  assert.equal(received, "5547999999999");
  assert.deepEqual(response.body, { ok: true, enabled: true });
});

for (const enabled of [false, true]) {
  test(`PATCH atualiza controle individual enabled=${enabled}`, async () => {
    let received;
    const response = responseRecorder();
    await createPatchConversationAiControlHandler({ async setAiControl(phone, value) { received = { phone, value }; return value; } })(
      { params: { phone: "5547999999999" }, body: { enabled } }, response,
    );
    assert.deepEqual(received, { phone: "5547999999999", value: enabled });
    assert.deepEqual(response.body, { ok: true, enabled });
  });
}

test("PATCH rejeita enabled string", async () => {
  const response = responseRecorder();
  await createPatchConversationAiControlHandler({ async setAiControl() { throw new Error("não deve chamar"); } })(
    { params: { phone: "5547999999999" }, body: { enabled: "false" } }, response,
  );
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { ok: false, error: "invalid_request" });
});

test("erros não expõem segredo do n8n", async () => {
  const secret = "n8n-super-secret";
  const response = responseRecorder();
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logs.push(JSON.stringify(values));
  try {
    await createGetConversationAiControlHandler({ async getAiControl() {
      const error = new N8nAiControlError("ai_control_unavailable");
      error.internalSecret = secret;
      throw error;
    } })({ params: { phone: "5547999999999" } }, response);
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(response.body, { ok: false, error: "ai_control_unavailable" });
  assert.equal(JSON.stringify(response.body).includes(secret), false);
  assert.equal(logs.join(" ").includes(secret), false);
});
