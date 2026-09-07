import {
  checkAvailability,
  N8nAgendaError,
} from "./n8n-agenda-client.js";
import { isValidDate } from "./scheduling-handlers.js";
import { ensureScheduleSlots } from "./schedule-slots-repository.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function queryString(value, maximumLength) {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maximumLength ? normalized : null;
}

export function parseLiveAvailabilityQuery(query) {
  const date = queryString(query.date, 10);
  const doctor = queryString(query.doctor, 255);
  const doctorId = queryString(query.doctorId, 36);
  const period = queryString(query.period, 50);
  const after = queryString(query.after, 50);

  if (
    !isValidDate(date)
    || doctor === null
    || doctorId === null
    || period === null
    || after === null
    || (!doctor && !doctorId)
    || (doctorId && !uuidPattern.test(doctorId))
  ) {
    return null;
  }

  return { date, doctor, doctorId, period, after };
}

export function createLiveAvailabilityHandler(
  findAvailability = checkAvailability,
  prepareSchedule = findAvailability === checkAvailability ? ensureScheduleSlots : async () => {},
) {
  return async function liveAvailabilityHandler(request, response) {
    const input = parseLiveAvailabilityQuery(request.query);
    if (!input) {
      response.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }

    try {
      await prepareSchedule({ date: input.date, doctor: input.doctorId || input.doctor });
      const availability = await findAvailability(input);
      response.status(200).json({ ok: true, availability });
    } catch (error) {
      const knownError = error instanceof N8nAgendaError;
      const status = knownError ? error.status : 502;
      const code = knownError ? error.code : "n8n_unavailable";
      console.error("Falha ao consultar a agenda no n8n:", {
        code,
        upstreamStatus: knownError ? error.upstreamStatus : undefined,
      });
      response.status(status).json({ ok: false, error: code });
    }
  };
}
