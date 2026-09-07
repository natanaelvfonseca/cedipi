import assert from "node:assert/strict";
import test from "node:test";
import {
  createListAppointmentsHandler,
  createListAvailabilityHandler,
  createListDoctorsHandler,
  isValidDate,
} from "../server/scheduling-handlers.js";

function responseRecorder() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("valida datas reais no formato YYYY-MM-DD", () => {
  assert.equal(isValidDate("2026-09-09"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("09/09/2026"), false);
});

test("GET doctors devolve a lista sanitizada do repositório", async () => {
  const response = responseRecorder();
  const doctors = [{
    id: "doctor-id",
    name: "Danilo",
    active: true,
    appointmentDurationMinutes: 20,
  }];
  await createListDoctorsHandler(async () => doctors)({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, doctors });
  assert.equal(JSON.stringify(response.body).includes("google_calendar"), false);
});

test("GET availability exige data válida e encaminha filtro de médico", async () => {
  const invalidResponse = responseRecorder();
  await createListAvailabilityHandler(async () => [])(
    { query: { date: "2026-02-30" } },
    invalidResponse,
  );
  assert.equal(invalidResponse.statusCode, 400);

  const response = responseRecorder();
  let received;
  await createListAvailabilityHandler(async (filters) => {
    received = filters;
    return [];
  })({ query: { date: "2026-09-09", doctor: "Wagner" } }, response);

  assert.deepEqual(received, { date: "2026-09-09", doctor: "Wagner" });
  assert.deepEqual(response.body, {
    ok: true,
    date: "2026-09-09",
    timezone: "America/Sao_Paulo",
    slots: [],
  });
});

test("GET appointments devolve lista vazia", async () => {
  const response = responseRecorder();
  await createListAppointmentsHandler(async () => [])({}, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, appointments: [] });
});
