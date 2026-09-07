import type { WhatsAppStatus } from "./whatsapp-status";

export type WhatsAppInstance = {
  name: string;
  status: WhatsAppStatus;
  connected: boolean;
  phoneNumber: string | null;
  profileName: string | null;
};

export class WhatsAppInstanceApiError extends Error {
  constructor() {
    super("whatsapp_instance_request_failed");
    this.name = "WhatsAppInstanceApiError";
  }
}

const whatsappStatuses: WhatsAppStatus[] = ["connected", "disconnected", "connecting", "qr_required", "unknown"];

async function requestJson(
  url: string,
  options: RequestInit,
  fetchImpl: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new WhatsAppInstanceApiError();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WhatsAppInstanceApiError();
  }
  if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true) {
    throw new WhatsAppInstanceApiError();
  }
  return payload as Record<string, unknown>;
}

export async function getWhatsAppInstance(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppInstance> {
  const payload = await requestJson("/api/whatsapp/instance", { signal }, fetchImpl);
  if (!("instance" in payload) || !payload.instance || typeof payload.instance !== "object") {
    throw new WhatsAppInstanceApiError();
  }

  const instance = payload.instance as Record<string, unknown>;
  if (typeof instance.status !== "string" || !whatsappStatuses.includes(instance.status as WhatsAppStatus)) {
    throw new WhatsAppInstanceApiError();
  }

  const rawName = typeof instance.name === "string" ? instance.name : instance.instanceName;
  return {
    name: typeof rawName === "string" && rawName.trim() ? rawName.trim() : "Cedipi",
    status: instance.status as WhatsAppStatus,
    connected: instance.connected === true,
    phoneNumber: typeof instance.phoneNumber === "string" && instance.phoneNumber.trim() ? instance.phoneNumber.trim() : null,
    profileName: typeof instance.profileName === "string" && instance.profileName.trim() ? instance.profileName.trim() : null,
  };
}

export async function connectWhatsAppInstance(fetchImpl: typeof fetch = fetch) {
  const payload = await requestJson("/api/whatsapp/instance/connect", { method: "POST" }, fetchImpl);
  if (payload.status === "connected" && payload.connected === true && payload.qrCode === null) {
    return { status: "connected" as const, connected: true as const, qrCode: null };
  }
  if (payload.status === "qr_required" && payload.connected === false && typeof payload.qrCode === "string" && payload.qrCode.startsWith("data:image/")) {
    return { status: "qr_required" as const, connected: false as const, qrCode: payload.qrCode };
  }
  throw new WhatsAppInstanceApiError();
}

export async function disconnectWhatsAppInstance(fetchImpl: typeof fetch = fetch) {
  const payload = await requestJson("/api/whatsapp/instance/disconnect", { method: "POST" }, fetchImpl);
  if (payload.status !== "disconnected") throw new WhatsAppInstanceApiError();
  return { status: "disconnected" as const };
}

export function formatWhatsAppPhone(phoneNumber: string | null) {
  if (!phoneNumber) return null;
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return digits ? `+${digits}` : null;
}
