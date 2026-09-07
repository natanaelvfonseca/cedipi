import assert from "node:assert/strict";
import test from "node:test";
import {
  createPostAppointmentHandler,
  normalizePhone,
  parseCreateAppointmentBody,
} from "../server/appointments-handlers.js";
import { N8nAgendaError } from "../server/n8n-agenda-client.js";

function responseRecorder() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("normaliza telefone e valida payload mínimo", () => {
  assert.equal(normalizePhone("+55 (47) 99999-9999"), "5547999999999");
  assert.deepEqual(parseCreateAppointmentBody({
    doctorId: "a2bda31d-618b-49f1-9aa5-b1bab002fcbd",
    slotId: "11111111-2222-0333-4444-555555555555",
    patient: { name: " Paciente ", phone: "+55 (47) 99999-9999" },
    exam: " Exame ",
  }), {
    doctorId: "a2bda31d-618b-49f1-9aa5-b1bab002fcbd",
    slotId: "11111111-2222-0333-4444-555555555555",
    patient: { name: "Paciente", phone: "5547999999999", email: null },
    exam: "Exame",
  });
});

test("POST retorna 201 sem expor identificadores Google", async () => {
  const response = responseRecorder();
  const appointment = {
    id: "appointment-1",
    status: "confirmed",
    doctor: { id: "doctor-1", name: "Danilo" },
    patient: { id: "patient-1", name: "Paciente", phone: "5547999999999" },
    exam: "Exame",
    start: "2026-09-09T09:00:00-03:00",
    end: "2026-09-09T09:20:00-03:00",
  };
  const handler = createPostAppointmentHandler({
    async createAppointment() { return { created: true, appointment }; },
  });
  await handler({ body: {
    doctorId: "a2bda31d-618b-49f1-9aa5-b1bab002fcbd",
    slotId: "11111111-2222-3333-4444-555555555555",
    patient: { name: "Paciente", phone: "5547999999999" },
    exam: "Exame",
  } }, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, { ok: true, appointment });
  assert.equal(JSON.stringify(response.body).includes("googleEventId"), false);
  assert.equal(JSON.stringify(response.body).includes("googleCalendarId"), false);
});

test("POST não expõe segredo em resposta ou log", async () => {
  const response = responseRecorder();
  const handler = createPostAppointmentHandler({
    async createAppointment() {
      throw new N8nAgendaError("private-secret", { code: "n8n_upstream_error", status: 502 });
    },
  });
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logs.push(values);
  try {
    await handler({ body: {
      doctorId: "a2bda31d-618b-49f1-9aa5-b1bab002fcbd",
      slotId: "11111111-2222-3333-4444-555555555555",
      patient: { name: "Paciente", phone: "5547999999999" },
      exam: "Exame",
    } }, response);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(response.body, { ok: false, error: "n8n_upstream_error" });
  assert.equal(JSON.stringify(response.body).includes("private-secret"), false);
  assert.equal(JSON.stringify(logs).includes("private-secret"), false);
});
