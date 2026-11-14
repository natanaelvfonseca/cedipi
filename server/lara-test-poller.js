import { createEvolutionClient } from "./evolution-client.js";
import { enqueueLaraMessage } from "./lara-inbox-repository.js";
import { normalizeEvolutionMessage } from "./lara-event-normalizer.js";

const PHONE_PATTERN = /^55[0-9]{10,11}$/;
const JID_PATTERN = /^[0-9]{8,30}@(lid|s\.whatsapp\.net|c\.us)$/;

/**
 * Opt-in test bridge for ONE real WhatsApp contact. Evolution's global webhook
 * stays with the existing n8n receptionist; this polls only a single known
 * conversation so the new Lara cannot affect other patients.
 */
export function createLaraTestPoller({
  phone = process.env.LARA_TEST_PHONE,
  remoteJid = process.env.LARA_TEST_REMOTE_JID,
  minTimestamp = Number(process.env.LARA_TEST_MIN_TIMESTAMP),
  instance = process.env.EVOLUTION_INSTANCE_NAME ?? "Cedipi",
  client = createEvolutionClient(),
  enqueue = enqueueLaraMessage,
} = {}) {
  if (!PHONE_PATTERN.test(phone ?? "") || !JID_PATTERN.test(remoteJid ?? "") ||
      !Number.isSafeInteger(minTimestamp) || minTimestamp < 1_600_000_000 ||
      minTimestamp > Math.floor(Date.now() / 1000) + 60 ||
      instance !== "Cedipi") {
    throw new Error("Lara test mode: invalid phone, JID, timestamp or instance");
  }

  async function pollOnce() {
    const payload = await client.findMessages(remoteJid, { page: 1, offset: 30 });
    const records = payload?.messages?.records;
    if (!Array.isArray(records)) {
      throw new Error("Lara test mode: Evolution records unavailable");
    }
    // Evolution may save outgoing replies in the E.164 chat, while incoming
    // texts appear in the LID chat. Check both before answering.
    const phoneJid = phone + "@s.whatsapp.net";
    const outboundPayload = remoteJid === phoneJid
      ? payload : await client.findMessages(phoneJid, { page: 1, offset: 30 });
    const outboundRecords = outboundPayload?.messages?.records;
    if (!Array.isArray(outboundRecords)) {
      throw new Error("Lara test mode: outbound history unavailable");
    }
    let accepted = 0, duplicates = 0;
    // Do not add a bot reply when a human or the legacy workflow has
    // already answered the inbound message in either WhatsApp addressing mode.
    const latestOutbound = [...records, ...outboundRecords].reduce((max, record) => (
      record?.key?.fromMe === true
        ? Math.max(max, Number(record.messageTimestamp) || 0) : max
    ), 0);
    const eligible = records.filter((record) =>
      Number(record?.messageTimestamp) >= minTimestamp &&
      Number(record?.messageTimestamp) > latestOutbound &&
      record?.key?.fromMe === false
    ).sort((a,b) => Number(a.messageTimestamp) - Number(b.messageTimestamp));
    for (const record of eligible) {
      const event = normalizeEvolutionMessage({
        event: "messages.upsert", instance, data: record,
      }, instance);
      if (!event || event.phone !== phone) continue;
      const result = await enqueue(event);
      if (result.duplicate) duplicates++; else accepted++;
    }
    return { accepted, duplicates };
  }
  return { pollOnce };
}
