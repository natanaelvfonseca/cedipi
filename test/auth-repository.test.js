import assert from "node:assert/strict";
import test from "node:test";
import { AuthRepositoryError, createAuthRepository } from "../server/auth-repository.js";

const userRow = { id: "11111111-1111-4111-8111-111111111111", name: "Admin", email: "admin@cedipi.local", role: "admin", active: true, must_change_password: false, last_login_at: null, created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z" };

function transactionalPool(handler) {
  const calls = [];
  const client = { query: async (sql, values) => { calls.push({ sql, values }); return handler(sql, values, calls); }, release() {} };
  return { calls, pool: { connect: async () => client, query: client.query } };
}

test("desativar usuário invalida todas as suas sessões", async () => {
  const fake = transactionalPool(async (sql) => {
    if (sql.includes("SELECT id, role, active")) return { rows: [{ id: userRow.id, role: "attendant", active: true }] };
    if (sql.includes("UPDATE users SET")) return { rows: [{ ...userRow, role: "attendant", active: false }] };
    return { rows: [] };
  });
  const result = await createAuthRepository(fake.pool).updateUser({ userId: userRow.id, changes: { active: false }, actorUserId: "22222222-2222-4222-8222-222222222222", context: {} });
  assert.equal(result.active, false);
  assert.equal(fake.calls.some(({ sql }) => sql.includes("DELETE FROM user_sessions WHERE user_id")), true);
  assert.equal(fake.calls.some(({ sql, values }) => sql.includes("auth_audit_log") && values[0] === "user_disabled"), true);
});

test("administrador não pode se desativar", async () => {
  const fake = transactionalPool(async (sql) => sql.includes("SELECT id, role, active") ? { rows: [{ id: userRow.id, role: "admin", active: true }] } : { rows: [] });
  await assert.rejects(createAuthRepository(fake.pool).updateUser({ userId: userRow.id, changes: { active: false }, actorUserId: userRow.id, context: {} }), (error) => error instanceof AuthRepositoryError && error.code === "cannot_disable_self");
  assert.equal(fake.calls.some(({ sql }) => sql === "ROLLBACK;"), true);
});

test("último administrador ativo não pode perder seu papel", async () => {
  const fake = transactionalPool(async (sql) => {
    if (sql.includes("SELECT id, role, active")) return { rows: [{ id: userRow.id, role: "admin", active: true }] };
    if (sql.includes("WHERE role = 'admin' AND active = TRUE")) return { rows: [{ id: userRow.id }] };
    return { rows: [] };
  });
  await assert.rejects(createAuthRepository(fake.pool).updateUser({ userId: userRow.id, changes: { role: "attendant" }, actorUserId: "22222222-2222-4222-8222-222222222222", context: {} }), (error) => error instanceof AuthRepositoryError && error.code === "last_active_admin");
});

test("reset de senha exige troca e invalida todas as sessões", async () => {
  const fake = transactionalPool(async (sql) => sql.includes("UPDATE users SET password_hash") ? { rows: [{ ...userRow, must_change_password: true }] } : { rows: [] });
  const result = await createAuthRepository(fake.pool).resetPassword({ userId: userRow.id, passwordHash: "scrypt$hash", actorUserId: userRow.id, context: {} });
  assert.equal(result.mustChangePassword, true);
  assert.equal(fake.calls.some(({ sql }) => sql.includes("DELETE FROM user_sessions WHERE user_id")), true);
});

test("e-mail duplicado vira conflito seguro e transação é revertida", async () => {
  const duplicate = Object.assign(new Error("duplicate"), { code: "23505" });
  const fake = transactionalPool(async (sql) => { if (sql.includes("INSERT INTO users")) throw duplicate; return { rows: [] }; });
  await assert.rejects(createAuthRepository(fake.pool).createUser({ name: "A", email: "a@b.com", passwordHash: "hash", role: "attendant", actorUserId: userRow.id, context: {} }), (error) => error instanceof AuthRepositoryError && error.code === "email_already_exists" && error.status === 409);
  assert.equal(fake.calls.some(({ sql }) => sql === "ROLLBACK;"), true);
});

test("logout remove a sessão pelo hash e audita sem token", async () => {
  const fake = transactionalPool(async (sql) => sql.includes("DELETE FROM user_sessions") ? { rows: [{ user_id: userRow.id }] } : { rows: [] });
  await createAuthRepository(fake.pool).deleteSession("token-hash", {});
  assert.equal(fake.calls[0].values[0], "token-hash");
  const audit = fake.calls.find(({ sql }) => sql.includes("auth_audit_log"));
  assert.equal(JSON.stringify(audit.values).includes("token-hash"), false);
});
