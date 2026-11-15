import { createHash, timingSafeEqual } from "node:crypto";
import { readLaraWebhookSecret } from "./lara-webhook-secret.js";
import { normalizeEvolutionMessage } from "./lara-event-normalizer.js";
import { enqueueLaraMessage } from "./lara-inbox-repository.js";

function tokenMatches(expected, received) {
  if (!expected || expected.length < 32 || typeof received !== "string") return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(received).digest();
  return timingSafeEqual(left, right);
}

export function createLaraWebhookHandler({
  enabled = process.env.LARA_INGEST_ENABLED === "true",
  secret = readLaraWebhookSecret(),
  activateAfter = Number(process.env.LARA_CUTOVER_UNIX_SECONDS || 0),
  expectedInstance = process.env.EVOLUTION_INSTANCE_NAME ?? "Cedipi",
  enqueue = enqueueLaraMessage,
} = {}) {
  return async function laraWebhook(request, response) {
    if (!enabled) {
      response.status(503).json({ ok: false, error: "lara_ingest_disabled" });
      return;
    }
    if (!tokenMatches(secret, request.get("x-cedipi-webhook-secret"))) {
      response.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const timestamp = Number(request.body?.data?.messageTimestamp);
    if (activateAfter > 0 && (!Number.isFinite(timestamp) || timestamp < activateAfter)) {
      response.status(202).json({ ok: true, ignored: true });
      return;
    }
    const event = normalizeEvolutionMessage(request.body, expectedInstance);
    if (!event) {
      response.status(202).json({ ok: true, ignored: true });
      return;
    }
    try {
      const result = await enqueue(event);
      response.status(202).json({ ok: true, duplicate: result.duplicate });
    } catch {
      // 503 causes Evolution to retry; unique keys make repeated webhooks safe.
      response.status(503).json({ ok: false, error: "lara_queue_unavailable" });
    }
  };
}
