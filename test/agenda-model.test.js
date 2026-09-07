import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acquireSubmissionLock,
  appointmentErrorMessage,
  availableSlotsForAppointments,
  buildCreateAppointmentPayload,
  selectionFromSlot,
  slotLocalParts,
  zonedDateTimeParts,
} from "../app/agenda-model.ts";

const slot = {
  id: "slot-real-id",
  doctor: { id: "doctor-real-id", name: "Médico API" },
  startsAt: "2026-09-09T12:00:00.000Z",
  endsAt: "2026-09-09T12:20:00.000Z",
  startsAtLocal: "2026-09-09T09:00:00",
  endsAtLocal: "2026-09-09T09:20:00",
  status: "available",
  source: "import",
  notes: null,
};

test("preserva 09:00 local para slots e timestamps UTC", () => {
  assert.deepEqual(slotLocalParts(slot), {
    date: "2026-09-09",
    time: "09:00",
    endTime: "09:20",
  });
  assert.deepEqual(zonedDateTimeParts("2026-09-09T12:00:00.000Z"), {
    date: "2026-09-09",
    time: "09:00",
  });
});

test("seleção do slot guarda doctorId e slotId reais", () => {
  assert.deepEqual(selectionFromSlot(slot), {
    doctorId: "doctor-real-id",
    slotId: "slot-real-id",
  });
});

test("monta payload do POST e normaliza somente o telefone", () => {
  assert.deepEqual(buildCreateAppointmentPayload(slot, {
    name: " Paciente ",
    phone: "+55 (47) 99999-9999",
    email: " paciente@example.com ",
    exam: " Exame ",
  }), {
    doctorId: "doctor-real-id",
    slotId: "slot-real-id",
    patient: {
      name: "Paciente",
      phone: "5547999999999",
      email: "paciente@example.com",
    },
    exam: "Exame",
  });
});

test("impede uma segunda submissão enquanto a primeira está ativa", () => {
  const lock = { current: false };
  assert.equal(acquireSubmissionLock(lock), true);
  assert.equal(acquireSubmissionLock(lock), false);
});

test("remove da disponibilidade slots ocupados por appointment ativo", () => {
  const appointments = [{
    doctor: slot.doctor,
    startsAt: slot.startsAt,
    status: "confirmed",
  }];
  assert.deepEqual(availableSlotsForAppointments([slot], appointments), []);
  assert.deepEqual(availableSlotsForAppointments([], []), []);
});

test("bloqueado e booked nunca aparecem como horários de novo agendamento", () => {
  assert.deepEqual(availableSlotsForAppointments([
    { ...slot, status: "blocked" },
    { ...slot, id: "booked", status: "booked" },
  ], []), []);
});

test("conflito recebe mensagem amigável", () => {
  assert.equal(
    appointmentErrorMessage("slot_already_occupied"),
    "Este horário acabou de ficar indisponível. A agenda foi atualizada.",
  );
});

test("Agenda não contém pacientes, médicos ou horários mockados antigos", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const mock of ["Maria Oliveira", "Ana Paula Santos", "Carlos Mendes", "initialAppointments", "const doctors:"]) {
    assert.equal(source.includes(mock), false);
  }
});
