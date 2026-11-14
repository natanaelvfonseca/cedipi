import { createEvolutionClient } from "./evolution-client.js";
import { canLaraReply, setConversationAiEnabled } from "./ai-conversation-control-repository.js";
import { createLaraModel, composeLaraReply } from "./lara-response.js";
import { createCedipiClinicalAssistant } from "./cedipi-clinical-assistant.js";
import * as repository from "./lara-inbox-repository.js";

function publicStatus(status) {
  return { status };
}

/**
 * A worker processes exactly one phone per durable lease. An uncertain delivery
 * is quarantined for manual reconciliation, never automatically resent.
 */
export function createLaraWorker({
  enabled = process.env.LARA_OUTBOUND_ENABLED === "true",
  cutoverConfirmed = process.env.LARA_CUTOVER_CONFIRMED === "true",
  controlBackend = process.env.CEDIPI_AI_CONTROL_BACKEND ?? "n8n",
  allowedPhone = process.env.LARA_TEST_MODE === "true" ? process.env.LARA_TEST_PHONE : null,
  repo = repository,
  canReply = canLaraReply,
  setEnabled = setConversationAiEnabled,
  model = createLaraModel(),
  clinicalAssistant = createCedipiClinicalAssistant(),
  evolutionFactory = createEvolutionClient,
} = {}) {
  async function runOnce() {
    if (!enabled || !cutoverConfirmed || controlBackend !== "database") {
      return publicStatus("disabled");
    }
    const job = await repo.claimNextLaraJob();
    if (!job) return publicStatus("idle");
    let released = false;
    const release = async (seconds = 0) => {
      await repo.releaseLaraLease(job, undefined, seconds);
      released = true;
    };
    let batch = [];
    try {
      batch = await repo.claimLaraBatch(job);
      if (!batch.length) {
        await release();
        return publicStatus("empty");
      }

      // An opt-in test may NEVER send to a different patient.
      if (allowedPhone && job.phone !== allowedPhone) {
        await repo.markLaraSuppressed(job, "test_allowlist");
        await release();
        return publicStatus("not_allowlisted");
      }

      if (!await canReply(job.phone)) {
        await repo.markLaraSuppressed(job, "ai_paused");
        await release();
        return publicStatus("paused");
      }

      const clinical = await clinicalAssistant.answer({ phone: job.phone, batch });
      let reply;
      if (clinical) {
        reply = clinical;
        if (clinical.handoffReason) {
          await repo.createLaraHandoff(job.phone, clinical.handoffReason);
        }
      } else {
        const text = batch.map((item) => item.body).join("\n").slice(-3000);
        const history = await repo.latestLaraHistory(job.phone);
        const sources = await repo.relevantLaraKnowledge(text);
        reply = await composeLaraReply({
          batch, history, sources, model,
          handoff: async (reason) => repo.createLaraHandoff(job.phone, reason),
        });
      }

      // Avoid stale responses when a new text arrives mid-generation.
      const newer = await repo.hasNewerPendingMessages(job);
      if (newer !== false) {
        await repo.requeueLaraBatch(job, undefined, { retry: false });
        await release(5);
        return publicStatus("deferred");
      }
      if (!await canReply(job.phone)) {
        await repo.markLaraSuppressed(job, "ai_paused");
        await release();
        return publicStatus("paused");
      }
      if (await repo.countRecentLaraReplies(job.phone) >= 20) {
        await repo.createLaraHandoff(job.phone, "rate_limit");
        await repo.markLaraSuppressed(job, "rate_limit");
        await release();
        return publicStatus("rate_limited");
      }

      if (!await repo.prepareLaraSend(job)) {
        await repo.requeueLaraBatch(job, undefined, { retry: false });
        await release(5);
        return publicStatus("deferred");
      }

      // After human handoff, disable auto-replies before attempting delivery.
      // A failed WhatsApp request must not reactivate the bot.
      if (reply.handoffReason) {
        try {
          await setEnabled(job.phone, false);
        } catch {
          await repo.markLaraDeliveryUncertain(job, "handoff_pause_failed");
          await release();
          return publicStatus("manual_review");
        }
      }

      let sent;
      try {
        sent = await evolutionFactory().sendText(job.phone, reply.text);
      } catch {
        // This could have reached WhatsApp. Do not retry automatically.
        await repo.markLaraDeliveryUncertain(job, "delivery_uncertain");
        await repo.createLaraHandoff(job.phone, "delivery_uncertain");
        await setEnabled(job.phone, false);
        await release();
        return publicStatus("manual_review");
      }
      const outboundId = sent?.key?.id ?? sent?.data?.key?.id ?? null;
      if (typeof outboundId !== "string" || !outboundId) {
        await repo.markLaraDeliveryUncertain(job, "delivery_ack_missing");
        await repo.createLaraHandoff(job.phone, "delivery_ack_missing");
        await setEnabled(job.phone, false);
        await release();
        return publicStatus("manual_review");
      }
      try {
        await repo.finishLaraDelivery(job, batch, reply.text, outboundId);
      } catch {
        // Message may already have reached the patient. No resends.
        await repo.markLaraDeliveryUncertain(job, "confirmation_uncertain");
        await repo.createLaraHandoff(job.phone, "confirmation_uncertain");
        await setEnabled(job.phone, false);
        await release();
        return publicStatus("manual_review");
      }
      await release();
      return publicStatus(reply.handoffReason ? "handed_off" : "sent");
    } catch (error) {
      // If an outbound send was attempted, the row is in 'sending', which
      // requeueLaraBatch deliberately does not touch.
      try {
        if (batch.length) {
          await repo.requeueLaraBatch(job, undefined,
            { retry: true, code: "processing_failed" });
          if (batch.some((item) => item.attempts >= 3)) {
            await repo.createLaraHandoff(job.phone, "processing_failed");
            await setEnabled(job.phone, false);
          }
        }
        if (!released) await release(Math.min(120, 15 * (batch[0]?.attempts ?? 1)));
      } catch { /* DB unavailable: lease will expire for recovery */ }
      if (error?.code === "lara_openai_not_configured") {
        return publicStatus("configuration_error");
      }
      return publicStatus("retry_pending");
    }
  }
  return { runOnce };
}
