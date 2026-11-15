import { readFileSync } from "node:fs";

export function readOpenAiApiKey({
  envKey = process.env.OPENAI_API_KEY,
  secretPath = process.env.OPENAI_API_KEY_FILE ?? "/run/secrets/cedipi_openai_api_key",
} = {}) {
  if (typeof envKey === "string" && envKey.trim()) return envKey.trim();
  try {
    const value = readFileSync(secretPath, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}
