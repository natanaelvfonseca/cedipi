export type WhatsAppConversation = {
  id: string;
  phone: string;
  name: string;
  profilePictureUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
};

export type WhatsAppMessage = {
  id: string | null;
  fromMe: boolean;
  type: "text" | "audio" | "image" | "document";
  text: string | null;
  timestamp: string | null;
  status: string | null;
};

export type WhatsAppMessagesPage = {
  messages: WhatsAppMessage[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};

export class WhatsAppInboxApiError extends Error {
  constructor() {
    super("whatsapp_inbox_request_failed");
    this.name = "WhatsAppInboxApiError";
  }
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new WhatsAppInboxApiError();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WhatsAppInboxApiError();
  }

  if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true) {
    throw new WhatsAppInboxApiError();
  }
  return payload as T;
}

export async function getWhatsAppConversations(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const payload = await requestJson<{ ok: true; conversations: WhatsAppConversation[] }>(
    "/api/whatsapp/conversations",
    { signal },
    fetchImpl,
  );
  if (!Array.isArray(payload.conversations)) throw new WhatsAppInboxApiError();
  return payload.conversations;
}

export async function getWhatsAppMessages(
  conversationId: string,
  cursor?: string | null,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  const payload = await requestJson<{ ok: true } & WhatsAppMessagesPage>(
    `/api/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
    { signal },
    fetchImpl,
  );
  if (!Array.isArray(payload.messages) || typeof payload.pagination?.hasMore !== "boolean"
    || (payload.pagination.nextCursor !== null && typeof payload.pagination.nextCursor !== "string")) {
    throw new WhatsAppInboxApiError();
  }
  return { messages: payload.messages, pagination: payload.pagination };
}

export function whatsappMessageMediaUrl(conversationId: string, messageId: string) {
  return `/api/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/media`;
}

export async function getWhatsAppMessageMedia(
  conversationId: string,
  messageId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetchImpl(whatsappMessageMediaUrl(conversationId, messageId), { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new WhatsAppInboxApiError();
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!response.ok || !contentType || contentType === "application/json") throw new WhatsAppInboxApiError();
  const media = await response.blob();
  if (!media.size) throw new WhatsAppInboxApiError();
  return media;
}

export async function sendWhatsAppMessage(
  conversationId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
) {
  const payload = await requestJson<{ ok: true; message: WhatsAppMessage }>(
    `/api/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    },
    fetchImpl,
  );
  return payload.message;
}

export async function getConversationAiControl(
  phone: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const payload = await requestJson<{ ok: true; enabled: boolean }>(
    `/api/whatsapp/conversations/${encodeURIComponent(phone)}/ai-control`,
    { signal },
    fetchImpl,
  );
  if (typeof payload.enabled !== "boolean") throw new WhatsAppInboxApiError();
  return payload.enabled;
}

export async function patchConversationAiControl(
  phone: string,
  enabled: boolean,
  fetchImpl: typeof fetch = fetch,
) {
  const payload = await requestJson<{ ok: true; enabled: boolean }>(
    `/api/whatsapp/conversations/${encodeURIComponent(phone)}/ai-control`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
    fetchImpl,
  );
  if (typeof payload.enabled !== "boolean") throw new WhatsAppInboxApiError();
  return payload.enabled;
}
