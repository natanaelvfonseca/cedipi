import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppointmentPayload,
  createN8nAgendaClient,
  N8nAgendaError,
  normalizeAvailabilityResponse,
  normalizeAppointmentResponse,
} from "../server/n8n-agenda-client.js";

const input = {
  date: "2026-09-09",
  doctor: "Wagner",
  doctorId: "8418eb24-bb4a-45e6-89ec-5cfaf22cf446",
  period: "",
  after: "",
};

const currentWorkflowResponse = {
  ok: true,
  status: "disponivel",
  medico: "Danilo",
  data: "2026-09-09",
  horario: "09:00",
  start: "2026-09-09T09:00:00-03:00",
  end: "2026-09-09T09:20:00-03:00",
  response: "Próximo horário disponível: 09/09/2026 às 09:00 com Dr. Danilo.",
};

const normalizedCurrentWorkflowResponse = {
  available: true,
  slots: [{
    doctor: "Danilo",
    date: "2026-09-09",
    time: "09:00",
    start: "2026-09-09T09:00:00-03:00",
    end: "2026-09-09T09:20:00-03:00",
  }],
  message: "Próximo horário disponível: 09/09/2026 às 09:00 com Dr. Danilo.",
};

test("envia o contrato atual e os aliases antigos sem incluir o segredo no payload", async () => {
  let request;
  const client = createN8nAgendaClient({
    webhookUrl: "https://n8n.example/webhook/agendas",
    webhookSecret: "private-secret",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ available: true, slots: ["14:00"] });
    },
  });

  await client.checkAvailability(input);
  const payload = JSON.parse(request.options.body);

  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["x-cedipi-agenda-secret"], "private-secret");
  assert.deepEqual(payload, {
    evento: "verificacao",
    source: "panel",
    date: "2026-09-09",
    doctor: "Wagner",
    doctorId: "8418eb24-bb4a-45e6-89ec-5cfaf22cf446",
    period: "",
    after: "",
    dia: "2026-09-09",
    medico: "Wagner",
    periodo: "",
    apos: "",
  });
  assert.equal(request.options.body.includes("private-secret"), false);
});

test("trata timeout sem revelar configuração", async () => {
  const client = createN8nAgendaClient({
    webhookUrl: "https://n8n.example/webhook/agendas",
    webhookSecret: "private-secret",
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    timeoutMs: 5,
  });

  await assert.rejects(client.checkAvailability(input), (error) => {
    assert.equal(error.code, "n8n_timeout");
    assert.equal(JSON.stringify(error).includes("private-secret"), false);
    return true;
  });
});

test("trata erro de rede como indisponibilidade", async () => {
  const client = createN8nAgendaClient({
    webhookUrl: "https://n8n.example/webhook/agendas",
    webhookSecret: "private-secret",
    fetchImpl: async () => { throw new TypeError("connection refused"); },
  });

  await assert.rejects(client.checkAvailability(input), (error) => {
    assert.equal(error.code, "n8n_unavailable");
    assert.equal(error.status, 502);
    return true;
  });
});

for (const status of [401, 403]) {
  test(`trata HTTP ${status} como falha de autenticação`, async () => {
    const client = createN8nAgendaClient({
      webhookUrl: "https://n8n.example/webhook/agendas",
      webhookSecret: "private-secret",
      fetchImpl: async () => new Response("unauthorized", { status }),
    });

    await assert.rejects(client.checkAvailability(input), (error) => {
      assert.equal(error.code, "n8n_authentication_failed");
      assert.equal(error.upstreamStatus, status);
      return true;
    });
  });
}

test("trata HTTP 500 sem repassar o corpo externo", async () => {
  const client = createN8nAgendaClient({
    webhookUrl: "https://n8n.example/webhook/agendas",
    webhookSecret: "private-secret",
    fetchImpl: async () => new Response("internal details", { status: 500 }),
  });

  await assert.rejects(client.checkAvailability(input), (error) => {
    assert.equal(error.code, "n8n_upstream_error");
    assert.equal(error.upstreamStatus, 500);
    assert.equal(error.message.includes("internal details"), false);
    return true;
  });
});

test("normaliza resposta válida do workflow", async () => {
  const client = createN8nAgendaClient({
    webhookUrl: "https://n8n.example/webhook/agendas",
    webhookSecret: "private-secret",
    fetchImpl: async () => Response.json({
      disponivel: true,
      horarios: ["14:00", "14:20"],
      mensagem: "Horários encontrados",
    }),
  });

  assert.deepEqual(await client.checkAvailability(input), {
    available: true,
    slots: ["14:00", "14:20"],
    message: "Horários encontrados",
  });
});

test("normaliza disponibilidade atual do AGENDAS dentro de array", () => {
  assert.deepEqual(
    normalizeAvailabilityResponse([currentWorkflowResponse]),
    normalizedCurrentWorkflowResponse,
  );
});

test("normaliza disponibilidade atual do AGENDAS como objeto direto", () => {
  assert.deepEqual(
    normalizeAvailabilityResponse(currentWorkflowResponse),
    normalizedCurrentWorkflowResponse,
  );
});

test("normaliza sem_horario e preserva response como message", () => {
  assert.deepEqual(normalizeAvailabilityResponse([{
    ok: true,
    status: "sem_horario",
    medico: "Danilo",
    data: "2026-09-09",
    response: "Não há horários disponíveis.",
  }]), {
    available: false,
    slots: [],
    message: "Não há horários disponíveis.",
  });
});

test("resposta desconhecida não vira indisponibilidade silenciosa", () => {
  assert.throws(
    () => normalizeAvailabilityResponse([{ ok: true, status: "formato_novo" }]),
    (error) => {
      assert.equal(error.code, "n8n_invalid_response");
      assert.equal(error.status, 502);
      return true;
    },
  );
});

test("remove o segredo caso o serviço externo tente devolvê-lo", async () => {
  const client = createN8nAgendaClient({
    webhookUrl: "https://n8n.example/webhook/agendas",
    webhookSecret: "private-secret",
    fetchImpl: async () => Response.json({
      available: true,
      slots: [{ time: "14:00", diagnostic: "private-secret" }],
      message: "received private-secret",
    }),
  });

  const result = await client.checkAvailability(input);
  assert.equal(JSON.stringify(result).includes("private-secret"), false);
});

test("falha de configuração usa erro sanitizado", () => {
  const previousUrl = process.env.N8N_AGENDA_WEBHOOK_URL;
  const previousSecret = process.env.N8N_AGENDA_WEBHOOK_SECRET;
  delete process.env.N8N_AGENDA_WEBHOOK_URL;
  delete process.env.N8N_AGENDA_WEBHOOK_SECRET;
  try {
    assert.throws(() => createN8nAgendaClient(), (error) => {
      assert.equal(error instanceof N8nAgendaError, true);
      assert.equal(error.code, "n8n_not_configured");
      assert.equal(error.status, 503);
      return true;
    });
  } finally {
    if (previousUrl === undefined) delete process.env.N8N_AGENDA_WEBHOOK_URL;
    else process.env.N8N_AGENDA_WEBHOOK_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.N8N_AGENDA_WEBHOOK_SECRET;
    else process.env.N8N_AGENDA_WEBHOOK_SECRET = previousSecret;
  }
});

test("envia contrato de agendamento com segredo somente no header", async () => {
  let request;
  const client = createN8nAgendaClient({
    webhookUrl: "https://n8n.example/webhook/agendas",
    webhookSecret: "private-secret",
    fetchImpl: async (_url, options) => {
      request = options;
      return Response.json({ status: "agendado", googleEventId: "event-1" });
    },
  });
  const appointmentInput = {
    doctor: "Danilo",
    doctorId: "a2bda31d-618b-49f1-9aa5-b1bab002fcbd",
    slotId: "11111111-2222-3333-4444-555555555555",
    start: "2026-09-09T12:00:00.000Z",
    name: "Paciente",
    phone: "5547999999999",
    exam: "Exame",
  };

  await client.createAppointment(appointmentInput);

  assert.deepEqual(JSON.parse(request.body), buildAppointmentPayload(appointmentInput));
  assert.equal(request.headers["x-cedipi-agenda-secret"], "private-secret");
  assert.equal(request.body.includes("private-secret"), false);
});

test("normaliza agendamento e rejeita status desconhecido", () => {
  assert.deepEqual(normalizeAppointmentResponse([{
    status: "agendado",
    googleEventId: "event-1",
    googleCalendarId: "calendar-1",
    start: "2026-09-09T09:00:00-03:00",
    end: "2026-09-09T09:20:00-03:00",
    response: "Agendado",
  }]), {
    status: "agendado",
    googleEventId: "event-1",
    googleCalendarId: "calendar-1",
    slotId: null,
    doctorId: null,
    source: null,
    start: "2026-09-09T09:00:00-03:00",
    end: "2026-09-09T09:20:00-03:00",
    message: "Agendado",
  });
  assert.throws(
    () => normalizeAppointmentResponse({ status: "unexpected" }),
    (error) => error.code === "n8n_invalid_response",
  );
});
