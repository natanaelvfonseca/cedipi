import assert from "node:assert/strict";
import test from "node:test";
import {
  AgendaApiError,
  getAvailability,
  getDoctors,
  deleteScheduleBlocks,
  postAppointment,
  postAppointmentAndRefresh,
  postScheduleBlocks,
} from "../app/agenda-api.ts";

const doctor = {
  id: "doctor-api-id",
  name: "Médico retornado pela API",
  active: true,
  appointmentDurationMinutes: 20,
};

const createPayload = {
  doctorId: "doctor-api-id",
  slotId: "slot-api-id",
  patient: { name: "Paciente", phone: "5547999999999", email: "paciente@example.com" },
  exam: "Exame",
};

test("carrega médicos exclusivamente da API", async () => {
  let requestedUrl;
  const doctors = await getDoctors(undefined, async (url) => {
    requestedUrl = url;
    return Response.json({ ok: true, doctors: [doctor] });
  });
  assert.equal(requestedUrl, "/api/doctors");
  assert.deepEqual(doctors, [doctor]);
});

test("carrega slots com data e nome do médico", async () => {
  let requestedUrl;
  const slots = [{ id: "slot-api-id", startsAtLocal: "2026-09-09T09:00:00" }];
  const result = await getAvailability(
    "2026-09-09",
    "Médico retornado pela API",
    undefined,
    async (url) => {
      requestedUrl = String(url);
      return Response.json({ ok: true, slots });
    },
  );
  assert.match(requestedUrl, /^\/api\/scheduling\/availability\?/);
  assert.equal(new URLSearchParams(requestedUrl.split("?")[1]).get("date"), "2026-09-09");
  assert.equal(new URLSearchParams(requestedUrl.split("?")[1]).get("doctor"), doctor.name);
  assert.deepEqual(result, slots);
});

for (const status of [201, 200]) {
  test(`POST trata HTTP ${status} como sucesso`, async () => {
    let request;
    const appointment = await postAppointment(createPayload, async (url, options) => {
      request = { url, options };
      return Response.json({ ok: true, appointment: { id: "appointment-id" } }, { status });
    });
    assert.equal(request.url, "/api/appointments");
    assert.equal(request.options.method, "POST");
    assert.deepEqual(JSON.parse(request.options.body), createPayload);
    assert.equal(appointment.id, "appointment-id");
  });
}

test("propaga código seguro de conflito de slot", async () => {
  await assert.rejects(
    postAppointment(createPayload, async () => Response.json(
      { ok: false, error: "slot_already_occupied" },
      { status: 409 },
    )),
    (error) => {
      assert.equal(error instanceof AgendaApiError, true);
      assert.equal(error.code, "slot_already_occupied");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("atualiza agenda e appointments após criar", async () => {
  const calls = [];
  await postAppointmentAndRefresh(
    createPayload,
    async () => { calls.push("refresh"); },
    async (payload) => { calls.push("post"); assert.deepEqual(payload, createPayload); return { id: "appointment-id" }; },
  );
  assert.deepEqual(calls, ["post", "refresh"]);
});

test("erro de API não expõe resposta técnica", async () => {
  await assert.rejects(
    getDoctors(undefined, async () => new Response("upstream stack", { status: 500 })),
    (error) => error instanceof AgendaApiError && error.code === "invalid_response",
  );
});

test("bloqueia horários por médico/data e desbloqueia por IDs", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return Response.json(options.method === "DELETE"
      ? { ok: true, removed: 2 } : { ok: true, blocks: [] }, { status: options.method === "POST" ? 201 : 200 });
  };
  await postScheduleBlocks({
    doctorId: doctor.id, date: "2026-09-14", times: ["09:00", "09:40"], reason: "Teste",
  }, fetchImpl);
  await deleteScheduleBlocks(["block-1", "block-2"], fetchImpl);
  assert.equal(requests[0].url, "/api/scheduling/blocks");
  assert.deepEqual(JSON.parse(requests[0].options.body).times, ["09:00", "09:40"]);
  assert.equal(requests[1].options.method, "DELETE");
  assert.deepEqual(JSON.parse(requests[1].options.body), { blockIds: ["block-1", "block-2"] });
});
