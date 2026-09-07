import type { WhatsAppConversation, WhatsAppMessage } from "./whatsapp-api";

export const conversationsPollingMs = 10_000;
export const messagesPollingMs = 5_000;
export const whatsappDisplayTimezone = "America/Sao_Paulo";

function searchable(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function filterConversations(conversations: WhatsAppConversation[], query: string) {
  const normalizedQuery = searchable(query.trim());
  if (!normalizedQuery) return conversations;
  const phoneQuery = normalizedQuery.replace(/\D/g, "");
  return conversations.filter((conversation) => (
    searchable(conversation.name).includes(normalizedQuery)
    || (phoneQuery.length > 0 && conversation.phone.includes(phoneQuery))
  ));
}

export function sortMessages(messages: WhatsAppMessage[]) {
  return [...messages].sort((left, right) => (
    (left.timestamp ?? "").localeCompare(right.timestamp ?? "")
  ));
}

export function mergeMessages(current: WhatsAppMessage[], incoming: WhatsAppMessage[]) {
  const indexed = new Map<string, WhatsAppMessage>();
  [...current, ...incoming].forEach((message, index) => {
    indexed.set(message.id ?? `${message.timestamp ?? "unknown"}-${index}`, message);
  });
  return sortMessages([...indexed.values()]);
}

export function messagePresentation(message: WhatsAppMessage) {
  if (message.type === "audio") return { label: "Áudio recebido", detail: null };
  if (message.type === "image") return { label: "Imagem recebida", detail: message.text };
  if (message.type === "document") return { label: message.text || "Documento recebido", detail: null };
  return { label: null, detail: message.text };
}

export function messageSide(message: WhatsAppMessage) {
  return message.fromMe ? "cedipi" : "patient";
}

export function isSendableMessage(value: string) {
  return value.trim().length > 0;
}

export function formatMessageTime(timestamp: string | null) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: whatsappDisplayTimezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatConversationTime(timestamp: string | null, now = new Date()) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: whatsappDisplayTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: whatsappDisplayTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (dateKey === todayKey) return formatMessageTime(timestamp);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: whatsappDisplayTimezone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function conversationInitial(name: string, phone: string) {
  return (name || phone).trim().charAt(0).toUpperCase() || "?";
}

export function acquireConversationSendLock(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function acquireHistoryLoadLock(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function scrollTopAfterPrepend(
  snapshot: { scrollHeight: number; scrollTop: number },
  nextScrollHeight: number,
) {
  return snapshot.scrollTop + Math.max(0, nextScrollHeight - snapshot.scrollHeight);
}

export function isCurrentConversationResponse({
  selectedConversationId,
  requestedConversationId,
  requestVersion,
  currentVersion,
  aborted = false,
}: {
  selectedConversationId: string | null;
  requestedConversationId: string;
  requestVersion: number;
  currentVersion: number;
  aborted?: boolean;
}) {
  return !aborted && selectedConversationId === requestedConversationId && requestVersion === currentVersion;
}

export function shouldLoadOlderHistory(scrollTop: number, hasMore: boolean) {
  return hasMore && scrollTop < 120;
}

type PollingOptions = {
  task: () => Promise<void>;
  intervalMs: number;
  isVisible?: () => boolean;
  setIntervalImpl?: typeof globalThis.setInterval;
  clearIntervalImpl?: typeof globalThis.clearInterval;
};

export function startControlledPolling({
  task,
  intervalMs,
  isVisible = () => typeof document === "undefined" || document.visibilityState === "visible",
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
}: PollingOptions) {
  let inFlight = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || inFlight || !isVisible()) return;
    inFlight = true;
    try {
      await task();
    } finally {
      inFlight = false;
    }
  };
  const timer = setIntervalImpl(() => void tick(), intervalMs);
  return {
    tick,
    stop() {
      stopped = true;
      clearIntervalImpl(timer);
    },
  };
}
