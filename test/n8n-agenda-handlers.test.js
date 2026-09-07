import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server/app.js";
import { N8nAgendaError } from "../server/n8n-agenda-client.js";
import {
  createLiveAvailabilityHandler,
  parseLiveAvailabilityQuery,
} from "../server/n8n-agenda-handlers.js";

function responseRecorder() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("valida data, médico e UUID sem acessar o webhook", () => {
  assert.equal(parseLiveAvailabilityQuery({ date: "09/09/2026", doctor: "Wagner" }), null);
  assert.equal(parseLiveAvailabilityQuery({ date: "2026-09-09" }), null);
  assert.equal(parseLiveAvailabilityQuery({
    date: "2026-09-09",
    doctorId: "not-an-id",
  }), null);
});

test("endpoint normaliza os parâmetros e devolve disponibilidade", async () => {
  let received;
  const response = responseRecorder();
  const handler = createLiveAvailabilityHandler(async (parameters) => {
    received = parameters;
    return { available: true, slots: ["14:00"], message: null };
  });

  await handler({ query: {
    date: "2026-09-09",
    doctor: " Wagner ",
    doctorId: "8418eb24-bb4a-45e6-89ec-5cfaf22cf446",
    period: " tarde ",
    after: " 14:00 ",
  } }, response);

  assert.deepEqual(received, {
    date: "2026-09-09",
    doctor: "Wagner",
    doctorId: "8418eb24-bb4a-45e6-89ec-5cfaf22cf446",
    period: "tarde",
    after: "14:00",
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    availability: { available: true, slots: ["14:00"], message: null },
  });
});

test("endpoint não expõe segredo em falhas do n8n", async () => {
  const response = responseRecorder();
  const handler = createLiveAvailabilityHandler(async () => {
    throw new N8nAgendaError("private-secret", {
      code: "n8n_authentication_failed",
      status: 502,
      upstreamStatus: 401,
    });
  });
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logged.push(values);
  try {
    await handler({ query: { date: "2026-09-09", doctor: "Wagner" } }, response);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, { ok: false, error: "n8n_authentication_failed" });
  assert.equal(JSON.stringify(response.body).includes("private-secret"), false);
  assert.equal(JSON.stringify(logged).includes("private-secret"), false);
});

test("endpoint sem configuração retorna erro claro", async () => {
  const response = responseRecorder();
  const handler = createLiveAvailabilityHandler(async () => {
    throw new N8nAgendaError("Não configurado", {
      code: "n8n_not_configured",
      status: 503,
    });
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await handler({ query: { date: "2026-09-09", doctor: "Wagner" } }, response);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, error: "n8n_not_configured" });
});

test("POST de appointments rejeita payload inválido antes de acessar serviços", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/appointments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doctorId: "anything" }),
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }
});
