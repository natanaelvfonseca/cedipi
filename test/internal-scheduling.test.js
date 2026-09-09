import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApp } from "../server/app.js";
import { AuthServiceError } from "../server/auth-service.js";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "admin",
  mustChangePassword: false,
};
const doctorId = "22222222-2222-4222-8222-222222222222";
const slots = [
  {
    id: "slot-available", doctor: { id: doctorId, name: "Danilo" },
    startsAt: "2026-09-14T12:00:00.000Z", endsAt: "2026-09-14T12:20:00.000Z",
    startsAtLocal: "2026-09-14T09:00:00", endsAtLocal: "2026-09-14T09:20:00",
    status: "available", source: "schedule", notes: null, block: null,
  },
  {
    id: "slot-booked", doctor: { id: doctorId, name: "Danilo" },
    startsAt: "2026-09-14T12:20:00.000Z", endsAt: "2026-09-14T12:40:00.000Z",
    startsAtLocal: "2026-09-14T09:20:00", endsAtLocal: "2026-09-14T09:40:00",
    status: "booked", source: "schedule", notes: null, block: null,
  },
  {
    id: "slot-blocked", doctor: { id: doctorId, name: "Danilo" },
    startsAt: "2026-09-14T12:40:00.000Z", endsAt: "2026-09-14T13:00:00.000Z",
    startsAtLocal: "2026-09-14T09:40:00", endsAtLocal: "2026-09-14T10:00:00",
    status: "blocked", source: "schedule", notes: null,
    block: { id: "block-id", reason: "Operação" },
  },
];

async function withServer(callback) {
  const calls = [];
  const app = createApp({
    internalApiSecret: "internal-secret",
    authService: {
      async authenticate(token) {
        if (token !== "valid-session") throw new AuthServiceError("unauthorized", 401);
        return { tokenHash: "hash", user };
      },
    },
    availabilityReader: async (filters) => { calls.push(filters); return slots; },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("rota do painel continua exigindo login e autenticada retorna disponibilidade", async () => {
  await withServer(async (base) => {
    const unauthorized = await fetch(`${base}/api/scheduling/availability?date=2026-09-14&doctor=Danilo`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { ok: false, error: "unauthorized" });

    const authorized = await fetch(`${base}/api/scheduling/availability?date=2026-09-14&doctor=Danilo`, {
      headers: { cookie: "cedipi_session=valid-session" },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual((await authorized.json()).slots, slots);
  });
});

test("rota interna exige o mesmo segredo e retorna exatamente o contrato do painel", async () => {
  await withServer(async (base, calls) => {
    const path = "/scheduling/availability?date=2026-09-14&doctor=Danilo";
    const missing = await fetch(`${base}/api/internal${path}`);
    assert.equal(missing.status, 401);
    const wrong = await fetch(`${base}/api/internal${path}`, {
      headers: { "x-cedipi-internal-secret": "wrong" },
    });
    assert.equal(wrong.status, 403);
    const internal = await fetch(`${base}/api/internal${path}`, {
      headers: { "x-cedipi-internal-secret": "internal-secret" },
    });
    const panel = await fetch(`${base}/api${path}`, {
      headers: { cookie: "cedipi_session=valid-session" },
    });
    assert.equal(internal.status, 200);
    assert.equal(panel.status, 200);
    assert.deepEqual(await internal.json(), await panel.json());
    assert.deepEqual(calls, [
      { date: "2026-09-14", doctor: "Danilo" },
      { date: "2026-09-14", doctor: "Danilo" },
    ]);
  });
});

test("date e doctorId são preservados usando o filtro de ID já aceito pelo repositório", async () => {
  await withServer(async (base, calls) => {
    const response = await fetch(
      `${base}/api/internal/scheduling/availability?date=2026-09-14&doctorId=${doctorId}`,
      { headers: { "x-cedipi-internal-secret": "internal-secret" } },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ date: "2026-09-14", doctor: doctorId }]);
  });
});

test("contrato compartilhado preserva bloqueios, appointments e duração de 20 minutos", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/internal/scheduling/availability?date=2026-09-14`, {
      headers: { "x-cedipi-internal-secret": "internal-secret" },
    });
    const body = await response.json();
    assert.deepEqual(body.slots.map((slot) => slot.status), ["available", "booked", "blocked"]);
    for (const slot of body.slots) {
      assert.equal(new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime(), 20 * 60 * 1000);
    }
  });
});

test("segredo e header internos não aparecem no frontend", async () => {
  const frontend = await Promise.all([
    readFile(new URL("../app/agenda-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(frontend.join("\n").includes("N8N_INTERNAL_API_SECRET"), false);
  assert.equal(frontend.join("\n").includes("x-cedipi-internal-secret"), false);
});
