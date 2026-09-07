import assert from "node:assert/strict";
import test from "node:test";
import { reservePendingAppointment } from "../server/appointments-repository.js";

const doctorId = "a2bda31d-618b-49f1-9aa5-b1bab002fcbd";
const slotId = "11111111-2222-3333-4444-555555555555";

function fakePool(patientId) {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM doctors")) return { rows: [{ id: doctorId, name: "Danilo", active: true }] };
      if (sql.includes("FROM doctor_availability")) return { rows: [{
        id: slotId,
        doctor_id: doctorId,
        starts_at: new Date("2026-09-09T12:00:00.000Z"),
        ends_at: new Date("2026-09-09T12:20:00.000Z"),
        status: "available",
        in_schedule: true,
      }] };
      if (sql.includes("FROM appointments")) return { rows: [] };
      if (sql.includes("INSERT INTO patients")) return { rows: [{
        id: patientId,
        name: "Paciente",
        phone: "5547999999999",
      }] };
      if (sql.includes("INSERT INTO appointments")) return { rows: [{
        id: "appointment-1",
        status: "pending",
        exam_name: "Exame",
        starts_at: new Date("2026-09-09T12:00:00.000Z"),
        ends_at: new Date("2026-09-09T12:20:00.000Z"),
      }] };
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { async connect() { return client; } }, queries };
}

for (const [description, patientId] of [
  ["patient novo", "new-patient-id"],
  ["patient existente pelo telefone", "existing-patient-id"],
]) {
  test(`reserva pending com ${description}`, async () => {
    const { pool, queries } = fakePool(patientId);
    const result = await reservePendingAppointment({
      doctorId,
      slotId,
      patient: { name: "Paciente", phone: "5547999999999", email: null },
      exam: "Exame",
    }, pool);
    assert.equal(result.outcome, "created");
    assert.equal(result.appointment.status, "pending");
    assert.equal(result.appointment.patient.id, patientId);
    assert.equal(queries.some((sql) => sql.includes("ON CONFLICT (phone) DO UPDATE")), true);
    assert.equal(queries.some((sql) => sql.includes("FOR UPDATE")), true);
  });
}
