import assert from "node:assert/strict";
import test from "node:test";
import {
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
