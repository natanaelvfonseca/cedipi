import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword } from "../server/auth-password.js";
import { AuthServiceError, createAuthService, hashSessionToken, normalizeEmail, sessionTtlHours } from "../server/auth-service.js";

const baseUser = { id: "11111111-1111-4111-8111-111111111111", name: "Admin", email: "admin@cedipi.com", role: "admin", active: true, mustChangePassword: false, lastLoginAt: null, createdAt: "2026-09-07T00:00:00Z" };

function repository(overrides = {}) {
  return {
    hasAdmin: async () => true, bootstrapAdmin: async () => ({ created: true }),
    findUserForLogin: async () => null, recordLoginFailure: async () => {},
    recordLogin: async () => baseUser, findSession: async () => null, touchSession: async () => {}, deleteSession: async () => {},
    changePassword: async () => ({ ...baseUser, mustChangePassword: false }), listUsers: async () => [baseUser],
    createUser: async (value) => ({ ...baseUser, name: value.name, email: value.email, role: value.role, mustChangePassword: true }),
    updateUser: async ({ changes }) => ({ ...baseUser, ...changes }), resetPassword: async () => ({ ...baseUser, mustChangePassword: true }),
    ...overrides,
  };
}

test("normaliza e-mail e aplica TTL de sessão seguro", () => {
  assert.equal(normalizeEmail("  ADMIN@CEDIPI.COM "), "admin@cedipi.com");
  assert.equal(sessionTtlHours(undefined), 12);
  assert.equal(sessionTtlHours("24"), 24);
  assert.throws(() => sessionTtlHours("0"), /inválido/);
});

test("bootstrap não lê nem recria credenciais quando já há administrador", async () => {
  let called = false;
  const service = createAuthService(repository({ bootstrapAdmin: async () => { called = true; } }));
  assert.deepEqual(await service.bootstrapInitialAdmin({}), { created: false });
  assert.equal(called, false);
});

test("bootstrap exige configuração completa quando não há administrador", async () => {
  const service = createAuthService(repository({ hasAdmin: async () => false }));
  await assert.rejects(service.bootstrapInitialAdmin({}), /configuração do administrador inicial incompleta/i);
});

test("bootstrap cria primeiro admin uma única vez com senha protegida e troca obrigatória", async () => {
  let saved;
  const service = createAuthService(repository({ hasAdmin: async () => false, bootstrapAdmin: async (value) => { saved = value; return { created: true, user: { ...baseUser, mustChangePassword: true } }; } }));
  const result = await service.bootstrapInitialAdmin({ CEDIPI_INITIAL_ADMIN_NAME: " Admin Inicial ", CEDIPI_INITIAL_ADMIN_EMAIL: " ADMIN.INICIAL@CEDIPI.LOCAL ", CEDIPI_INITIAL_ADMIN_PASSWORD: "TemporariaSegura123" });
  assert.equal(result.created, true); assert.equal(result.user.mustChangePassword, true);
  assert.equal(saved.email, "admin.inicial@cedipi.local"); assert.equal(saved.passwordHash.includes("TemporariaSegura123"), false);
});

test("login cria token aleatório e persiste somente seu hash", async () => {
  const passwordHash = await hashPassword("SenhaSegura123");
  let saved;
  const service = createAuthService(repository({
    findUserForLogin: async () => ({ ...baseUser, password_hash: passwordHash }),
    recordLogin: async (value) => { saved = value; return baseUser; },
  }), { ttlHours: 12, now: () => new Date("2026-09-07T12:00:00Z") });
  const result = await service.login({ email: "ADMIN@CEDIPI.COM", password: "SenhaSegura123" });
  assert.equal(saved.tokenHash, hashSessionToken(result.token));
  assert.equal(saved.tokenHash.includes(result.token), false);
  assert.equal(result.expiresAt.toISOString(), "2026-09-08T00:00:00.000Z");
});

test("login inválido ou usuário inativo retorna a mesma resposta genérica", async () => {
  const passwordHash = await hashPassword("SenhaSegura123");
  for (const record of [null, { ...baseUser, active: false, password_hash: passwordHash }]) {
    const service = createAuthService(repository({ findUserForLogin: async () => record }));
    await assert.rejects(service.login({ email: baseUser.email, password: "SenhaSegura123" }), (error) => error instanceof AuthServiceError && error.code === "invalid_credentials" && error.status === 401);
  }
});

test("sessão expirada é removida e sessão ativa devolve usuário público", async () => {
  let deleted = false; let touched = false;
  const now = () => new Date("2026-09-07T12:00:00Z");
  const expired = createAuthService(repository({ findSession: async () => ({ ...baseUser, active: true, expires_at: "2026-09-07T11:00:00Z", session_id: "s" }), deleteSession: async () => { deleted = true; } }), { now });
  await assert.rejects(expired.authenticate("token"), /unauthorized/); assert.equal(deleted, true);
  const active = createAuthService(repository({ findSession: async () => ({ id: baseUser.id, name: baseUser.name, email: baseUser.email, role: "admin", active: true, must_change_password: false, last_login_at: null, created_at: baseUser.createdAt, expires_at: "2026-09-08T00:00:00Z", last_seen_at: "2026-09-07T11:00:00Z", session_id: "s" }), touchSession: async () => { touched = true; } }), { now });
  assert.equal((await active.authenticate("token")).user.email, baseUser.email); assert.equal(touched, true);
});

test("troca de senha valida senha atual e persiste hash novo", async () => {
  const passwordHash = await hashPassword("SenhaAntiga123"); let saved;
  const service = createAuthService(repository({ findUserForLogin: async () => ({ ...baseUser, password_hash: passwordHash }), changePassword: async (value) => { saved = value; return { ...baseUser, mustChangePassword: false }; } }));
  await assert.rejects(service.changePassword({ user: baseUser, tokenHash: "hash", currentPassword: "errada", newPassword: "SenhaNova123" }), /invalid_current_password/);
  const user = await service.changePassword({ user: baseUser, tokenHash: "hash", currentPassword: "SenhaAntiga123", newPassword: "SenhaNova123" });
  assert.equal(user.mustChangePassword, false); assert.equal(await (await import("../server/auth-password.js")).verifyPassword("SenhaNova123", saved.passwordHash), true);
});

test("operações administrativas validam papel, e-mail, UUID e senha temporária", async () => {
  let created; const service = createAuthService(repository({ createUser: async (value) => { created = value; return baseUser; } }));
  await service.createUser({ name: " Atendente ", email: " ATENDENTE@CEDIPI.COM ", role: "attendant", temporaryPassword: "Temporaria123" }, baseUser);
  assert.equal(created.email, "atendente@cedipi.com"); assert.equal(created.passwordHash.includes("Temporaria123"), false);
  await assert.rejects(service.createUser({ name: "A", email: "ruim", role: "owner", temporaryPassword: "curta" }, baseUser), /invalid_password/);
  assert.throws(() => service.updateUser("inválido", { active: false }, baseUser), /invalid_user_id/);
  assert.throws(() => service.updateUser(baseUser.id, {}, baseUser), /empty_update/);
});
