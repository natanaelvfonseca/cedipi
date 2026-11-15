import { createAppointment as scheduleViaN8n } from "./n8n-agenda-client.js";
import { scheduleGoogleAppointment, GoogleCalendarError } from "./google-calendar-scheduler.js";

// Production remains on n8n until clinic-owned Google OAuth is validated.
export function createAppointmentScheduler(mode = process.env.CEDIPI_APPOINTMENTS_BACKEND ?? "n8n") {
  if (mode === "native") return async ({start,end})=>({
    status:"agendado",start,end,googleEventId:null,googleCalendarId:null,
  });
  if (mode === "n8n") return scheduleViaN8n;
  if (mode === "google") return scheduleGoogleAppointment;
  throw new GoogleCalendarError("appointment_backend_invalid", 503);
}

export function scheduleAppointment(input) {
  return createAppointmentScheduler()(input);
}
