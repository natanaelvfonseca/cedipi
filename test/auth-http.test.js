import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server/app.js";
import { AuthServiceError } from "../server/auth-service.js";
import { createLoginRateLimiter } from "../server/login-rate-limit.js";

const admin = { id: "11111111-1111-4111-8111-111111111111", name: "Admin", email: "admin@cedipi.com", role: "admin", active: true, mustChangePassword: false, lastLoginAt: null, createdAt: "2026-09-07T00:00:00Z" };

async function withServer(authService, callback, loginRateLimiter) {
  const server = createApp({ authService, loginRateLimiter: loginRateLimiter ?? createLoginRateLimiter() }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await callback(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function service(overrides = {}) {
  return {
    authenticate: async () => { throw new AuthServiceError("unauthorized", 401); },
    login: async () => ({ token: "raw-session-token", expiresAt: new Date(Date.now() + 3600000), user: admin }),
    logout: async () => {}, changePassword: async () => admin, listUsers: async () => [admin],
    createUser: async () => admin, updateUser: async () => admin, resetPassword: async () => admin,
    ...overrides,
  };
}

test("APIs operacionais exigem sessão", async () => withServer(service(), async (base) => {
  const response = await fetch(`${base}/api/doctors`);
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
}));

test("login cria cookie HttpOnly, SameSite Lax e Path raiz", async () => withServer(service(), async (base) => {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: admin.email, password: "SenhaSegura123" }) });
  assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /cedipi_session=raw-session-token/); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Path=\//i);
  assert.equal(JSON.stringify(await response.json()).includes("raw-session-token"), false);
}));

test("sessão válida acessa /me sem expor hash ou token", async () => withServer(service({ authenticate: async () => ({ tokenHash: "hash", user: admin }) }), async (base) => {
  const response = await fetch(`${base}/api/auth/me`, { headers: { cookie: "cedipi_session=token" } });
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.user.email, admin.email); assert.equal(JSON.stringify(body).includes("hash"), false);
}));

test("senha temporária bloqueia APIs e permite troca de senha", async () => withServer(service({ authenticate: async () => ({ tokenHash: "hash", user: { ...admin, mustChangePassword: true } }) }), async (base) => {
  assert.equal((await fetch(`${base}/api/doctors`, { headers: { cookie: "cedipi_session=token" } })).status, 403);
  assert.equal((await fetch(`${base}/api/auth/change-password`, { method: "POST", headers: { cookie: "cedipi_session=token", "content-type": "application/json" }, body: JSON.stringify({ currentPassword: "a", newPassword: "b" }) })).status, 200);
}));

test("atendente não acessa usuários e administrador acessa", async () => {
  await withServer(service({ authenticate: async () => ({ tokenHash: "hash", user: { ...admin, role: "attendant" } }) }), async (base) => assert.equal((await fetch(`${base}/api/users`, { headers: { cookie: "cedipi_session=token" } })).status, 403));
  await withServer(service({ authenticate: async () => ({ tokenHash: "hash", user: admin }) }), async (base) => assert.equal((await fetch(`${base}/api/users`, { headers: { cookie: "cedipi_session=token" } })).status, 200));
});

test("mutação com Origin externo é recusada, sem Origin permanece compatível com curl", async () => withServer(service(), async (base) => {
  assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 200);
}));

test("rate limit bloqueia tentativas repetidas com resposta genérica", async () => {
  const limiter = createLoginRateLimiter({ limit: 2 });
  await withServer(service({ login: async () => { throw new AuthServiceError("invalid_credentials", 401); } }), async (base) => {
    for (const status of [401, 401, 429]) {
      const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.equal(response.status, status);
    }
  }, limiter);
});
