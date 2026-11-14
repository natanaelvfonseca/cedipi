const googleApi = "https://www.googleapis.com/calendar/v3";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const defaultTimeoutMs = 15_000;

export class GoogleCalendarError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = "GoogleCalendarError";
    this.code = code;
    this.status = status;
  }
}

function validRange(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

// Base32hex: letters a-v and digits 0-9. A UUID without hyphens fits.
export function googleEventIdForAppointment(appointmentId) {
  if (typeof appointmentId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId)) {
    throw new GoogleCalendarError("google_invalid_appointment_id", 400);
  }
  return "cedipi" + appointmentId.replaceAll("-", "").toLowerCase();
}

function matchingDateRange(event, start, end) {
  const existingStart = event?.start?.dateTime;
  const existingEnd = event?.end?.dateTime;
  return typeof existingStart === "string" && typeof existingEnd === "string"
    && Date.parse(existingStart) === Date.parse(start)
    && Date.parse(existingEnd) === Date.parse(end);
}

/**
 * Uses a refresh token issued to a clinic-controlled Google account.
 * Never log tokens, Google response bodies or patient details.
 */
export function createGoogleCalendarScheduler({
  clientId = process.env.CEDIPI_GOOGLE_CLIENT_ID,
  clientSecret = process.env.CEDIPI_GOOGLE_CLIENT_SECRET,
  refreshToken = process.env.CEDIPI_GOOGLE_REFRESH_TOKEN,
  fetchImpl = fetch,
  apiBase = googleApi,
  tokenEndpoint = googleTokenEndpoint,
  timeoutMs = defaultTimeoutMs,
} = {}) {
  async function safeFetch(url, options) {
    try {
      return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new GoogleCalendarError("google_calendar_unavailable", 502);
    }
  }

  async function accessToken() {
    if (!clientId || !clientSecret || !refreshToken) {
      throw new GoogleCalendarError("google_calendar_not_configured", 503);
    }
    const response = await safeFetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!response.ok) throw new GoogleCalendarError("google_calendar_auth_failed", 503);
    let payload;
    try { payload = await response.json(); } catch { /* invalid response */ }
    if (typeof payload?.access_token !== "string" || !payload.access_token) {
      throw new GoogleCalendarError("google_calendar_auth_failed", 503);
    }
    return payload.access_token;
  }

  async function calendarRequest(token, method, url, body) {
    const response = await safeFetch(url, {
      method,
      headers: {
        authorization: "Bearer " + token,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 404 || response.status === 409) return { status: response.status };
    if (!response.ok) {
      throw new GoogleCalendarError(
        response.status === 401 || response.status === 403
          ? "google_calendar_permission_denied" : "google_calendar_unavailable",
        response.status === 401 || response.status === 403 ? 503 : 502,
      );
    }
    let data;
    try { data = await response.json(); } catch { /* invalid response */ }
    if (!data || typeof data !== "object") {
      throw new GoogleCalendarError("google_calendar_invalid_response");
    }
    return { status: response.status, data };
  }

  async function createAppointment({
    appointmentId, calendarId, start, end,
  }) {
    if (!calendarId || typeof calendarId !== "string" || !validRange(start, end)) {
      throw new GoogleCalendarError("google_calendar_invalid_request", 422);
    }
    const eventId = googleEventIdForAppointment(appointmentId);
    const token = await accessToken();
    const eventsUrl = apiBase + "/calendars/" + encodeURIComponent(calendarId) + "/events";
    const eventUrl = eventsUrl + "/" + encodeURIComponent(eventId);

    const existing = await calendarRequest(token, "GET", eventUrl);
    if (existing.status !== 404) {
      if (matchingDateRange(existing.data, start, end)) {
        return { status: "agendado", googleEventId: eventId,
          googleCalendarId: calendarId, start, end };
      }
      throw new GoogleCalendarError("google_calendar_event_conflict", 409);
    }

    // Ensure external events are respected. This is an advisory preflight, not
    // an atomic lock: local DB owns concurrency for CEDIPI-originated bookings.
    const freebusy = await calendarRequest(token, "POST", apiBase + "/freeBusy", {
      timeMin: start, timeMax: end, items: [{ id: calendarId }],
    });
    const calendar = freebusy.data?.calendars?.[calendarId];
    if (!calendar || !Array.isArray(calendar.busy) ||
      (Array.isArray(calendar.errors) && calendar.errors.length > 0)) {
      throw new GoogleCalendarError("google_calendar_availability_unknown", 503);
    }
    if (calendar.busy.some((busy) =>
      Date.parse(busy.start) < Date.parse(end) && Date.parse(busy.end) > Date.parse(start))) {
      throw new GoogleCalendarError("google_calendar_busy", 409);
    }

    const created = await calendarRequest(token, "POST", eventsUrl, {
      id: eventId,
      summary: "Atendimento CEDIPI",
      description: "Agendamento registrado no sistema CEDIPI.",
      start: { dateTime: start },
      end: { dateTime: end },
      transparency: "opaque",
      status: "confirmed",
    });
    if (created.status === 409) {
      const repeated = await calendarRequest(token, "GET", eventUrl);
      if (!matchingDateRange(repeated.data, start, end)) {
        throw new GoogleCalendarError("google_calendar_event_conflict", 409);
      }
    } else if (created.data?.id !== eventId ||
        !matchingDateRange(created.data, start, end)) {
      throw new GoogleCalendarError("google_calendar_invalid_response");
    }

    return { status: "agendado", googleEventId: eventId,
      googleCalendarId: calendarId, start, end };
  }

  return { createAppointment };
}

export function scheduleGoogleAppointment(input) {
  return createGoogleCalendarScheduler().createAppointment(input);
}
