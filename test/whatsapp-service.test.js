import assert from "node:assert/strict";
import test from "node:test";
import {
  connectWhatsAppInstance,
  disconnectWhatsAppInstance,
  syncWhatsAppInstance,
} from "../server/whatsapp-service.js";

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

  assert.deepEqual(result, { status: "connected", connected: true, qrCode: null });
  assert.equal(client.qrCalls, 0);
});

test("solicita e normaliza QR quando a instância está desconectada", async () => {
  const client = evolutionClient("close");
  const saved = [];
  const result = await connectWhatsAppInstance({ client, save: async (value) => saved.push(value) });

  assert.deepEqual(result, { status: "qr_required", connected: false, qrCode: "data:image/png;base64,YWJj" });
  assert.equal(client.qrCalls, 1);
  assert.equal(saved.at(-1).status, "connecting");
});

test("QR ausente é tratado como falha e não inicia conexão fictícia", async () => {
  const client = evolutionClient("close");
  client.getQrCode = async () => ({});
  await assert.rejects(
    connectWhatsAppInstance({ client, save: async () => {} }),
    /não retornou um QR Code/,
  );
});

test("conexão confirmada durante geração não exige QR", async () => {
  let state = "close";
  const client = evolutionClient(state);
  client.getConnectionState = async () => ({ instance: { instanceName: "Cedipi", state } });
  client.getQrCode = async () => {
    state = "open";
    return {};
  };
  assert.deepEqual(
    await connectWhatsAppInstance({ client, save: async () => {} }),
    { status: "connected", connected: true, qrCode: null },
  );
});

function logoutClient({ initialState = "open", logoutFails = false } = {}) {
  let state = initialState;
  const operations = [];
  return {
    operations,
    async getInstance() {
      return { name: "Cedipi", connectionStatus: state, ownerJid: "5547999999999@s.whatsapp.net" };
    },
    async getConnectionState(name) {
      operations.push({ operation: "state", name });
      return { instance: { instanceName: name, state } };
    },
    async logoutInstance(name) {
      operations.push({ operation: "logout", name });
      state = "close";
      if (logoutFails) throw new Error("HTTP 500 após logout");
      return { status: "SUCCESS" };
    },
    async getQrCode(name) {
      operations.push({ operation: "connect", name });
      return { base64: "bm92by1xcg==" };
    },
  };
}

test("logout usa somente Cedipi e confirma estado desconectado", async () => {
  const client = logoutClient();
  const result = await disconnectWhatsAppInstance({ client, save: async () => {} });
  assert.deepEqual(result, { status: "disconnected" });
  assert.deepEqual(client.operations.filter((item) => item.operation === "logout"), [
    { operation: "logout", name: "Cedipi" },
  ]);
  assert.equal(client.operations.some((item) => item.operation === "delete"), false);
});

test("logout já desconectado é idempotente e não chama Evolution logout", async () => {
  const client = logoutClient({ initialState: "close" });
  assert.deepEqual(
    await disconnectWhatsAppInstance({ client, save: async () => {} }),
    { status: "disconnected" },
  );
  assert.equal(client.operations.some((item) => item.operation === "logout"), false);
});

test("HTTP 500 no logout ainda é sucesso quando connectionState confirma close", async () => {
  const client = logoutClient({ logoutFails: true });
  assert.deepEqual(
    await disconnectWhatsAppInstance({ client, save: async () => {} }),
    { status: "disconnected" },
  );
});

test("logout não confirmado não altera o estado para desconectado", async () => {
  const client = logoutClient();
  client.logoutInstance = async () => { throw new Error("logout falhou"); };
  await assert.rejects(
    disconnectWhatsAppInstance({ client, save: async () => {} }),
    /logout falhou/,
  );
});

test("depois do logout a mesma instância Cedipi pode gerar novo QR", async () => {
  const client = logoutClient();
  await disconnectWhatsAppInstance({ client, save: async () => {} });
  const result = await connectWhatsAppInstance({ client, save: async () => {} });
  assert.equal(result.status, "qr_required");
  assert.equal(result.qrCode, "data:image/png;base64,bm92by1xcg==");
  assert.deepEqual(client.operations.at(-1), { operation: "connect", name: "Cedipi" });
});
