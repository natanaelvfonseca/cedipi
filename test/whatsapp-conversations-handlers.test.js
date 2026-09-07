import assert from "node:assert/strict";
import test from "node:test";
import { N8nAiControlError } from "../server/n8n-ai-control-client.js";
import { WhatsAppConversationError } from "../server/whatsapp-conversations-service.js";
import {
  createGetConversationAiControlHandler,
  createGetWhatsAppMessageMediaHandler,
  createListWhatsAppConversationsHandler,
  createListWhatsAppMessagesHandler,
  createPatchConversationAiControlHandler,
  createSendWhatsAppMessageHandler,
} from "../server/whatsapp-conversations-handlers.js";

const jid = "5547999999999@s.whatsapp.net";

function responseRecorder() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; return this; },
  };
}

test("GET mídia devolve bytes e headers seguros", async () => {
  let received;
  const response = responseRecorder();
  await createGetWhatsAppMessageMediaHandler({ async getMedia(remoteJid, messageId) {
    received = { remoteJid, messageId };
    return { buffer: Buffer.from("pdf"), contentType: "application/pdf", fileName: "laudo clínico.pdf", disposition: "inline" };
  } })({ params: { conversationId: "554791935149@s.whatsapp.net", messageId: "ABC-123" } }, response);
  assert.deepEqual(received, { remoteJid: "554791935149@s.whatsapp.net", messageId: "ABC-123" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "application/pdf");
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(response.headers["Content-Disposition"].includes("filename*=UTF-8''"), true);
  assert.equal(response.body.toString(), "pdf");
});

test("GET mídia rejeita conversationId e messageId inválidos", async () => {
  let calls = 0;
  const service = { async getMedia() { calls += 1; } };
  const invalidConversation = responseRecorder();
  const invalidMessage = responseRecorder();
  await createGetWhatsAppMessageMediaHandler(service)({ params: { conversationId: "../etc", messageId: "id" } }, invalidConversation);
  await createGetWhatsAppMessageMediaHandler(service)({ params: { conversationId: jid, messageId: "../../secret" } }, invalidMessage);
  assert.deepEqual(invalidConversation.body, { ok: false, error: "invalid_conversation" });
  assert.deepEqual(invalidMessage.body, { ok: false, error: "invalid_message" });
  assert.equal(calls, 0);
});

test("GET mídia normaliza indisponibilidade sem expor segredo", async () => {
  const secret = "evolution-api-secret";
  const response = responseRecorder();
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logs.push(JSON.stringify(values));
  try {
    await createGetWhatsAppMessageMediaHandler({ async getMedia() {
      const error = new WhatsAppConversationError("media_unavailable", 502);
      error.internalSecret = secret;
      throw error;
    } })({ params: { conversationId: jid, messageId: "media-id" } }, response);
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(response.body, { ok: false, error: "media_unavailable" });
  assert.equal(JSON.stringify(response.body).includes(secret), false);
  assert.equal(logs.join(" ").includes(secret), false);
});

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

test("GET preserva JID original e separa telefone normalizado", async () => {
  let received;
  const response = responseRecorder();
  await createListWhatsAppMessagesHandler({ async listMessages(jid) { received = jid; return []; } })(
    { params: { conversationId: "554791935149@s.whatsapp.net" } },
    response,
  );
  assert.equal(received, "554791935149@s.whatsapp.net");
  assert.notEqual(received, "5547991935149@s.whatsapp.net");
  assert.equal(response.statusCode, 200);
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
