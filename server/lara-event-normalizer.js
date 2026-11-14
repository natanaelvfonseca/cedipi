import { normalizeIndividualConversationId } from "./whatsapp-phone.js";

const MAX_TEXT_LENGTH = 4096;
const MAX_MESSAGE_ID_LENGTH = 200;

export function normalizeEvolutionMessage(payload, expectedInstance = "Cedipi") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (String(payload.event ?? "").toLowerCase().replaceAll("_", ".") !== "messages.upsert") return null;
  const instance = payload.instance ?? payload.instanceName;
  if (instance !== expectedInstance) return null;
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const key = data.key ?? {};
  const rawId = key.id;
  if (key.fromMe !== false || typeof rawId !== "string" || !rawId ||
    rawId.length > MAX_MESSAGE_ID_LENGTH) return null;
  const primaryJid = key.remoteJid ?? data.remoteJid ?? "";
  // Evolution sends modern 1:1 chats as @lid. Use its verified
  // remoteJidAlt (the E.164 counterpart), never guess a phone from a LID.
  if (/@g\.us$|@broadcast$/i.test(primaryJid)) return null;
  const identity = normalizeIndividualConversationId(primaryJid)
    ?? (/@lid$/i.test(primaryJid)
      ? normalizeIndividualConversationId(key.remoteJidAlt ?? data.remoteJidAlt ?? "")
      : null);
  if (!identity) return null; // Reject unresolvable LIDs and non-individuals.
  const message = data.message?.ephemeralMessage?.message ?? data.message ?? {};
  const content = message.conversation ?? message.extendedTextMessage?.text ?? null;
  if (typeof content !== "string") return null;
  const text = content.trim();
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  return { instance, messageId: rawId, remoteJid: identity.remoteJid,
    phone: identity.phone, text };
}
