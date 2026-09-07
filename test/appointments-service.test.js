import assert from "node:assert/strict";
import test from "node:test";
import {
  AppointmentReservationError,
} from "../server/appointments-repository.js";
import {
  AppointmentError,
  createAppointmentsService,
} from "../server/appointments-service.js";
import { N8nAgendaError } from "../server/n8n-agenda-client.js";

const request = {
  doctorId: "a2bda31d-618b-49f1-9aa5-b1bab002fcbd",
  slotId: "11111111-2222-3333-4444-555555555555",
  patient: { name: "Paciente", phone: "5547999999999", email: null },
  exam: "Exame",
};

const pending = {
  id: "appointment-1",
  status: "pending",
  exam: "Exame",
  startsAt: "2026-09-09T12:00:00.000Z",
  endsAt: "2026-09-09T12:20:00.000Z",
  doctor: { id: request.doctorId, name: "Danilo" },
  patient: { id: "patient-1", name: "Paciente", phone: "5547999999999" },
};

function createdReservation() {
  return {
    outcome: "created",
    appointment: pending,
    slot: {
      id: request.slotId,
      startsAt: pending.startsAt,
      endsAt: pending.endsAt,
    },
  };
}

function successfulN8n(overrides = {}) {
  return {
    status: "agendado",
    googleEventId: "google-event-1",
    googleCalendarId: "google-calendar-1",
    start: "2026-09-09T09:00:00-03:00",
    end: "2026-09-09T09:20:00-03:00",
    ...overrides,
  };
}

test("cria pending antes do n8n, confirma e persiste identificadores Google", async () => {
  let pendingCreated = false;
  let confirmation;
  const service = createAppointmentsService({
    reserve: async () => { pendingCreated = true; return createdReservation(); },
    schedule: async (payload) => {
      assert.equal(pendingCreated, true);
      assert.deepEqual(payload, {
        doctor: "Danilo",
        doctorId: request.doctorId,
        slotId: request.slotId,
        start: pending.startsAt,
        name: "Paciente",
        phone: "5547999999999",
        exam: "Exame",
      });
      return successfulN8n();
    },
    confirm: async (values) => {
      confirmation = values;
      return { id: pending.id, status: "confirmed" };
    },
    fail: async () => assert.fail("não deve falhar"),
  });

  const result = await service.createAppointment(request);
  assert.equal(result.created, true);
  assert.equal(result.appointment.status, "confirmed");
  assert.equal(result.appointment.start, "2026-09-09T09:00:00-03:00");
  assert.deepEqual(confirmation, {
    appointmentId: pending.id,
    googleEventId: "google-event-1",
    googleCalendarId: "google-calendar-1",
    startsAt: "2026-09-09T09:00:00-03:00",
    endsAt: "2026-09-09T09:20:00-03:00",
  });
  assert.equal("googleEventId" in result.appointment, false);
  assert.equal("googleCalendarId" in result.appointment, false);
});

for (const [repositoryCode, expectedStatus] of [
  ["doctor_not_found", 404],
  ["doctor_unavailable", 409],
  ["slot_not_found", 404],
  ["slot_doctor_mismatch", 409],
  ["slot_unavailable", 409],
  ["slot_in_past", 409],
  ["slot_blocked", 409],
]) {
  test(`mapeia ${repositoryCode}`, async () => {
    const service = createAppointmentsService({
      reserve: async () => { throw new AppointmentReservationError(repositoryCode); },
    });
    await assert.rejects(service.createAppointment(request), (error) => {
      assert.equal(error instanceof AppointmentError, true);
      assert.equal(error.code, repositoryCode);
      assert.equal(error.status, expectedStatus);
      return true;
    });
  });
}

test("recusa slot já ocupado localmente sem chamar n8n", async () => {
  let n8nCalls = 0;
  const service = createAppointmentsService({
    reserve: async () => ({ outcome: "occupied" }),
    schedule: async () => { n8nCalls += 1; },
  });
  await assert.rejects(
    service.createAppointment(request),
    (error) => error.code === "slot_already_occupied" && error.status === 409,
  );
  assert.equal(n8nCalls, 0);
});

for (const status of ["ocupado", "erro"]) {
  test(`marca failed quando n8n retorna ${status}`, async () => {
    const failures = [];
    const service = createAppointmentsService({
      reserve: async () => createdReservation(),
      schedule: async () => ({ status }),
      confirm: async () => assert.fail("não deve confirmar"),
      fail: async (...values) => failures.push(values),
    });
    await assert.rejects(service.createAppointment(request), (error) => {
      assert.equal(error.status, status === "ocupado" ? 409 : 502);
      return true;
    });
    assert.deepEqual(failures, [[pending.id, status]]);
  });
}

test("falha do client n8n deixa appointment como failed", async () => {
  const failures = [];
  const service = createAppointmentsService({
    reserve: async () => createdReservation(),
    schedule: async () => { throw new N8nAgendaError("secret", { code: "n8n_timeout", status: 504 }); },
    fail: async (...values) => failures.push(values),
  });
  await assert.rejects(service.createAppointment(request), (error) => error.code === "n8n_timeout");
  assert.deepEqual(failures, [[pending.id, "n8n_timeout"]]);
});

test("repetição confirmada é idempotente e não chama n8n", async () => {
  let n8nCalls = 0;
  const service = createAppointmentsService({
    reserve: async () => ({
      outcome: "idempotent",
      appointment: { ...pending, status: "confirmed" },
    }),
    schedule: async () => { n8nCalls += 1; },
  });
  const result = await service.createAppointment(request);
  assert.equal(result.created, false);
  assert.equal(result.appointment.status, "confirmed");
  assert.equal(n8nCalls, 0);
});

test("duas tentativas concorrentes no slot fazem somente uma chamada n8n", async () => {
  let reserved = false;
  let n8nCalls = 0;
  let releaseN8n;
  const n8nGate = new Promise((resolve) => { releaseN8n = resolve; });
  const service = createAppointmentsService({
    reserve: async () => {
      if (reserved) return { outcome: "in_progress", appointment: pending };
      reserved = true;
      return createdReservation();
    },
    schedule: async () => { n8nCalls += 1; await n8nGate; return successfulN8n(); },
    confirm: async () => ({ id: pending.id, status: "confirmed" }),
  });

  const first = service.createAppointment(request);
  const second = service.createAppointment(request);
  await assert.rejects(second, (error) => error.code === "appointment_in_progress");
  releaseN8n();
  await first;
  assert.equal(n8nCalls, 1);
});
