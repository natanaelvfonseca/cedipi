import assert from "node:assert/strict";
import test from "node:test";
import { createEvolutionClient } from "../server/evolution-client.js";

test("Evolution usa as rotas de inbox da instância exatamente Cedipi", async () => {
  const requests = [];
  const client = createEvolutionClient({
    baseUrl: "https://evolution.example/",
    apiKey: "evolution-secret",
    instanceName: "Cedipi",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json(url.includes("findChats") ? [] : {
        key: { id: "message-id", fromMe: true },
        message: { conversation: "Olá" },
      });
    },
  });

  await client.findChats();
  await client.findMessages("5547999999999@s.whatsapp.net");
  await client.sendText("5547999999999", "Olá");

  assert.deepEqual(requests.map((item) => item.url), [
    "https://evolution.example/chat/findChats/Cedipi",
    "https://evolution.example/chat/findMessages/Cedipi",
    "https://evolution.example/message/sendText/Cedipi",
  ]);
  assert.equal(requests.every((item) => item.options.headers.apikey === "evolution-secret"), true);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    where: {
      key: {
        remoteJid: "5547999999999@s.whatsapp.net",
        remoteJidAlt: "5547999999999@s.whatsapp.net",
      },
    },
    page: 1,
    offset: 50,
  });
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    number: "5547999999999",
    text: "Olá",
  });
});

test("findMessages preserva o JID original sem aplicar o nono dígito", async () => {
  let body;
  const originalJid = "554791935149@s.whatsapp.net";
  const client = createEvolutionClient({
    baseUrl: "https://evolution.example",
    apiKey: "secret",
    instanceName: "Cedipi",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({ messages: { records: [], pages: 1 } });
    },
  });

  await client.findMessages(originalJid, { page: 2, offset: 100 });
  assert.equal(body.where.key.remoteJid, originalJid);
  assert.equal(body.where.key.remoteJidAlt, originalJid);
  assert.equal(JSON.stringify(body).includes("5547991935149"), false);
  assert.equal(body.page, 2);
});

test("findMessages usa somente page, offset e filtro temporal suportados pela Evolution 2.3.7", async () => {
  let body;
  const client = createEvolutionClient({
    baseUrl: "https://evolution.example",
    apiKey: "secret",
    instanceName: "Cedipi",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({ messages: { records: [], pages: 3, currentPage: 2 } });
    },
  });
  await client.findMessages("554791935149@s.whatsapp.net", {
    page: 2,
    offset: 50,
    until: "2026-09-07T12:00:00.000Z",
  });
  assert.deepEqual(body.where.messageTimestamp, {
    gte: "1970-01-01T00:00:00.000Z",
    lte: "2026-09-07T12:00:00.000Z",
  });
  assert.equal("limit" in body, false);
  assert.equal("perPage" in body, false);
});

test("mídia usa a rota oficial da Evolution e envia o objeto real da mensagem", async () => {
  const requests = [];
  const message = {
    key: { id: "MEDIA-ID", remoteJid: "554791935149@s.whatsapp.net", fromMe: false },
    message: { imageMessage: { mimetype: "image/jpeg" } },
  };
  const client = createEvolutionClient({
    baseUrl: "https://evolution.example",
    apiKey: "secret-key",
    instanceName: "Cedipi",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json({ mimetype: "image/jpeg", base64: "aW1hZ2Vt" }, { status: 201 });
    },
  });

  await client.getMediaFromMessage(message);
  assert.equal(requests[0].url, "https://evolution.example/chat/getBase64FromMediaMessage/Cedipi");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { message });
  assert.equal(requests[0].options.headers.apikey, "secret-key");
});

test("Evolution rejeita configuração com cedipi minúsculo", () => {
  assert.throws(() => createEvolutionClient({
    baseUrl: "https://evolution.example",
    apiKey: "secret",
    instanceName: "cedipi",
  }), /instância Evolution configurada é inválida/);
});
