import {
  confirmAppointment,
  failAppointment,
  reservePendingAppointment,
  AppointmentReservationError,
} from "./appointments-repository.js";
import {
  createAppointment as createN8nAppointment,
  N8nAgendaError,
} from "./n8n-agenda-client.js";

const reservationErrors = {
  doctor_not_found: 404,
  doctor_unavailable: 409,
  slot_not_found: 404,
  slot_doctor_mismatch: 409,
  slot_unavailable: 409,
};

export class AppointmentError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "AppointmentError";
    this.code = code;
    this.status = status;
  }
}

function publicAppointment(appointment, externalTimes = {}) {
  return {
    id: appointment.id,
    status: appointment.status === "scheduled" ? "confirmed" : appointment.status,
    doctor: appointment.doctor,
    patient: appointment.patient,
    exam: appointment.exam,
    start: externalTimes.start ?? appointment.startsAt,
    end: externalTimes.end ?? appointment.endsAt,
  };
}

export function createAppointmentsService({
  reserve = reservePendingAppointment,
  confirm = confirmAppointment,
  fail = failAppointment,
  schedule = createN8nAppointment,
} = {}) {
  async function createAppointment(input) {
    let reservation;
    try {
      reservation = await reserve(input);
    } catch (error) {
      if (error instanceof AppointmentReservationError) {
        throw new AppointmentError(error.code, reservationErrors[error.code] ?? 409);
      }
      throw error;
    }

    if (reservation.outcome === "idempotent") {
      return {
        created: false,
        appointment: publicAppointment(reservation.appointment),
      };
    }
    if (reservation.outcome === "in_progress") {
      throw new AppointmentError("appointment_in_progress", 409);
    }
    if (reservation.outcome === "occupied") {
      throw new AppointmentError("slot_already_occupied", 409);
    }

    const pending = reservation.appointment;
    let external;
    try {
      external = await schedule({
        doctor: pending.doctor.name,
        doctorId: pending.doctor.id,
        slotId: reservation.slot.id,
        start: reservation.slot.startsAt,
        name: pending.patient.name,
        phone: pending.patient.phone,
        exam: pending.exam,
      });
    } catch (error) {
      await fail(pending.id, error instanceof N8nAgendaError ? error.code : "n8n_unavailable");
      if (error instanceof N8nAgendaError) throw error;
      throw new AppointmentError("n8n_unavailable", 502);
    }

    if (external.status !== "agendado") {
      await fail(pending.id, external.status);
      const conflict = ["ocupado", "horario_invalido", "sem_horario"].includes(external.status);
      throw new AppointmentError(
        conflict ? "slot_rejected_by_n8n" : "n8n_scheduling_failed",
        conflict ? 409 : 502,
      );
    }

    const useExternalTimes = external.start && external.end;
    const confirmed = await confirm({
      appointmentId: pending.id,
      googleEventId: external.googleEventId,
      googleCalendarId: external.googleCalendarId,
      startsAt: useExternalTimes ? external.start : null,
      endsAt: useExternalTimes ? external.end : null,
    });
    if (!confirmed) {
      throw new AppointmentError("appointment_confirmation_failed", 500);
    }

    return {
      created: true,
      appointment: publicAppointment(
        { ...pending, status: "confirmed" },
        useExternalTimes ? { start: external.start, end: external.end } : {},
      ),
    };
  }

  return { createAppointment };
}

export const appointmentsService = createAppointmentsService();
