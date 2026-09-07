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

test("busca todas as páginas, preserva os dois lados e ordena da mais antiga", async () => {
  const requests = [];
  const service = createWhatsAppConversationsService({
    evolution: {
      async findMessages(value, pagination) {
        requests.push({ value, pagination });
        if (pagination.page === 1) {
          return { messages: { pages: 2, currentPage: 1, records: [
            { key: { id: "2", fromMe: true }, message: { conversation: "Segundo" }, messageTimestamp: 1788782460 },
          ] } };
        }
        return { messages: { pages: 2, currentPage: 2, records: [
          { key: { id: "1", fromMe: false }, message: { conversation: "Primeiro" }, messageTimestamp: 1788782400 },
        ] } };
      },
    },
  });
  const messages = await service.listMessages(jid);
  assert.deepEqual(requests, [
    { value: jid, pagination: { page: 1, offset: 100 } },
    { value: jid, pagination: { page: 2, offset: 100 } },
  ]);
  assert.deepEqual(messages.map((message) => message.id), ["1", "2"]);
  assert.deepEqual(messages.map((message) => message.fromMe), [false, true]);
});

function mediaRecord(type, id = "media-id", remoteJid = jid, fromMe = false) {
  const content = type === "image" ? { imageMessage: { caption: "Legenda" } }
    : type === "audio" ? { audioMessage: {} }
      : { documentMessage: { fileName: "../laudo\r\nmalicioso.pdf" } };
  return { key: { id, remoteJid, fromMe }, messageType: `${type}Message`, message: content };
}

function mediaService(record, response, calls = []) {
  return createWhatsAppConversationsService({ evolution: {
    async findMessages(remoteJid) { calls.push(["find", remoteJid]); return [record]; },
    async getMediaFromMessage(message) { calls.push(["media", message]); return response; },
  } });
}

test("obtém imagem real, preserva Content-Type e JID original", async () => {
  const calls = [];
  const record = mediaRecord("image");
  const media = await mediaService(record, {
    mimetype: "image/jpeg",
    fileName: "foto.jpg",
    base64: Buffer.from("imagem-real").toString("base64"),
  }, calls).getMedia(jid, "media-id");
  assert.equal(media.contentType, "image/jpeg");
  assert.equal(media.buffer.toString(), "imagem-real");
  assert.equal(media.disposition, "inline");
  assert.deepEqual(calls[0], ["find", jid]);
  assert.equal(calls[1][1], record);
});

test("obtém áudio enviado pela CEDIPI com Content-Type real", async () => {
  const record = mediaRecord("audio", "media-id", jid, true);
  const media = await mediaService(record, {
    mimetype: "audio/ogg; codecs=opus",
    base64: Buffer.from("audio").toString("base64"),
  }).getMedia(jid, "media-id");
  assert.equal(media.contentType, "audio/ogg");
  assert.equal(media.buffer.toString(), "audio");
  assert.equal(record.key.fromMe, true);
});

test("PDF abre inline e documento não PDF força download", async () => {
  const pdf = await mediaService(mediaRecord("document"), {
    mimetype: "application/pdf", fileName: "laudo.pdf", base64: "cGRm",
  }).getMedia(jid, "media-id");
  const office = await mediaService(mediaRecord("document"), {
    mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "laudo.docx", base64: "ZG9jeA==",
  }).getMedia(jid, "media-id");
  assert.equal(pdf.disposition, "inline");
  assert.equal(office.disposition, "attachment");
});

test("nome do arquivo remove caminho e caracteres de header", async () => {
  const media = await mediaService(mediaRecord("document"), {
    mimetype: "application/pdf", fileName: "../../laudo\r\n.pdf", base64: "cGRm",
  }).getMedia(jid, "media-id");
  assert.equal(media.fileName, "laudo__.pdf");
  assert.equal(media.fileName.includes("/"), false);
  assert.equal(media.fileName.includes("\n"), false);
});

test("mídia inexistente e mensagem de outra conversa não são expostas", async () => {
  let mediaCalls = 0;
  const service = createWhatsAppConversationsService({ evolution: {
    async findMessages() { return [mediaRecord("image", "other", "5511999999999@s.whatsapp.net")]; },
    async getMediaFromMessage() { mediaCalls += 1; },
  } });
  await assert.rejects(service.getMedia(jid, "missing"), (error) => error.code === "media_not_found" && error.status === 404);
  await assert.rejects(service.getMedia(jid, "other"), (error) => error.code === "media_not_found" && error.status === 404);
  assert.equal(mediaCalls, 0);
});

test("tipo sem mídia e resposta inválida são normalizados", async () => {
  const textRecord = { key: { id: "text-id", remoteJid: jid }, message: { conversation: "Oi" } };
  await assert.rejects(
    mediaService(textRecord, {}).getMedia(jid, "text-id"),
    (error) => error.code === "unsupported_media" && error.status === 415,
  );
  await assert.rejects(
    mediaService(mediaRecord("image"), { mimetype: "image/jpeg", base64: "%%%" }).getMedia(jid, "media-id"),
    (error) => error.code === "media_unavailable" && error.status === 502,
  );
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
