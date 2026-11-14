import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoogleCalendarScheduler,
  GoogleCalendarError,
  googleEventIdForAppointment,
} from "../server/google-calendar-scheduler.js";
import { createAppointmentScheduler } from "../server/appointment-scheduler.js";

const booking = {
  appointmentId: "990f7c39-59bd-431e-9847-626e096d4f9f",
  calendarId: "doctor@example.com",
  start: "2026-12-01T12:00:00.000Z",
  end: "2026-12-01T12:20:00.000Z",
  name: "Paciente TESTE",
  phone: "5547999999999",
  exam: "Dados clinicos teste",
};
const id = googleEventIdForAppointment(booking.appointmentId);
function calendarClient(fetchImpl) {
  return createGoogleCalendarScheduler({
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "refresh-token",
    fetchImpl,
  });
}
const tokenResponse = () => Response.json({ access_token: "access-token" });
const missing = () => new Response(null, { status: 404 });
const eventPayload = () => ({
  id, start: { dateTime: booking.start }, end: { dateTime: booking.end },
});

test("event ID is deterministic and valid for Google API", () => {
  assert.equal(id, "cedipi990f7c3959bd431e9847626e096d4f9f");
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.throws(() => googleEventIdForAppointment("not-uuid"));
});

test("native Google booking checks external conflicts before creating an event", async () => {
  const calls = [];
  const client = calendarClient(async (url, opts) => {
    const target = String(url);
    calls.push({ url: target, method: opts.method, body: opts.body });
    if (target.includes("oauth2.googleapis.com")) return tokenResponse();
    if (opts.method === "GET") return missing();
    if (target.endsWith("/freeBusy")) {
      return Response.json({ calendars: { [booking.calendarId]: { busy: [] } } });
    }
    if (opts.method === "POST" && target.endsWith("/events")) {
      return Response.json(eventPayload(), { status: 201 });
    }
    throw new Error("Unexpected request");
  });
  const result = await client.createAppointment(booking);
  assert.deepEqual(result, {
    status: "agendado", googleEventId: id,
    googleCalendarId: booking.calendarId,
    start: booking.start, end: booking.end,
  });
  assert.deepEqual(calls.map((x) => x.method), ["POST", "GET", "POST", "POST"]);
  const created = calls.at(-1).body;
  assert.equal(created.includes(booking.name), false);
  assert.equal(created.includes(booking.phone), false);
  assert.equal(created.includes(booking.exam), false);
  assert.equal(JSON.parse(created).id, id);
});

test("preexisting same event is idempotent and skips FreeBusy and insert", async () => {
  const calls = [];
  const client = calendarClient(async (url, opts) => {
    calls.push(opts.method);
    if (String(url).includes("oauth2")) return tokenResponse();
    if (opts.method === "GET") return Response.json(eventPayload());
    throw new Error("Unexpected calendar mutation");
  });
  assert.equal((await client.createAppointment(booking)).googleEventId, id);
  assert.deepEqual(calls, ["POST", "GET"]);
});

test("external busy times block creating a new event", async () => {
  let inserted = false;
  const client = calendarClient(async (url, opts) => {
    if (String(url).includes("oauth2")) return tokenResponse();
    if (opts.method === "GET") return missing();
    if (String(url).endsWith("/freeBusy")) return Response.json({
      calendars: { [booking.calendarId]: { busy: [
        { start: booking.start, end: booking.end },
      ] } },
    });
    inserted = true;
    return Response.json(eventPayload(), { status: 201 });
  });
  await assert.rejects(client.createAppointment(booking),
    (error) => error instanceof GoogleCalendarError &&
      error.code === "google_calendar_busy" && error.status === 409);
  assert.equal(inserted, false);
});

test("unknown availability fails closed and never inserts", async () => {
  const client = calendarClient(async (url, opts) => {
    if (String(url).includes("oauth2")) return tokenResponse();
    if (opts.method === "GET") return missing();
    return Response.json({ calendars: {} });
  });
  await assert.rejects(client.createAppointment(booking),
    (error) => error.code === "google_calendar_availability_unknown");
});

test("409 after insert retries read and confirms only matching existing event", async () => {
  let getCalls = 0;
  const client = calendarClient(async (url, opts) => {
    if (String(url).includes("oauth2")) return tokenResponse();
    if (opts.method === "GET") {
      getCalls++;
      return getCalls === 1 ? missing() : Response.json(eventPayload());
    }
    if (String(url).endsWith("/freeBusy")) return Response.json({
      calendars: { [booking.calendarId]: { busy: [] } },
    });
    return new Response(null, { status: 409 });
  });
  assert.equal((await client.createAppointment(booking)).googleEventId, id);
  assert.equal(getCalls, 2);
});

test("no secrets leak on Google OAuth failure", async () => {
  const client = calendarClient(async () => new Response("refresh-token", { status: 403 }));
  await assert.rejects(client.createAppointment(booking), (error) => {
    assert.equal(error.code, "google_calendar_auth_failed");
    assert.equal(JSON.stringify(error).includes("refresh-token"), false);
    return true;
  });
});

test("no credentials returns explicitly unavailable and no webhook is called", async () => {
  const client = createGoogleCalendarScheduler({
    clientId: "", clientSecret: "", refreshToken: "",
    fetchImpl: () => { throw new Error("not expected"); },
  });
  await assert.rejects(client.createAppointment(booking),
    (error) => error.code === "google_calendar_not_configured" && error.status === 503);
});

test("backend selector handles unknown modes", () => {
  assert.equal(typeof createAppointmentScheduler("n8n"), "function");
  assert.equal(typeof createAppointmentScheduler("google"), "function");
  assert.throws(() => createAppointmentScheduler("unexpected"),
    (error) => error.code === "appointment_backend_invalid");
});
