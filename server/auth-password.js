import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 64;
const parameters = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function validatePassword(password) {
  return typeof password === "string" && password.length >= 10 && password.length <= 128;
}

export async function hashPassword(password) {
  if (!validatePassword(password)) throw new Error("invalid_password");
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, keyLength, parameters);
  return `scrypt$${parameters.N}$${parameters.r}$${parameters.p}$${salt}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, storedHash) {
  try {
    const [algorithm, rawN, rawR, rawP, salt, encodedHash] = String(storedHash).split("$");
    if (algorithm !== "scrypt" || !salt || !encodedHash) return false;
    const expected = Buffer.from(encodedHash, "base64url");
    if (expected.length !== keyLength) return false;
    const actual = Buffer.from(await scrypt(password, salt, expected.length, {
      N: Number(rawN), r: Number(rawR), p: Number(rawP), maxmem: 64 * 1024 * 1024,
    }));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
