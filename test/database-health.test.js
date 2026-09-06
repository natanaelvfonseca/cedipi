import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseHealthHandler } from "../server/database-health.js";

function responseRecorder() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("health check responde 200 sem expor configuração", async () => {
  const response = responseRecorder();
  const handler = createDatabaseHealthHandler(async () => {});

  await handler({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, database: "connected" });
});

test("health check responde 503 sem expor o erro", async () => {
  const response = responseRecorder();
  const handler = createDatabaseHealthHandler(async () => {
    throw new Error("postgresql://postgres:segredo@host:5432/cedipi_core");
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await handler({}, response);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, database: "disconnected" });
});
