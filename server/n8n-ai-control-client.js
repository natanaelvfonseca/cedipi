const defaultTimeoutMs = 15_000;

export class N8nAiControlError extends Error {
  constructor(code, status = 502, upstreamStatus) {
    super(code);
    this.name = "N8nAiControlError";
    this.code = code;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new N8nAiControlError("ai_control_not_configured", 503);
  return value;
}

export function normalizeIndividualAiControlResponse(payload) {
  const body = Array.isArray(payload) ? payload[0] : payload;
  const data = body?.data && typeof body.data === "object" ? body.data : body;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new N8nAiControlError("ai_control_invalid_response");
  }

  if (typeof data.enabled === "boolean") return data.enabled;
  const status = data.status ?? data.value ?? data.estado;
  if (status === "ativo") return true;
  if (status === "pausado") return false;
  throw new N8nAiControlError("ai_control_invalid_response");
}

export function createN8nAiControlClient({
  webhookUrl = requireEnvironment("N8N_AI_CONTROL_WEBHOOK_URL"),
  webhookSecret = requireEnvironment("N8N_AI_CONTROL_WEBHOOK_SECRET"),
  timeoutMs = defaultTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  async function request(payload) {
    let response;
    try {
      response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cedipi-ai-control-secret": webhookSecret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timeout = error?.name === "AbortError" || error?.name === "TimeoutError";
      throw new N8nAiControlError(timeout ? "ai_control_timeout" : "ai_control_unavailable", timeout ? 504 : 502);
    }

    if (!response.ok) {
      const authenticationFailed = response.status === 401 || response.status === 403;
      throw new N8nAiControlError(
        authenticationFailed ? "ai_control_authentication_failed" : "ai_control_upstream_error",
        502,
        response.status,
      );
    }

    let responsePayload;
    try {
      responsePayload = await response.json();
    } catch {
      throw new N8nAiControlError("ai_control_invalid_response");
    }
    return normalizeIndividualAiControlResponse(responsePayload);
  }

  return {
    getStatus(phone) {
      return request({ phone });
    },
    setEnabled(phone, enabled) {
      return request({ phone, enabled });
    },
  };
}
