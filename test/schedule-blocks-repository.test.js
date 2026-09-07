import assert from "node:assert/strict";
import test from "node:test";
import {
  createScheduleBlocks,
  removeScheduleBlocks,
  ScheduleBlockError,
} from "../server/schedule-blocks-repository.js";

const doctorId = "a2bda31d-618b-49f1-9aa5-b1bab002fcbd";
const userId = "b2bda31d-618b-49f1-9aa5-b1bab002fcbd";
const slots = ["09:00", "09:40", "14:20"].map((time, index) => ({
  id: `11111111-2222-4333-8444-55555555555${index}`,
  doctor_id: doctorId,
  starts_at: new Date(`2030-01-07T${String(12 + Math.floor(index / 2)).padStart(2, "0")}:00:00Z`),
  ends_at: new Date(`2030-01-07T${String(12 + Math.floor(index / 2)).padStart(2, "0")}:20:00Z`),
  status: "available",
  local_time: time,
}));

function fakePool({ selected = slots, occupied = [], blocked = [] } = {}) {
  const calls = [];
  let blockIndex = 0;
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM doctors")) return { rows: [{ id: doctorId, name: "Danilo", active: true }] };
      if (sql.includes("AS availability") && sql.includes("FOR UPDATE")) return { rows: selected };
      if (sql.includes("JOIN appointments")) return { rows: occupied };
      if (sql.includes("FROM doctor_schedule_blocks") && sql.includes("availability_id = ANY") && !sql.includes("FOR UPDATE")) return { rows: blocked };
      if (sql.includes("INSERT INTO doctor_schedule_blocks")) {
        const slot = selected[blockIndex++];
        return { rows: [{
          id: `21111111-2222-4333-8444-55555555555${blockIndex}`,
          doctor_id: doctorId, availability_id: slot.id, starts_at: slot.starts_at,
          ends_at: slot.ends_at, reason: parameters[4], created_by: parameters[5],
          created_at: new Date("2026-09-07T12:00:00Z"),
        }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { async connect() { return client; } }, calls };
}

test("bloqueia lote não consecutivo atomicamente e audita o usuário da sessão", async () => {
  const { pool, calls } = fakePool();
  const result = await createScheduleBlocks({
    doctorId, date: "2030-01-07", times: ["09:00", "09:40", "14:20"],
    reason: "Operação", actorUserId: userId,
  }, pool);
  assert.equal(result.length, 3);
  assert.equal(calls.filter((call) => call.sql.includes("INSERT INTO doctor_schedule_blocks")).length, 3);
  assert.equal(calls.some((call) => call.sql === "COMMIT;"), true);
  const audit = calls.find((call) => call.sql.includes("INSERT INTO auth_audit_log"));
  assert.equal(audit.parameters[0], "schedule_block_created");
  assert.equal(audit.parameters[1], userId);
  assert.deepEqual(JSON.parse(audit.parameters[2]).times, ["09:00", "09:40", "14:20"]);
});

for (const [description, options, expectedReason] of [
  ["fora da grade", { selected: slots.slice(0, 2) }, "outside_schedule"],
  ["com appointment ativo", { occupied: [{ slot_id: slots[0].id, local_time: "09:00" }] }, "appointment_exists"],
  ["já bloqueado", { blocked: [{ slot_id: slots[0].id, local_time: "09:00" }] }, "already_blocked"],
]) {
  test(`rejeita lote inteiro ${description}`, async () => {
    const { pool, calls } = fakePool(options);
    await assert.rejects(
      createScheduleBlocks({
        doctorId, date: "2030-01-07", times: ["09:00", "09:40", "14:20"],
        reason: null, actorUserId: userId,
      }, pool),
      (error) => error instanceof ScheduleBlockError
        && error.code === "slot_conflict"
        && error.conflicts.some((conflict) => conflict.reason === expectedReason),
    );
    assert.equal(calls.some((call) => call.sql.includes("INSERT INTO doctor_schedule_blocks")), false);
    assert.equal(calls.some((call) => call.sql === "ROLLBACK;"), true);
  });
}

test("desbloqueio preserva histórico e registra removed_by", async () => {
  const blockId = "31111111-2222-4333-8444-555555555551";
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM doctor_schedule_blocks") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: blockId, availability_id: slots[0].id, doctor_id: doctorId }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const result = await removeScheduleBlocks({ blockIds: [blockId], actorUserId: userId }, {
    async connect() { return client; },
  });
  assert.deepEqual(result, { removed: 1 });
  const removal = calls.find((call) => call.sql.includes("SET removed_at = NOW()"));
  assert.deepEqual(removal.parameters, [[blockId], userId]);
  assert.equal(calls.some((call) => call.sql.startsWith("DELETE FROM doctor_schedule_blocks")), false);
  assert.equal(calls.some((call) => call.sql.includes("status = 'available'")), true);
});
