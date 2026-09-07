import assert from "node:assert/strict";
import test from "node:test";
import {
  getConversationAiControl,
  getWhatsAppConversations,
  getWhatsAppMessages,
  getWhatsAppMessageMedia,
  patchConversationAiControl,
  sendWhatsAppMessage,
} from "../app/whatsapp-api.ts";

const conversation = {
  id: "554791935149@s.whatsapp.net",
  phone: "5547991935149",
  name: "Paciente",
  profilePictureUrl: null,
  lastMessage: "Olá",
  lastMessageAt: "2026-09-07T12:00:00.000Z",
  unreadCount: 0,
};

test("carrega a lista de conversas", async () => {
  let url;
  const result = await getWhatsAppConversations(undefined, async (requested) => {
    url = requested;
    return Response.json({ ok: true, conversations: [conversation] });
  });
  assert.equal(url, "/api/whatsapp/conversations");
  assert.deepEqual(result, [conversation]);
});

test("baixa mídia somente pela rota backend usando o JID original", async () => {
  let url;
  const media = await getWhatsAppMessageMedia(conversation.id, "MEDIA-ID", undefined, async (requested) => {
    url = requested;
    return new Response("imagem", { headers: { "content-type": "image/jpeg" } });
  });
  assert.equal(url, "/api/whatsapp/conversations/554791935149%40s.whatsapp.net/messages/MEDIA-ID/media");
  assert.equal(await media.text(), "imagem");
  assert.equal(url.includes("EVOLUTION_API_KEY"), false);
});

test("falha de mídia não expõe corpo técnico", async () => {
  await assert.rejects(
    getWhatsAppMessageMedia(conversation.id, "missing", undefined, async () => Response.json({ ok: false, error: "media_not_found" }, { status: 404 })),
    { name: "WhatsAppInboxApiError" },
  );
});

test("usa o JID original codificado para buscar mensagens", async () => {
  let url;
  await getWhatsAppMessages(conversation.id, undefined, async (requested) => {
    url = requested;
    return Response.json({ ok: true, messages: [] });
  });
  assert.equal(url, "/api/whatsapp/conversations/554791935149%40s.whatsapp.net/messages");
  assert.equal(url.includes(conversation.phone), false);
});

test("resposta de mensagens inválida vira falha tratável da inbox", async () => {
  await assert.rejects(
    getWhatsAppMessages(conversation.id, undefined, async () => Response.json({ ok: true, conversations: [] })),
    { name: "WhatsAppInboxApiError" },
  );
});

test("usa telefone normalizado apenas para consultar IA individual", async () => {
  let url;
  assert.equal(await getConversationAiControl(conversation.phone, undefined, async (requested) => {
    url = requested;
    return Response.json({ ok: true, enabled: false });
  }), false);
  assert.equal(url, `/api/whatsapp/conversations/${conversation.phone}/ai-control`);
  assert.equal(url.includes(encodeURIComponent(conversation.id)), false);
});

test("envio manual usa conversationId e não faz PATCH separado", async () => {
  let request;
  const message = await sendWhatsAppMessage(conversation.id, "Mensagem manual", async (url, options) => {
    request = { url, options };
    return Response.json({ ok: true, message: { id: "sent", fromMe: true, type: "text", text: "Mensagem manual", timestamp: null, status: null } });
  });
  assert.equal(request.url, "/api/whatsapp/conversations/554791935149%40s.whatsapp.net/messages");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { text: "Mensagem manual" });
  assert.equal(message.id, "sent");
});

for (const enabled of [false, true]) {
  test(`switch individual envia enabled=${enabled} usando telefone`, async () => {
    let request;
    const result = await patchConversationAiControl(conversation.phone, enabled, async (url, options) => {
      request = { url, options };
      return Response.json({ ok: true, enabled });
    });
    assert.equal(request.url, `/api/whatsapp/conversations/${conversation.phone}/ai-control`);
    assert.equal(request.options.method, "PATCH");
    assert.deepEqual(JSON.parse(request.options.body), { enabled });
    assert.equal(result, enabled);
  });
}
