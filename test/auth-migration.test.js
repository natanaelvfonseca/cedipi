import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../migrations/005_create_users_and_sessions.sql", import.meta.url), "utf8");
test("migration cria usuários, sessões por hash e auditoria", () => {
  assert.match(migration, /CREATE TABLE users/); assert.match(migration, /password_hash TEXT NOT NULL/);
  assert.match(migration, /role IN \('admin', 'attendant'\)/); assert.match(migration, /CREATE UNIQUE INDEX users_email_unique_idx ON users \(lower\(email\)\)/);
  assert.match(migration, /CREATE TABLE user_sessions/); assert.match(migration, /token_hash CHAR\(64\) NOT NULL UNIQUE/);
  assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/); assert.match(migration, /ON DELETE CASCADE/); assert.match(migration, /CREATE TABLE auth_audit_log/);
});
