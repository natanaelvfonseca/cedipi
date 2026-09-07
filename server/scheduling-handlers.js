import {
  businessTimezone,
  listAppointments,
  listAvailability,
  listDoctors,
} from "./scheduling-repository.js";

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function internalError(response, message, error) {
  console.error(message, error);
  response.status(500).json({ ok: false, error: "internal_error" });
}

export function createListDoctorsHandler(findDoctors = listDoctors) {
  return async function listDoctorsHandler(_request, response) {
    try {
      const doctors = await findDoctors();
      response.status(200).json({ ok: true, doctors });
    } catch (error) {
      internalError(response, "Falha ao listar médicos:", error);
    }
  };
}

export function createListAvailabilityHandler(findAvailability = listAvailability) {
  return async function listAvailabilityHandler(request, response) {
    const date = request.query.date;
    const doctor = typeof request.query.doctor === "string" && request.query.doctor.length > 0
      ? request.query.doctor
      : undefined;

    if (!isValidDate(date)) {
      response.status(400).json({ ok: false, error: "invalid_date" });
      return;
    }

    try {
      const slots = await findAvailability({ date, doctor });
      response.status(200).json({ ok: true, date, timezone: businessTimezone, slots });
    } catch (error) {
      internalError(response, "Falha ao listar disponibilidade:", error);
    }
  };
}

export function createListAppointmentsHandler(findAppointments = listAppointments) {
  return async function listAppointmentsHandler(_request, response) {
    try {
      const appointments = await findAppointments();
      response.status(200).json({ ok: true, appointments });
    } catch (error) {
      internalError(response, "Falha ao listar agendamentos:", error);
    }
  };
}
