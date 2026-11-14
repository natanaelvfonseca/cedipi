import { createLaraTestPoller } from "./lara-test-poller.js";
import { createLaraWorker } from "./lara-worker-service.js";

/**
 * Separate, explicit test mode. A strict allowlist and a fixed LID JID
 * protect existing patients while the original n8n webhook remains in place.
 */
export function startLaraTestMode({
  poller = createLaraTestPoller(),
  worker = createLaraWorker({
    enabled: true,
    cutoverConfirmed: true,
    controlBackend: "database",
    allowedPhone: process.env.LARA_TEST_PHONE,
  }),
  log = console,
  pollEveryMs = 6000,
} = {}) {
  if (process.env.LARA_TEST_MODE !== "true") return () => {};
  if (process.env.LARA_INGEST_ENABLED === "true" ||
      process.env.LARA_OUTBOUND_ENABLED === "true" ||
      process.env.LARA_CUTOVER_CONFIRMED === "true") {
    throw new Error("Lara test mode must not run alongside global native cutover");
  }

  let stopped = false;
  let running = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      try {
        await poller.pollOnce();
      } catch {
        log.warn("Lara test mode: failed to read Evolution inbox");
      }
      try {
        const outcome = await worker.runOnce();
        if (["manual_review","configuration_error","retry_pending"].includes(outcome.status)) {
          log.warn("Lara test mode: " + outcome.status);
        }
      } catch {
        log.warn("Lara test mode: worker unavailable");
      }
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => { void tick(); }, pollEveryMs);
  timer.unref();
  void tick();
  log.info("Lara test mode active for one allowlisted contact.");
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
