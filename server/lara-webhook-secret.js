import { readFileSync } from "node:fs";

export function readLaraWebhookSecret({
  envSecret=process.env.LARA_WEBHOOK_SECRET,
  path=process.env.LARA_WEBHOOK_SECRET_FILE??"/run/secrets/cedipi_lara_webhook_secret",
}={}) {
  if (typeof envSecret==="string" && envSecret.length>=32) return envSecret;
  try {
    const value=readFileSync(path,"utf8").trim();
    return value.length>=32?value:null;
  } catch {
    return null;
  }
}
