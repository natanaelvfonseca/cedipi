import assert from "node:assert/strict";
import test from "node:test";
import { connectWhatsAppInstance, syncWhatsAppInstance } from "../server/whatsapp-service.js";

process.env.EVOLUTION_INSTANCE_NAME = "Cedipi";
process.env.EVOLUTION_INSTANCE_ID = "manager-id";

function evolutionClient(state) {
  let qrCalls = 0;
  return {
    get qrCalls() { return qrCalls; },
    async getInstance() {
      return {
        name: "Cedipi",
        connectionStatus: state,
        ownerJid: "5547999999999@s.whatsapp.net",
        profileName: "CEDIPI",
        integration: "WHATSAPP-BAILEYS",
      };
    },
    async getConnectionState(name) {
      assert.equal(name, "Cedipi");
      return { instance: { instanceName: name, state } };
    },
    async getQrCode(name) {
      qrCalls += 1;
      assert.equal(name, "Cedipi");
      return { base64: "YWJj" };
    },
  };
}

test("sincroniza metadados e status real da Evolution", async () => {
  const saved = [];
  const instance = await syncWhatsAppInstance({
    client: evolutionClient("open"),
    save: async (value) => saved.push(value),
    now: () => new Date("2026-09-06T12:00:00.000Z"),
  });

  assert.equal(instance.status, "connected");
  assert.equal(instance.phoneNumber, "5547999999999");
  assert.equal(instance.profileName, "CEDIPI");
  assert.equal(instance.integrationType, "WHATSAPP-BAILEYS");
  assert.equal(saved.length, 1);
});

test("não solicita QR quando a instância está conectada", async () => {
  const client = evolutionClient("open");
  const result = await connectWhatsAppInstance({ client, save: async () => {} });

  assert.deepEqual(result, { connected: true, qrCode: null });
  assert.equal(client.qrCalls, 0);
});

test("solicita e normaliza QR quando a instância está desconectada", async () => {
  const client = evolutionClient("close");
  const saved = [];
  const result = await connectWhatsAppInstance({ client, save: async (value) => saved.push(value) });

  assert.deepEqual(result, { connected: false, qrCode: "data:image/png;base64,YWJj" });
  assert.equal(client.qrCalls, 1);
  assert.equal(saved.at(-1).status, "connecting");
});
