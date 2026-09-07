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
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const payload = await requestJson<{ ok: true; messages: WhatsAppMessage[] }>(
    `/api/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages`,
    { signal },
    fetchImpl,
  );
  if (!Array.isArray(payload.messages)) throw new WhatsAppInboxApiError();
  return payload.messages;
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
