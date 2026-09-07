import { createEvolutionClient, EvolutionApiError } from "./evolution-client.js";
import { createN8nAiControlClient, N8nAiControlError } from "./n8n-ai-control-client.js";
import { normalizeIndividualConversationId } from "./whatsapp-phone.js";

export class WhatsAppConversationError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = "WhatsAppConversationError";
    this.code = code;
    this.status = status;
  }
}

function pageFromMessages(payload) {
  if (Array.isArray(payload)) return { records: payload, pages: 1, currentPage: 1 };
  const messages = payload?.messages ?? payload?.data ?? payload;
  if (Array.isArray(messages)) return { records: messages, pages: 1, currentPage: 1 };
  if (Array.isArray(messages?.records)) {
    const pages = Number.isInteger(messages.pages) && messages.pages > 0 ? messages.pages : 1;
    const currentPage = Number.isInteger(messages.currentPage) && messages.currentPage > 0
      ? messages.currentPage
      : 1;
    return { records: messages.records, pages, currentPage };
  }
  throw new WhatsAppConversationError("evolution_invalid_response");
}

function chatsFromPayload(payload) {
  const chats = Array.isArray(payload) ? payload : payload?.chats ?? payload?.data;
  if (!Array.isArray(chats)) throw new WhatsAppConversationError("evolution_invalid_response");
  return chats;
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : /^\d+$/.test(String(value)) ? Number(value) : null;
  const date = numeric === null
    ? new Date(value)
    : new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function messageKind(record) {
  const type = String(record?.messageType ?? "").toLowerCase();
  const message = record?.message ?? {};
  if (type.includes("audio") || message.audioMessage) return "audio";
  if (type.includes("image") || message.imageMessage) return "image";
  if (type.includes("document") || message.documentMessage || message.documentWithCaptionMessage) return "document";
  return "text";
}

function textFromMessage(record, type) {
  const message = record?.message ?? {};
  if (type === "audio") return null;
  if (type === "image") return message.imageMessage?.caption ?? null;
  if (type === "document") {
    const document = message.documentMessage ?? message.documentWithCaptionMessage?.message?.documentMessage
      ?? message.documentWithCaptionMessage;
    return document?.fileName ?? document?.name ?? document?.caption ?? null;
  }
  return message.conversation ?? message.extendedTextMessage?.text ?? record?.text ?? null;
}

export function normalizeMessage(record) {
  if (!record || typeof record !== "object") {
    throw new WhatsAppConversationError("evolution_invalid_response");
  }
  const type = messageKind(record);
  const updates = Array.isArray(record.MessageUpdate) ? record.MessageUpdate : [];
  return {
    id: typeof record.key?.id === "string" ? record.key.id : typeof record.id === "string" ? record.id : null,
    fromMe: record.key?.fromMe === true,
    type,
    text: textFromMessage(record, type),
    timestamp: isoTimestamp(record.messageTimestamp),
    status: typeof record.status === "string"
      ? record.status
      : typeof updates.at(-1)?.status === "string"
        ? updates.at(-1).status
        : null,
  };
}

function lastMessageSummary(lastMessage) {
  if (!lastMessage) return null;
  const message = normalizeMessage(lastMessage);
  if (message.text) return message.text;
  if (message.type === "audio") return "Áudio";
  if (message.type === "image") return "Imagem";
  if (message.type === "document") return "Documento";
  return null;
}

export function normalizeConversation(chat) {
  const identity = normalizeIndividualConversationId(chat?.remoteJid ?? chat?.id ?? "");
  if (!identity) return null;
  const profilePictureUrl = typeof chat.profilePicUrl === "string" && /^https?:\/\//.test(chat.profilePicUrl)
    ? chat.profilePicUrl
    : null;
  const lastMessageAt = isoTimestamp(chat.lastMessage?.messageTimestamp ?? chat.updatedAt);
  return {
    id: identity.remoteJid,
    phone: identity.phone,
    name: typeof chat.pushName === "string" && chat.pushName.trim() ? chat.pushName.trim() : identity.phone,
    profilePictureUrl,
    lastMessage: lastMessageSummary(chat.lastMessage),
    lastMessageAt,
    unreadCount: Number.isInteger(chat.unreadCount) && chat.unreadCount > 0 ? chat.unreadCount : 0,
  };
}

function mapExternalError(error) {
  if (error instanceof WhatsAppConversationError || error instanceof N8nAiControlError) return error;
  if (error instanceof EvolutionApiError) return new WhatsAppConversationError("evolution_unavailable", 502);
  return new WhatsAppConversationError("whatsapp_inbox_unavailable", 502);
}

const maximumMediaBytes = 50 * 1024 * 1024;
export const defaultMessagesLimit = 50;
export const maximumMessagesLimit = 100;
const cursorVersion = 1;

function encodeMessagesCursor({ page, limit, snapshot }) {
  return Buffer.from(JSON.stringify({ v: cursorVersion, p: page, l: limit, s: snapshot })).toString("base64url");
}

function decodeMessagesCursor(value, limit) {
  if (typeof value !== "string" || !value || value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new WhatsAppConversationError("invalid_cursor", 400);
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const snapshotDate = new Date(parsed?.s);
    if (parsed?.v !== cursorVersion || !Number.isInteger(parsed?.p) || parsed.p < 2
      || parsed?.l !== limit || Number.isNaN(snapshotDate.getTime())
      || snapshotDate.toISOString() !== parsed.s) {
      throw new Error("invalid cursor");
    }
    return { page: parsed.p, snapshot: parsed.s };
  } catch {
    throw new WhatsAppConversationError("invalid_cursor", 400);
  }
}

function messageRemoteJids(record) {
  return [record?.key?.remoteJid, record?.key?.remoteJidAlt, record?.remoteJid]
    .filter((value) => typeof value === "string");
}

function safeFileName(value, fallback) {
  const leaf = typeof value === "string" ? value.split(/[\\/]/).at(-1) : "";
  const cleaned = leaf
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 140);
  return cleaned || fallback;
}

function extensionFor(contentType) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "application/pdf": "pdf",
  }[contentType] ?? "bin";
}

function normalizedContentType(value) {
  if (typeof value !== "string") return null;
  const contentType = value.split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(contentType)
    ? contentType
    : null;
}

function mediaContentType(type, value) {
  const contentType = normalizedContentType(value);
  if (type === "image" && ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) return contentType;
  if (type === "audio" && contentType?.startsWith("audio/")) return contentType;
  if (type === "document" && contentType && !contentType.startsWith("text/html") && contentType !== "image/svg+xml") return contentType;
  throw new WhatsAppConversationError("unsupported_media", 415);
}

function decodeMediaBase64(value) {
  if (typeof value !== "string") throw new WhatsAppConversationError("media_unavailable", 502);
  const encoded = value.includes(",") && value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  const compact = encoded.replace(/\s/g, "");
  if (!compact || compact.length > Math.ceil(maximumMediaBytes * 4 / 3) + 4
    || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new WhatsAppConversationError("media_unavailable", 502);
  }
  const buffer = Buffer.from(compact, "base64");
  if (!buffer.length || buffer.length > maximumMediaBytes) {
    throw new WhatsAppConversationError("media_unavailable", 502);
  }
  return buffer;
}

async function findOwnedMessage(client, remoteJid, messageId) {
  let currentPage = 1;
  let totalPages = 1;
  do {
    const result = pageFromMessages(await client.findMessages(remoteJid, { page: currentPage, offset: 100 }));
    const record = result.records.find((candidate) => (
      (candidate?.key?.id ?? candidate?.id) === messageId
      && messageRemoteJids(candidate).includes(remoteJid)
    ));
    if (record) return record;
    totalPages = result.pages;
    currentPage += 1;
  } while (currentPage <= totalPages);
  throw new WhatsAppConversationError("media_not_found", 404);
}

export function createWhatsAppConversationsService({
  evolution,
  aiControl,
  now = () => new Date(),
} = {}) {
  const evolutionClient = () => evolution ?? createEvolutionClient();
  const aiControlClient = () => aiControl ?? createN8nAiControlClient();

  return {
    async listConversations() {
      try {
        const chats = chatsFromPayload(await evolutionClient().findChats());
        return chats
          .map(normalizeConversation)
          .filter(Boolean)
          .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
      } catch (error) {
        throw mapExternalError(error);
      }
    },

    async listMessages(remoteJid, { limit = defaultMessagesLimit, cursor = null } = {}) {
      try {
        if (!Number.isInteger(limit) || limit < 1 || limit > maximumMessagesLimit) {
          throw new WhatsAppConversationError("invalid_limit", 400);
        }
        const client = evolutionClient();
        const snapshot = cursor ? null : now().toISOString();
        const cursorData = cursor ? decodeMessagesCursor(cursor, limit) : { page: 1, snapshot };
        const result = pageFromMessages(await client.findMessages(remoteJid, {
          page: cursorData.page,
          offset: limit,
          ...(cursor ? { until: cursorData.snapshot } : {}),
        }));
        const uniqueRecords = [...new Map(result.records.map((record, index) => [
          record?.key?.id ?? record?.id ?? `record-${index}`,
          record,
        ])).values()];
        const messages = uniqueRecords
          .map(normalizeMessage)
          .sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? ""));
        const hasMore = cursorData.page < result.pages;
        return {
          messages,
          pagination: {
            hasMore,
            nextCursor: hasMore
              ? encodeMessagesCursor({ page: cursorData.page + 1, limit, snapshot: cursorData.snapshot })
              : null,
          },
        };
      } catch (error) {
        throw mapExternalError(error);
      }
    },

    async getMedia(remoteJid, messageId) {
      try {
        const client = evolutionClient();
        const record = await findOwnedMessage(client, remoteJid, messageId);
        const type = messageKind(record);
        if (type === "text") throw new WhatsAppConversationError("unsupported_media", 415);
        const payload = await client.getMediaFromMessage(record);
        const contentType = mediaContentType(type, payload?.mimetype);
        const fallbackName = `${messageId}.${extensionFor(contentType)}`;
        return {
          buffer: decodeMediaBase64(payload?.base64),
          contentType,
          fileName: safeFileName(
            payload?.fileName ?? (type === "document" ? textFromMessage(record, type) : null),
            fallbackName,
          ),
          disposition: type === "document" && contentType !== "application/pdf" ? "attachment" : "inline",
        };
      } catch (error) {
        if (error instanceof WhatsAppConversationError) throw error;
        if (error instanceof EvolutionApiError) throw new WhatsAppConversationError("media_unavailable", 502);
        throw new WhatsAppConversationError("media_unavailable", 502);
      }
    },

    async sendManualMessage({ remoteJid, phone, text }) {
      try {
        const enabled = await aiControlClient().setEnabled(phone, false);
        if (enabled !== false) throw new N8nAiControlError("ai_control_pause_not_confirmed");
        const sent = normalizeMessage(await evolutionClient().sendText(phone, text));
        return { ...sent, fromMe: true, type: "text", text };
      } catch (error) {
        throw mapExternalError(error);
      }
    },

    async getAiControl(phone) {
      try {
        return await aiControlClient().getStatus(phone);
      } catch (error) {
        throw mapExternalError(error);
      }
    },

    async setAiControl(phone, enabled) {
      try {
        return await aiControlClient().setEnabled(phone, enabled);
      } catch (error) {
        throw mapExternalError(error);
      }
    },
  };
}

function service() {
  return createWhatsAppConversationsService();
}

export const whatsappConversationsService = {
  listConversations: () => service().listConversations(),
  listMessages: (remoteJid, pagination) => service().listMessages(remoteJid, pagination),
  getMedia: (remoteJid, messageId) => service().getMedia(remoteJid, messageId),
  sendManualMessage: (input) => service().sendManualMessage(input),
  getAiControl: (phone) => service().getAiControl(phone),
  setAiControl: (phone, enabled) => service().setAiControl(phone, enabled),
};
