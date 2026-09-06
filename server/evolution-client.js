const defaultTimeoutMs = 15_000;

export class EvolutionApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "EvolutionApiError";
    this.status = status;
  }
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} não está configurada.`);
  }
  return value;
}

export function normalizeWhatsAppStatus(value) {
  switch (String(value ?? "").toLowerCase()) {
    case "open":
    case "connected":
      return "connected";
    case "close":
    case "disconnected":
      return "disconnected";
    case "connecting":
      return "connecting";
    default:
      return "unknown";
  }
}

export function extractQrCode(payload) {
  const value = payload?.base64 ?? payload?.qrcode?.base64 ?? payload?.qrCode ?? null;
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

export function createEvolutionClient({
  baseUrl = requireEnvironment("EVOLUTION_API_URL"),
  apiKey = requireEnvironment("EVOLUTION_API_KEY"),
  instanceName = requireEnvironment("EVOLUTION_INSTANCE_NAME"),
  timeoutMs = defaultTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  async function request(path) {
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        headers: { apikey: apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new EvolutionApiError("Evolution API indisponível.", 503);
    }

    if (!response.ok) {
      throw new EvolutionApiError(
        `Evolution API respondeu com HTTP ${response.status}.`,
        response.status,
      );
    }

    return response.json();
  }

  async function getInstance() {
    const payload = await request("/instance/fetchInstances");
    const instances = Array.isArray(payload) ? payload : payload?.instances ?? payload?.data ?? [];
    const instance = instances.find(
      (candidate) => (candidate?.name ?? candidate?.instance?.instanceName) === instanceName,
    );

    if (!instance) {
      throw new EvolutionApiError(`Instância ${instanceName} não encontrada.`, 404);
    }
    return instance;
  }

  async function getConnectionState(routeInstanceName = instanceName) {
    return request(`/instance/connectionState/${encodeURIComponent(routeInstanceName)}`);
  }

  async function getQrCode(routeInstanceName = instanceName) {
    return request(`/instance/connect/${encodeURIComponent(routeInstanceName)}`);
  }

  return { getInstance, getConnectionState, getQrCode };
}
