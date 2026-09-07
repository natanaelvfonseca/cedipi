export type Doctor = {
  id: string;
  name: string;
  active: boolean;
  appointmentDurationMinutes: number;
};

export type AvailabilitySlot = {
  id: string;
  doctor: { id: string; name: string };
  startsAt: string;
  endsAt: string;
  startsAtLocal: string;
  endsAtLocal: string;
  status: "available" | "blocked" | "unavailable";
  source: string;
  notes: string | null;
};

export type ApiAppointment = {
  id: string;
  doctor: { id: string; name: string };
  patient: { id: string; name: string | null; phone: string } | null;
  examName: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  notes: string | null;
};

export type CreateAppointmentPayload = {
  doctorId: string;
  slotId: string;
  patient: { name: string; phone: string; email?: string };
  exam: string;
};

export type CreatedAppointment = {
  id: string;
  status: string;
  doctor: { id: string; name: string };
  patient: { id: string; name: string; phone: string };
  exam: string | null;
  start: string;
  end: string;
};

export class AgendaApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "AgendaApiError";
    this.code = code;
    this.status = status;
  }
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AgendaApiError("network_error", 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AgendaApiError("invalid_response", response.status);
  }

  if (
    !response.ok
    || !payload
    || typeof payload !== "object"
    || !("ok" in payload)
    || payload.ok !== true
  ) {
    const code = payload && typeof payload === "object" && "error" in payload
      && typeof payload.error === "string" ? payload.error : "request_failed";
    throw new AgendaApiError(code, response.status);
  }
  return payload as T;
}

export async function getDoctors(signal?: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const payload = await requestJson<{ ok: true; doctors: Doctor[] }>(
    "/api/doctors",
    { signal },
    fetchImpl,
  );
  return payload.doctors.filter((doctor) => doctor.active);
}

export async function getAvailability(
  date: string,
  doctor: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const query = new URLSearchParams({ date, doctor });
  const payload = await requestJson<{ ok: true; slots: AvailabilitySlot[] }>(
    `/api/scheduling/availability?${query}`,
    { signal },
    fetchImpl,
  );
  return payload.slots;
}

export async function getAppointments(signal?: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const payload = await requestJson<{ ok: true; appointments: ApiAppointment[] }>(
    "/api/appointments",
    { signal },
    fetchImpl,
  );
  return payload.appointments;
}

export async function postAppointment(
  appointment: CreateAppointmentPayload,
  fetchImpl: typeof fetch = fetch,
) {
  const payload = await requestJson<{ ok: true; appointment: CreatedAppointment }>(
    "/api/appointments",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(appointment),
    },
    fetchImpl,
  );
  return payload.appointment;
}

export async function postAppointmentAndRefresh(
  appointment: CreateAppointmentPayload,
  refresh: () => Promise<void>,
  create: (payload: CreateAppointmentPayload) => Promise<CreatedAppointment> = postAppointment,
) {
  const created = await create(appointment);
  await refresh();
  return created;
}
