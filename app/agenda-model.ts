import type {
  ApiAppointment,
  AvailabilitySlot,
  CreateAppointmentPayload,
  Doctor,
} from "./agenda-api";

export const businessTimezone = "America/Sao_Paulo";
export const activeAppointmentStatuses = new Set(["pending", "confirmed", "scheduled"]);

export function doctorInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function slotLocalParts(slot: AvailabilitySlot) {
  return {
    date: slot.startsAtLocal.slice(0, 10),
    time: slot.startsAtLocal.slice(11, 16),
    endTime: slot.endsAtLocal.slice(11, 16),
  };
}

export function zonedDateTimeParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: businessTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ""
  );
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function appointmentView(appointment: ApiAppointment) {
  const start = zonedDateTimeParts(appointment.startsAt);
  const end = zonedDateTimeParts(appointment.endsAt);
  return {
    ...appointment,
    date: start.date,
    time: start.time,
    endTime: end.time,
    patientName: appointment.patient?.name || "Paciente não informado",
    phone: appointment.patient?.phone || "Não informado",
  };
}

export function availableSlotsForAppointments(
  slots: AvailabilitySlot[],
  appointments: ApiAppointment[],
) {
  const occupiedStarts = new Set(
    appointments
      .filter((appointment) => activeAppointmentStatuses.has(appointment.status))
      .map((appointment) => `${appointment.doctor.id}:${new Date(appointment.startsAt).getTime()}`),
  );
  return slots.filter((slot) => (
    slot.status === "available"
    && !occupiedStarts.has(`${slot.doctor.id}:${new Date(slot.startsAt).getTime()}`)
  ));
}

export function selectionFromSlot(slot: AvailabilitySlot) {
  return { doctorId: slot.doctor.id, slotId: slot.id };
}

export function buildCreateAppointmentPayload(
  slot: AvailabilitySlot,
  form: { name: string; phone: string; email?: string; exam: string },
): CreateAppointmentPayload {
  const email = form.email?.trim();
  return {
    ...selectionFromSlot(slot),
    patient: {
      name: form.name.trim(),
      phone: form.phone.replace(/\D/g, ""),
      ...(email ? { email } : {}),
    },
    exam: form.exam.trim(),
  };
}

export function acquireSubmissionLock(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function appointmentErrorMessage(code: string) {
  if ([
    "slot_already_occupied",
    "slot_rejected_by_n8n",
    "appointment_in_progress",
    "horario_invalido",
    "ocupado",
    "sem_horario",
    "slot_blocked",
    "slot_in_past",
    "slot_unavailable",
  ].includes(code)) {
    return "Este horário acabou de ficar indisponível. A agenda foi atualizada.";
  }
  if (["n8n_timeout", "n8n_unavailable", "n8n_upstream_error", "n8n_scheduling_failed", "network_error"].includes(code)) {
    return "Não foi possível confirmar o agendamento agora. Tente novamente em instantes.";
  }
  if (code === "invalid_request") return "Confira os dados do paciente e tente novamente.";
  return "Não foi possível concluir o agendamento. Tente novamente.";
}

export function doctorById(doctors: Doctor[], id: string | null) {
  return doctors.find((doctor) => doctor.id === id) ?? null;
}
