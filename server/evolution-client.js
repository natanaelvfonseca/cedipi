const defaultTimeoutMs = 15_000;
const cedipiInstanceName = "Cedipi";

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
  if (instanceName !== cedipiInstanceName) {
    throw new EvolutionApiError("A instância Evolution configurada é inválida.", 503);
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  function requireCedipiInstance(routeInstanceName) {
    if (routeInstanceName !== cedipiInstanceName) {
      throw new EvolutionApiError("A instância Evolution solicitada é inválida.", 400);
    }
    return encodeURIComponent(routeInstanceName);
  }

  async function request(path, { method = "GET", payload } = {}) {
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method,
        headers: {
          apikey: apiKey,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
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

    try {
      return await response.json();
    } catch {
      throw new EvolutionApiError("Evolution API retornou uma resposta inválida.", 502);
    }
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
    return request(`/instance/connectionState/${requireCedipiInstance(routeInstanceName)}`);
  }

  async function getQrCode(routeInstanceName = instanceName) {
    return request(`/instance/connect/${requireCedipiInstance(routeInstanceName)}`);
  }

  async function logoutInstance(routeInstanceName = instanceName) {
    return request(`/instance/logout/${requireCedipiInstance(routeInstanceName)}`, {
      method: "DELETE",
    });
  }

  async function findChats() {
    return request(`/chat/findChats/${cedipiInstanceName}`, {
      method: "POST",
      payload: {},
    });
  }

  async function findMessages(remoteJid, { page = 1, offset = 100 } = {}) {
    return request(`/chat/findMessages/${cedipiInstanceName}`, {
      method: "POST",
      payload: {
        where: { key: { remoteJid, remoteJidAlt: remoteJid } },
        page,
        offset,
      },
    });
  }

  async function getMediaFromMessage(message) {
    return request(`/chat/getBase64FromMediaMessage/${cedipiInstanceName}`, {
      method: "POST",
      payload: { message },
    });
  }

  async function sendText(number, text) {
    return request(`/message/sendText/${cedipiInstanceName}`, {
      method: "POST",
      payload: { number, text },
    });
  }

  return {
    getInstance,
    getConnectionState,
    getQrCode,
    logoutInstance,
    findChats,
    findMessages,
    getMediaFromMessage,
    sendText,
  };
}
