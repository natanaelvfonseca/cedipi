import { createEvolutionClient, extractQrCode, normalizeWhatsAppStatus } from "./evolution-client.js";
import { saveWhatsAppInstance } from "./whatsapp-repository.js";

function configuredInstance() {
  if (!process.env.EVOLUTION_INSTANCE_NAME || !process.env.EVOLUTION_INSTANCE_ID) {
    throw new Error("Configuração da instância Evolution incompleta.");
  }
  return {
    name: process.env.EVOLUTION_INSTANCE_NAME,
    externalInstanceId: process.env.EVOLUTION_INSTANCE_ID,
  };
}

function phoneNumber(instance) {
  const value = instance?.number ?? instance?.ownerJid;
  return typeof value === "string" ? value.replace(/@.*$/, "") : null;
}

function stateValue(payload, instance) {
  return payload?.instance?.state ?? payload?.state ?? instance?.connectionStatus;
}

export async function syncWhatsAppInstance({
  client = createEvolutionClient(),
  save = saveWhatsAppInstance,
  now = () => new Date(),
} = {}) {
  const configured = configuredInstance();
  const evolutionInstance = await client.getInstance();
  const connection = await client.getConnectionState(configured.name);
  const status = normalizeWhatsAppStatus(stateValue(connection, evolutionInstance));
  const lastCheckedAt = now().toISOString();

  const instance = {
    ...configured,
    status,
    connected: status === "connected",
    phoneNumber: phoneNumber(evolutionInstance),
    profileName: evolutionInstance?.profileName ?? null,
    integrationType: evolutionInstance?.integration ?? null,
    lastCheckedAt,
  };

  await save(instance);
  return instance;
}

export async function connectWhatsAppInstance({
  client = createEvolutionClient(),
  save = saveWhatsAppInstance,
  now = () => new Date(),
} = {}) {
  const instance = await syncWhatsAppInstance({ client, save, now });
  if (instance.connected) {
    return { connected: true, qrCode: null };
  }
  if (instance.status === "unknown") {
    throw new Error("Não foi possível determinar o estado da instância.");
  }

  const payload = await client.getQrCode(instance.name);
  const qrCode = extractQrCode(payload);
  if (!qrCode) {
    throw new Error("Evolution API não retornou um QR Code.");
  }

  await save({ ...instance, status: "connecting", connected: false, lastCheckedAt: now().toISOString() });
  return { connected: false, qrCode };
}

export function publicInstance(instance) {
  return {
    name: instance.name,
    status: instance.status,
    connected: instance.connected,
    phoneNumber: instance.phoneNumber,
    profileName: instance.profileName,
    lastCheckedAt: instance.lastCheckedAt,
  };
}
