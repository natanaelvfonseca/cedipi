import assert from "node:assert/strict";
import test from "node:test";
import {
  createEvolutionClient,
  extractQrCode,
  normalizeWhatsAppStatus,
} from "../server/evolution-client.js";

test("normaliza os estados conhecidos sem confundir erro com desconexão", () => {
  assert.equal(normalizeWhatsAppStatus("open"), "connected");
  assert.equal(normalizeWhatsAppStatus("connected"), "connected");
  assert.equal(normalizeWhatsAppStatus("close"), "disconnected");
  assert.equal(normalizeWhatsAppStatus("disconnected"), "disconnected");
  assert.equal(normalizeWhatsAppStatus("connecting"), "connecting");
  assert.equal(normalizeWhatsAppStatus("erro inesperado"), "unknown");
});

test("normaliza QR Code puro e preserva data URL", () => {
  assert.equal(extractQrCode({ base64: "YWJj" }), "data:image/png;base64,YWJj");
  assert.equal(
    extractQrCode({ qrcode: { base64: "data:image/png;base64,ZGVm" } }),
    "data:image/png;base64,ZGVm",
  );
  assert.equal(extractQrCode({}), null);
});

test("localiza e usa Cedipi com comparação sensível a maiúsculas", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, apikey: options.headers.apikey });
    return new Response(JSON.stringify([{ name: "Cedipi", connectionStatus: "open" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createEvolutionClient({
    baseUrl: "https://evolution.example",
    apiKey: "server-secret",
    instanceName: "Cedipi",
    fetchImpl,
  });

  const instance = await client.getInstance();
  await client.getConnectionState();

  assert.equal(instance.name, "Cedipi");
  assert.equal(requests[0].apikey, "server-secret");
  assert.equal(requests[1].url, "https://evolution.example/instance/connectionState/Cedipi");
});

test("não usa cedipi minúsculo como fallback", async () => {
  const client = createEvolutionClient({
    baseUrl: "https://evolution.example",
    apiKey: "server-secret",
    instanceName: "Cedipi",
    fetchImpl: async () => new Response(JSON.stringify([{ name: "cedipi" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(client.getInstance(), /Instância Cedipi não encontrada/);
});
