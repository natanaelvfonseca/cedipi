const defaultTimeoutMs = 15_000;

export class N8nAgendaError extends Error {
  constructor(message, { code, status, upstreamStatus } = {}) {
    super(message);
    this.name = "N8nAgendaError";
    this.code = code ?? "n8n_error";
    this.status = status ?? 502;
    this.upstreamStatus = upstreamStatus;
  }
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new N8nAgendaError("Integração com a agenda n8n não configurada.", {
      code: "n8n_not_configured",
      status: 503,
    });
  }
  return value;
}

/**
 * Contract sent to the AGENDAS webhook. The legacy fields are temporary aliases:
 * dia=date, medico=doctor, periodo=period and apos=after.
 */
export function buildAvailabilityPayload({ date, doctor, doctorId, period, after }) {
  return {
    evento: "verificacao",
    source: "panel",
    date,
    doctor: doctor ?? "",
    doctorId: doctorId ?? "",
    period: period ?? "",
    after: after ?? "",
    dia: date,
    medico: doctor ?? "",
    periodo: period ?? "",
    apos: after ?? "",
  };
}

function redactSecret(value, secret) {
  if (!secret) return value;
  if (typeof value === "string") return value.replaceAll(secret, "[redacted]");
  if (Array.isArray(value)) return value.map((item) => redactSecret(item, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSecret(item, secret)]),
    );
  }
  return value;
}

function invalidAvailabilityResponse() {
  throw new N8nAgendaError("Resposta inválida do webhook de agenda.", {
    code: "n8n_invalid_response",
    status: 502,
  });
}

function responseMessage(data, secret) {
  const message = typeof data.response === "string"
    ? data.response
    : typeof data.message === "string"
      ? data.message
      : typeof data.mensagem === "string"
        ? data.mensagem
        : null;
  return redactSecret(message, secret);
}

function normalizeCurrentWorkflowResponse(data, secret) {
  if (data.status === "sem_horario") {
    return {
      available: false,
      slots: [],
      message: responseMessage(data, secret),
    };
  }

  if (data.status !== "disponivel") return null;

  const requiredSlotFields = ["medico", "data", "horario", "start", "end"];
  if (requiredSlotFields.some((field) => (
    typeof data[field] !== "string" || data[field].length === 0
  ))) {
    invalidAvailabilityResponse();
  }

  return {
    available: true,
    slots: [redactSecret({
      doctor: data.medico,
      date: data.data,
      time: data.horario,
      start: data.start,
      end: data.end,
    }, secret)],
    message: responseMessage(data, secret),
  };
}

export function normalizeAvailabilityResponse(payload, secret = "") {
  const body = Array.isArray(payload) ? payload[0] : payload;
  const data = body?.data && typeof body.data === "object" ? body.data : body;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    invalidAvailabilityResponse();
  }

  const currentWorkflowResponse = normalizeCurrentWorkflowResponse(data, secret);
  if (currentWorkflowResponse) return currentWorkflowResponse;

  const slots = data.slots ?? data.availability ?? data.horarios;
  const hasAvailabilityFlag = typeof data.available === "boolean"
    || typeof data.disponivel === "boolean";

  if (!Array.isArray(slots) && !hasAvailabilityFlag) {
    invalidAvailabilityResponse();
  }

  const normalizedSlots = Array.isArray(slots) ? slots : [];

  return {
    available: typeof data.available === "boolean"
      ? data.available
      : typeof data.disponivel === "boolean"
        ? data.disponivel
        : normalizedSlots.length > 0,
    slots: redactSecret(normalizedSlots, secret),
    message: responseMessage(data, secret),
  };
}

export function createN8nAgendaClient({
  webhookUrl = requireEnvironment("N8N_AGENDA_WEBHOOK_URL"),
  webhookSecret = requireEnvironment("N8N_AGENDA_WEBHOOK_SECRET"),
  timeoutMs = defaultTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  async function checkAvailability(input) {
    const payload = buildAvailabilityPayload(input);
    let response;

    try {
      response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cedipi-agenda-secret": webhookSecret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new N8nAgendaError("Tempo limite do webhook de agenda excedido.", {
          code: "n8n_timeout",
          status: 504,
        });
      }
      throw new N8nAgendaError("Webhook de agenda indisponível.", {
        code: "n8n_unavailable",
        status: 502,
      });
    }

    if (!response.ok) {
      const authenticationFailed = response.status === 401 || response.status === 403;
      throw new N8nAgendaError(
        authenticationFailed
          ? "Autenticação com o webhook de agenda recusada."
          : "Webhook de agenda respondeu com erro.",
        {
          code: authenticationFailed ? "n8n_authentication_failed" : "n8n_upstream_error",
          status: 502,
          upstreamStatus: response.status,
        },
      );
    }

    let responsePayload;
    try {
      responsePayload = await response.json();
    } catch {
      throw new N8nAgendaError("Resposta inválida do webhook de agenda.", {
        code: "n8n_invalid_response",
        status: 502,
      });
    }

    return normalizeAvailabilityResponse(responsePayload, webhookSecret);
  }

  return { checkAvailability };
}

export function checkAvailability(input) {
  return createN8nAgendaClient().checkAvailability(input);
}
