import assert from "node:assert/strict";
import test from "node:test";
import {
  createConnectWhatsAppHandler,
  createGetWhatsAppInstanceHandler,
} from "../server/whatsapp-handlers.js";

function responseRecorder() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("endpoint de status devolve somente o contrato público", async () => {
  const response = responseRecorder();
  const handler = createGetWhatsAppInstanceHandler(async () => ({
    name: "Cedipi",
    status: "connected",
    connected: true,
    phoneNumber: "5547999999999",
    profileName: "CEDIPI",
    lastCheckedAt: "2026-09-06T12:00:00.000Z",
    externalInstanceId: "private-id",
    apiKey: "never-return-this",
  }));

  await handler({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    instance: {
      name: "Cedipi",
      status: "connected",
      connected: true,
      phoneNumber: "5547999999999",
      profileName: "CEDIPI",
      lastCheckedAt: "2026-09-06T12:00:00.000Z",
    },
  });
});

test("falha externa vira unknown sem detalhes internos", async () => {
  const response = responseRecorder();
  const handler = createGetWhatsAppInstanceHandler(async () => {
    throw new Error("apikey secreta");
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await handler({}, response);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, {
    ok: false,
    instance: { name: "Cedipi", status: "unknown", connected: false },
  });
});

test("endpoint de conexão entrega QR normalizado", async () => {
  const response = responseRecorder();
  const handler = createConnectWhatsAppHandler(async () => ({
    connected: false,
    qrCode: "data:image/png;base64,YWJj",
  }));

  await handler({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    connected: false,
    qrCode: "data:image/png;base64,YWJj",
  });
});
