import assert from "node:assert/strict";
import test from "node:test";
import {
  createGetAiControlHandler,
  createPatchAiControlHandler,
} from "../server/ai-control-handlers.js";
import {
  getGlobalAiEnabled,
  setGlobalAiEnabled,
} from "../server/ai-control-repository.js";

function responseRecorder() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function statefulPool(initialValue) {
  let value = initialValue;
  return {
    async query(sql, parameters) {
      if (sql.includes("SELECT global_enabled")) {
        return { rows: value === undefined ? [] : [{ global_enabled: value }] };
      }

      if (sql.includes("INSERT INTO ai_control_settings")) {
        if (parameters.length === 2) value = parameters[1];
        else if (value === undefined) value = true;
        return { rows: [{ global_enabled: value }] };
      }

      throw new Error("Consulta inesperada no teste.");
    },
  };
}

test("estado inicial é true e registro ausente é inicializado com segurança", async () => {
  const pool = statefulPool(undefined);
  assert.equal(await getGlobalAiEnabled(pool), true);
  assert.equal(await getGlobalAiEnabled(pool), true);
});

test("persiste transições true -> false -> true e PATCH idempotente", async () => {
  const pool = statefulPool(true);
  assert.equal(await setGlobalAiEnabled(false, pool), false);
  assert.equal(await getGlobalAiEnabled(pool), false);
  assert.equal(await setGlobalAiEnabled(false, pool), false);
  assert.equal(await setGlobalAiEnabled(true, pool), true);
  assert.equal(await getGlobalAiEnabled(pool), true);
});

test("GET responde no contrato público exato", async () => {
  const response = responseRecorder();
  await createGetAiControlHandler(async () => false)({}, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, globalEnabled: false });
});

test("PATCH aceita somente boolean real", async () => {
  for (const body of [{}, { enabled: "false" }, { enabled: 0 }, { enabled: null }]) {
    const response = responseRecorder();
    await createPatchAiControlHandler(async () => true)({ body }, response);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, { ok: false, error: "invalid_enabled" });
  }
});

test("PATCH responde com o valor efetivamente persistido", async () => {
  const response = responseRecorder();
  let received;
  await createPatchAiControlHandler(async (enabled) => {
    received = enabled;
    return enabled;
  })({ body: { enabled: false } }, response);

  assert.equal(received, false);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, globalEnabled: false });
});

test("falha de banco nunca vira estado ativo silencioso nem expõe detalhes", async () => {
  const secret = "postgresql://postgres:segredo@host/cedipi_core";
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logged.push(values.join(" "));

  try {
    for (const handler of [
      createGetAiControlHandler(async () => { throw new Error(secret); }),
      createPatchAiControlHandler(async () => { throw new Error(secret); }),
    ]) {
      const response = responseRecorder();
      await handler({ body: { enabled: true } }, response);
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.body, { ok: false, error: "ai_control_unavailable" });
      assert.equal("globalEnabled" in response.body, false);
    }
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(logged.join(" ").includes(secret), false);
});
