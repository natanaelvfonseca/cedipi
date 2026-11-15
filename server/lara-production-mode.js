import { createLaraWorker } from "./lara-worker-service.js";
import { readOpenAiApiKey } from "./openai-credentials.js";
import { readLaraWebhookSecret } from "./lara-webhook-secret.js";
import { createLaraEvolutionWebhook } from "./lara-evolution-webhook.js";

const required = {
  LARA_TEST_MODE: "false",
  LARA_INGEST_ENABLED: "true",
  LARA_OUTBOUND_ENABLED: "true",
  LARA_CUTOVER_CONFIRMED: "true",
  CEDIPI_AI_CONTROL_BACKEND: "database",
  CEDIPI_APPOINTMENTS_BACKEND: "native",
  LARA_MEDIA_ANALYSIS_ENABLED: "true",
  EVOLUTION_INSTANCE_NAME: "Cedipi",
};
const state = {
  enabled: false, startedAt: null, lastTickAt: null,
  lastResult: null, errors: 0, replies: 0, handoffs: 0, workers: 0,
  webhookHealthy: false, webhookCheckedAt: null,
};

export function getLaraProductionStatus() { return {...state}; }

export function validateLaraProductionConfig(env = process.env, {
  readKey = readOpenAiApiKey,
  readSecret = readLaraWebhookSecret,
} = {}) {
  const missing = Object.entries(required)
    .filter(([name,value]) => env[name] !== value)
    .map(([name]) => name);
  if (missing.length) throw new Error("Invalid production flags: "+missing.join(","));
  if (!readKey() || !readSecret()) throw new Error("Missing OpenAI/webhook credentials");
  if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY)
    throw new Error("Evolution API not configured");
  try {
    const target = new URL(env.LARA_WEBHOOK_TARGET_URL ?? "");
    if (target.protocol !== "https:" ||
        target.pathname !== "/api/webhooks/evolution/lara")
      throw new Error("Wrong target");
  } catch {
    throw new Error("Invalid production HTTPS webhook target");
  }
  return true;
}

export function startLaraProductionMode({
  env = process.env,
  log = console,
  workerFactory = () => createLaraWorker(),
  workerCount = 3,
  intervalMs = 1500,
} = {}) {
  validateLaraProductionConfig(env);
  const count = Math.max(1, Math.min(4, workerCount));
  const workers = Array.from({length: count}, () => workerFactory());
  const busy = Array(count).fill(false);
  let stopped = false;
  state.enabled = true;
  state.startedAt = new Date().toISOString();
  state.workers = count;

  const tick = async (index) => {
    if (stopped || busy[index]) return;
    busy[index] = true;
    try {
      const result = await workers[index].runOnce();
      state.lastTickAt = new Date().toISOString();
      state.lastResult = result?.status ?? "unknown";
      if (result?.status === "sent") state.replies++;
      if (result?.status === "handed_off") state.handoffs++;
      if (["manual_review","retry_pending","configuration_error"].includes(result?.status)) {
        state.errors++;
        log.warn("Lara production worker status: " + result.status);
      }
    } catch {
      state.errors++;
      log.error("Lara worker error; patient details withheld");
    } finally {
      busy[index] = false;
    }
  };
  const timer = setInterval(() => {
    for (let i=0; i<count; i++) void tick(i);
  }, Math.max(1000, intervalMs));
  timer.unref?.();
  for (let i=0; i<count; i++) void tick(i);
  const manager = env.LARA_WEBHOOK_AUTO_REPAIR === "true"
    ? createLaraEvolutionWebhook() : null;
  let checking = false;
  const checkWebhook = async () => {
    if (stopped || checking || !manager) return;
    checking = true;
    try {
      const result = await manager.repairOnce();
      state.webhookHealthy = result.healthy;
      state.webhookCheckedAt = new Date().toISOString();
      if (result.repaired) log.warn("Lara restored missing Evolution webhook.");
    } catch {
      state.webhookHealthy = false;
      state.errors++;
      log.error("Lara webhook unavailable; patient details withheld.");
    } finally { checking = false; }
  };
  const monitor = manager ? setInterval(()=>void checkWebhook(),60000) : null;
  monitor?.unref?.();
  void checkWebhook();
  log.info("Lara production workers enabled.");
  return () => {
    stopped = true;
    clearInterval(timer);
    if (monitor) clearInterval(monitor);
    state.enabled = false;
  };
}
