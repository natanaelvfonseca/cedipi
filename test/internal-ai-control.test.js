import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApp } from "../server/app.js";
import { AuthServiceError } from "../server/auth-service.js";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Admin", email: "admin@cedipi.com.br", role: "admin", active: true,
  mustChangePassword: false,
};

async function withServer(options, callback) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function harness(initialValue = true) {
  let value = initialValue;
  const authService = {
    async authenticate(token) {
      if (token !== "valid-session") throw new AuthServiceError("unauthorized", 401);
      return { tokenHash: "hash", user };
    },
  };
  return {
    options: {
      authService,
      internalApiSecret: "internal-secret",
      aiControlReader: async () => value,
      aiControlWriter: async (enabled) => { value = enabled; return value; },
    },
    value: () => value,
  };
}

test("GET do painel exige sessão e autenticado lê o estado real", async () => {
  const state = harness(false);
  await withServer(state.options, async (base) => {
    const unauthorized = await fetch(`${base}/api/ai-control`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { ok: false, error: "unauthorized" });

    const authorized = await fetch(`${base}/api/ai-control`, {
      headers: { cookie: "cedipi_session=valid-session" },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { ok: true, globalEnabled: false });
  });
});

test("PATCH do painel persiste false e true e o reload consulta a mesma fonte", async () => {
  const state = harness(true);
  await withServer(state.options, async (base) => {
    for (const enabled of [false, true]) {
      const changed = await fetch(`${base}/api/ai-control`, {
        method: "PATCH",
        headers: { cookie: "cedipi_session=valid-session", "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      assert.equal(changed.status, 200);
      assert.deepEqual(await changed.json(), { ok: true, globalEnabled: enabled });
      assert.equal(state.value(), enabled);
      const reloaded = await fetch(`${base}/api/ai-control`, {
        headers: { cookie: "cedipi_session=valid-session" },
      });
      assert.deepEqual(await reloaded.json(), { ok: true, globalEnabled: enabled });
    }
  });
});

test("rota interna bloqueia segredo ausente/incorreto e lê a mesma fonte com segredo correto", async () => {
  const state = harness(false);
  await withServer(state.options, async (base) => {
    const missing = await fetch(`${base}/api/internal/ai-control`);
    assert.equal(missing.status, 401);
    const wrong = await fetch(`${base}/api/internal/ai-control`, {
      headers: { "x-cedipi-internal-secret": "wrong" },
    });
    assert.equal(wrong.status, 403);
    const correct = await fetch(`${base}/api/internal/ai-control`, {
      headers: { "x-cedipi-internal-secret": "internal-secret" },
    });
    assert.equal(correct.status, 200);
    assert.deepEqual(await correct.json(), { ok: true, globalEnabled: false });

    const changed = await fetch(`${base}/api/ai-control`, {
      method: "PATCH",
      headers: { cookie: "cedipi_session=valid-session", "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(changed.status, 200);
    const after = await fetch(`${base}/api/internal/ai-control`, {
      headers: { "x-cedipi-internal-secret": "internal-secret" },
    });
    assert.deepEqual(await after.json(), { ok: true, globalEnabled: true });
  });
});

test("rota interna configurada somente para leitura", async () => {
  const state = harness(true);
  await withServer(state.options, async (base) => {
    const response = await fetch(`${base}/api/internal/ai-control`, {
      method: "PATCH",
      headers: { "x-cedipi-internal-secret": "internal-secret", "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.notEqual(response.status, 200);
    assert.equal(state.value(), true);
  });
});

test("CSRF aceita origem pública encaminhada pelo proxy e continua bloqueando origem externa", async () => {
  const state = harness(true);
  await withServer(state.options, async (base) => {
    const legitimate = await fetch(`${base}/api/ai-control`, {
      method: "PATCH",
      headers: {
        cookie: "cedipi_session=valid-session", "content-type": "application/json",
        origin: "https://painel.cedipi.com.br", "x-forwarded-proto": "https",
        "x-forwarded-host": "painel.cedipi.com.br",
      },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(legitimate.status, 200);

    const invalid = await fetch(`${base}/api/ai-control`, {
      method: "PATCH",
      headers: {
        cookie: "cedipi_session=valid-session", "content-type": "application/json",
        origin: "https://evil.example", "x-forwarded-proto": "https",
        "x-forwarded-host": "painel.cedipi.com.br",
      },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(invalid.status, 403);
    assert.deepEqual(await invalid.json(), { ok: false, error: "invalid_origin" });
  });
});

test("troca da conexão WhatsApp não possui acesso ao estado global", async () => {
  for (const path of ["../server/whatsapp-service.js", "../server/whatsapp-repository.js", "../server/evolution-client.js"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.equal(source.includes("ai_control_settings"), false);
    assert.equal(source.includes("setGlobalAiEnabled"), false);
  }
});
