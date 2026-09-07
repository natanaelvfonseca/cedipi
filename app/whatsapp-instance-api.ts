import type { WhatsAppStatus } from "./whatsapp-status";

export type WhatsAppInstance = {
  name: string;
  status: WhatsAppStatus;
  connected: boolean;
  phoneNumber: string | null;
};

export class WhatsAppInstanceApiError extends Error {
  constructor() {
    super("whatsapp_instance_request_failed");
    this.name = "WhatsAppInstanceApiError";
  }
}

const whatsappStatuses: WhatsAppStatus[] = ["connected", "disconnected", "connecting", "unknown"];

export async function getWhatsAppInstance(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppInstance> {
  let response: Response;
  try {
    response = await fetchImpl("/api/whatsapp/instance", { signal });
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

  if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true || !("instance" in payload) || !payload.instance || typeof payload.instance !== "object") {
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
  };
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
