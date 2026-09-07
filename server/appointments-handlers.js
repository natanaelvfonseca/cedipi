import { appointmentsService, AppointmentError } from "./appointments-service.js";
import { N8nAgendaError } from "./n8n-agenda-client.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalString(value, maximumLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length <= maximumLength ? normalized : undefined;
}

export function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\D/g, "");
  return normalized.length >= 8 && normalized.length <= 30 ? normalized : null;
}

export function parseCreateAppointmentBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!uuidPattern.test(body.doctorId ?? "") || !uuidPattern.test(body.slotId ?? "")) return null;
  if (!body.patient || typeof body.patient !== "object" || Array.isArray(body.patient)) return null;

  const name = optionalString(body.patient.name, 255);
  const phone = normalizePhone(body.patient.phone);
  const email = optionalString(body.patient.email, 320);
  const exam = optionalString(body.exam, 255);
  if (!name || !phone || email === undefined || exam === undefined) return null;

  return {
    doctorId: body.doctorId.toLowerCase(),
    slotId: body.slotId.toLowerCase(),
    patient: { name, phone, email },
    exam,
  };
}

export function createPostAppointmentHandler(service = appointmentsService) {
  return async function postAppointmentHandler(request, response) {
    const input = parseCreateAppointmentBody(request.body);
    if (!input) {
      response.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }

    try {
      const result = await service.createAppointment(input);
      response.status(result.created ? 201 : 200).json({
        ok: true,
        appointment: result.appointment,
      });
    } catch (error) {
      const knownError = error instanceof AppointmentError || error instanceof N8nAgendaError;
      const status = knownError ? error.status : 500;
      const code = knownError ? error.code : "internal_error";
      console.error("Falha ao criar agendamento:", { code });
      response.status(status).json({ ok: false, error: code });
    }
  };
}
