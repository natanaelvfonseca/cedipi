import assert from "node:assert/strict";
import test from "node:test";
import { N8nAiControlError } from "../server/n8n-ai-control-client.js";
import {
  createWhatsAppConversationsService,
  normalizeConversation,
  normalizeMessage,
} from "../server/whatsapp-conversations-service.js";
import { normalizeBrazilianPhone } from "../server/whatsapp-phone.js";

const jid = "5547999999999@s.whatsapp.net";

test("normaliza conversa individual e última mensagem", () => {
  assert.deepEqual(normalizeConversation({
    remoteJid: jid,
    pushName: "Paciente",
    profilePicUrl: "https://cdn.example/photo.jpg",
    updatedAt: "2026-09-07T12:00:00.000Z",
    unreadCount: 2,
    lastMessage: {
      key: { id: "last-id", fromMe: false },
      messageType: "conversation",
      message: { conversation: "Olá" },
      messageTimestamp: 1788782400,
    },
  }), {
    id: jid,
    phone: "5547999999999",
    name: "Paciente",
    profilePictureUrl: "https://cdn.example/photo.jpg",
    lastMessage: "Olá",
    lastMessageAt: "2026-09-07T12:00:00.000Z",
    unreadCount: 2,
  });
});

test("lista conversas individuais, exclui grupos e ordena por recência", async () => {
  const service = createWhatsAppConversationsService({
    evolution: {
      async findChats() {
        return [
          { remoteJid: "120363000000@g.us", pushName: "Grupo" },
          { remoteJid: "5511999999999@s.whatsapp.net", pushName: "Mais antiga", updatedAt: "2026-09-06T10:00:00Z" },
          { remoteJid: jid, pushName: "Mais recente", updatedAt: "2026-09-07T10:00:00Z" },
        ];
      },
    },
  });

  const conversations = await service.listConversations();
  assert.equal(conversations.length, 2);
  assert.equal(conversations[0].name, "Mais recente");
  assert.equal(conversations.some((item) => item.id.endsWith("@g.us")), false);
});

test("normaliza texto, áudio, imagem e documento sem baixar mídia", () => {
  const base = { key: { id: "id", fromMe: false }, messageTimestamp: 1788782400 };
  assert.deepEqual(normalizeMessage({ ...base, messageType: "conversation", message: { conversation: "Olá" } }), {
    id: "id", fromMe: false, type: "text", text: "Olá", timestamp: "2026-09-07T12:00:00.000Z", status: null,
  });
  assert.equal(normalizeMessage({ ...base, messageType: "audioMessage", message: { audioMessage: { url: "private" } } }).type, "audio");
  assert.equal(normalizeMessage({ ...base, messageType: "audioMessage", message: { audioMessage: {} } }).text, null);
  assert.deepEqual(
    normalizeMessage({ ...base, messageType: "imageMessage", message: { imageMessage: { caption: "Laudo" } } }),
    { id: "id", fromMe: false, type: "image", text: "Laudo", timestamp: "2026-09-07T12:00:00.000Z", status: null },
  );
  assert.equal(normalizeMessage({
    ...base,
    messageType: "documentMessage",
    message: { documentMessage: { fileName: "exame.pdf" } },
  }).text, "exame.pdf");
});

test("busca e ordena mensagens da conversa", async () => {
  let receivedJid;
  const service = createWhatsAppConversationsService({
    evolution: {
      async findMessages(value) {
        receivedJid = value;
        return { messages: { records: [
          { key: { id: "2", fromMe: true }, message: { conversation: "Segundo" }, messageTimestamp: 1788782460 },
          { key: { id: "1", fromMe: false }, message: { conversation: "Primeiro" }, messageTimestamp: 1788782400 },
        ] } };
      },
    },
  });
  const messages = await service.listMessages(jid);
  assert.equal(receivedJid, jid);
  assert.deepEqual(messages.map((message) => message.id), ["1", "2"]);
});

test("envio manual pausa IA antes de enviar texto", async () => {
  const calls = [];
  const service = createWhatsAppConversationsService({
    aiControl: {
      async setEnabled(phone, enabled) { calls.push(["pause", phone, enabled]); return false; },
    },
    evolution: {
      async sendText(phone, text) {
        calls.push(["send", phone, text]);
        return { key: { id: "sent-id", fromMe: true }, message: { conversation: text }, messageTimestamp: 1788782400 };
      },
    },
  });

  const message = await service.sendManualMessage({ remoteJid: jid, phone: "5547999999999", text: "Mensagem manual" });
  assert.deepEqual(calls, [
    ["pause", "5547999999999", false],
    ["send", "5547999999999", "Mensagem manual"],
  ]);
  assert.equal(message.id, "sent-id");
  assert.equal(message.fromMe, true);
});

test("falha ao pausar IA impede envio manual", async () => {
  let sends = 0;
  const service = createWhatsAppConversationsService({
    aiControl: { async setEnabled() { throw new N8nAiControlError("ai_control_unavailable"); } },
    evolution: { async sendText() { sends += 1; } },
  });

  await assert.rejects(
    service.sendManualMessage({ remoteJid: jid, phone: "5547999999999", text: "Não enviar" }),
    (error) => error.code === "ai_control_unavailable",
  );
  assert.equal(sends, 0);
});

test("normalização brasileira inclui DDI 55 e nono dígito móvel ausente", () => {
  assert.equal(normalizeBrazilianPhone("(47) 99999-9999"), "5547999999999");
  assert.equal(normalizeBrazilianPhone("55 47 8888-7777"), "5547988887777");
});
