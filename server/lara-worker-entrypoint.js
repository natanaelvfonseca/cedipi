import { closeDatabasePool } from "./database.js";
import { createLaraWorker } from "./lara-worker-service.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const worker = createLaraWorker();
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
while (!stopping) {
  try {
    const outcome = await worker.runOnce();
    // No personal data or message content in logs.
    if (outcome.status === "retry_pending" || outcome.status === "manual_review") {
      console.warn("Lara worker: " + outcome.status);
    }
    await delay(outcome.status === "idle" ? 3000 : 1500);
  } catch {
    console.error("Lara worker: backend indisponivel");
    await delay(5000);
  }
}
await closeDatabasePool();
