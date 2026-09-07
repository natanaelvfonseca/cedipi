import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, validatePassword, verifyPassword } from "../server/auth-password.js";

test("senha usa scrypt com salt e nunca é armazenada em texto puro", async () => {
  const first = await hashPassword("SenhaSegura123");
  const second = await hashPassword("SenhaSegura123");
  assert.match(first, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(first.includes("SenhaSegura123"), false);
  assert.equal(await verifyPassword("SenhaSegura123", first), true);
  assert.equal(await verifyPassword("senha-incorreta", first), false);
});

test("senha exige no mínimo 10 caracteres e limita entradas excessivas", () => {
  assert.equal(validatePassword("123456789"), false);
  assert.equal(validatePassword("1234567890"), true);
  assert.equal(validatePassword("x".repeat(129)), false);
});
