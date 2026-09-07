import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeleteScheduleBlocksHandler,
  createListScheduleBlocksHandler,
  createPostScheduleBlocksHandler,
} from "../server/schedule-blocks-handlers.js";

const doctorId = "a2bda31d-618b-49f1-9aa5-b1bab002fcbd";
const userId = "b2bda31d-618b-49f1-9aa5-b1bab002fcbd";
const blockId = "c2bda31d-618b-49f1-9aa5-b1bab002fcbd";

function responseRecorder() {
  return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("multi-bloqueio encaminha horários não consecutivos e usa created_by da sessão", async () => {
  let received;
  const response = responseRecorder();
  await createPostScheduleBlocksHandler(async (input) => { received = input; return [{ id: blockId }]; })({
    body: {
      doctorId, date: "2026-09-14", times: ["09:00", "09:40", "14:20"],
      reason: " Operação interna ", created_by: "nao-confiar",
    },
    auth: { user: { id: userId, role: "attendant" } },
  }, response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(received, {
    doctorId, date: "2026-09-14", times: ["09:00", "09:40", "14:20"],
    slotIds: undefined, reason: "Operação interna", actorUserId: userId,
  });
});

test("rejeita horário fora do formato e lote duplicado", async () => {
  for (const times of [["25:00"], ["14:00", "14:00"]]) {
    const response = responseRecorder();
    await createPostScheduleBlocksHandler(async () => { throw new Error("não deveria chamar"); })({
      body: { doctorId, date: "2026-09-14", times }, auth: { user: { id: userId } },
    }, response);
    assert.equal(response.statusCode, 400);
  }
});

test("lista por médico/data e desbloqueia lote com removed_by da sessão", async () => {
  let listInput;
  const listed = responseRecorder();
  await createListScheduleBlocksHandler(async (input) => { listInput = input; return []; })({
    query: { date: "2026-09-14", doctor: "Danilo" },
  }, listed);
  assert.deepEqual(listInput, { date: "2026-09-14", doctor: "Danilo" });

  let removeInput;
  const removed = responseRecorder();
  await createDeleteScheduleBlocksHandler(async (input) => { removeInput = input; return { removed: 1 }; })({
    body: { blockIds: [blockId], removed_by: "nao-confiar" }, auth: { user: { id: userId } },
  }, removed);
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removeInput, { blockIds: [blockId], actorUserId: userId });
});
