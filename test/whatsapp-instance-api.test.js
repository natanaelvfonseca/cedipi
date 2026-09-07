import assert from "node:assert/strict";
import test from "node:test";
import {
  connectWhatsAppInstance,
  disconnectWhatsAppInstance,
  formatWhatsAppPhone,
  getWhatsAppInstance,
} from "../app/whatsapp-instance-api.ts";

test("status da sidebar vem de GET /api/whatsapp/instance", async () => {
  let requestedUrl;
  const instance = await getWhatsAppInstance(undefined, async (url) => {
    requestedUrl = url;
    return Response.json({
      ok: true,
      instance: {
        name: "Cedipi",
        status: "connected",
        connected: true,
        phoneNumber: "554792283043",
        profileName: "Sohana Rayssa",
      },
    });
  });

  assert.equal(requestedUrl, "/api/whatsapp/instance");
  assert.deepEqual(instance, {
    name: "Cedipi",
    status: "connected",
    connected: true,
    phoneNumber: "554792283043",
    profileName: "Sohana Rayssa",
  });
});

test("aceita instanceName sem expor outros campos da Evolution", async () => {
  const instance = await getWhatsAppInstance(undefined, async () => Response.json({
    ok: true,
    instance: {
      instanceName: "Cedipi",
      instanceId: "interno",
      status: "disconnected",
      connected: false,
    },
  }));
  assert.deepEqual(instance, {
    name: "Cedipi",
    status: "disconnected",
    connected: false,
    phoneNumber: null,
    profileName: null,
  });
});

test("falha ou contrato inválido não assume WhatsApp conectado", async () => {
  await assert.rejects(
    getWhatsAppInstance(undefined, async () => Response.json({ ok: false }, { status: 502 })),
    { name: "WhatsAppInstanceApiError" },
  );
  await assert.rejects(
    getWhatsAppInstance(undefined, async () => Response.json({ ok: true, instance: { status: "online" } })),
    { name: "WhatsAppInstanceApiError" },
  );
});

test("formata telefone brasileiro para exibição compacta", () => {
  assert.equal(formatWhatsAppPhone("554792283043"), "+55 (47) 9228-3043");
  assert.equal(formatWhatsAppPhone(null), null);
});

test("connect reconhece instância já conectada sem QR", async () => {
  let request;
  const result = await connectWhatsAppInstance(async (url, options) => {
    request = { url, options };
    return Response.json({ ok: true, status: "connected", connected: true, qrCode: null });
  });
  assert.equal(request.url, "/api/whatsapp/instance/connect");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(result, { status: "connected", connected: true, qrCode: null });
});

test("connect aceita QR válido e rejeita QR ausente", async () => {
  const result = await connectWhatsAppInstance(async () => Response.json({
    ok: true,
    status: "qr_required",
    connected: false,
    qrCode: "data:image/png;base64,YWJj",
  }));
  assert.equal(result.qrCode, "data:image/png;base64,YWJj");

  await assert.rejects(
    connectWhatsAppInstance(async () => Response.json({ ok: true, status: "qr_required", connected: false, qrCode: null })),
    { name: "WhatsAppInstanceApiError" },
  );
});

test("disconnect chama somente o endpoint público de logout", async () => {
  let request;
  const result = await disconnectWhatsAppInstance(async (url, options) => {
    request = { url, options };
    return Response.json({ ok: true, status: "disconnected" });
  });
  assert.deepEqual(request, {
    url: "/api/whatsapp/instance/disconnect",
    options: { method: "POST" },
  });
  assert.deepEqual(result, { status: "disconnected" });
});
