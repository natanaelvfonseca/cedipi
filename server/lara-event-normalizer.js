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
  const identity = normalizeIndividualConversationId(key.remoteJid ?? data.remoteJid ?? "");
  if (!identity) return null; // No groups, broadcast or unsupported LID.
  const message = data.message?.ephemeralMessage?.message ?? data.message ?? {};
  const content = message.conversation ?? message.extendedTextMessage?.text ?? null;
  if (typeof content !== "string") return null;
  const text = content.trim();
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  return { instance, messageId: rawId, remoteJid: identity.remoteJid,
    phone: identity.phone, text };
}
