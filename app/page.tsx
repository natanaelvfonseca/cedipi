"use client";

import {
  AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3,
  FileText, Menu, MessageCircle, Plus, RefreshCw, Settings, Sparkles, Stethoscope,
  UserRound, UsersRound, X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgendaApiError,
  getAppointments,
  getAvailability,
  getDoctors,
  postAppointmentAndRefresh,
  type ApiAppointment,
  type AvailabilitySlot,
  type Doctor,
} from "./agenda-api";
import {
  acquireSubmissionLock,
  appointmentErrorMessage,
  appointmentView,
  availableSlotsForAppointments,
  buildCreateAppointmentPayload,
  doctorById,
  doctorInitials,
  slotLocalParts,
} from "./agenda-model";
import { getWhatsAppPresentation, type WhatsAppStatus } from "./whatsapp-status";

type ViewMode = "day" | "week";

const navItems = [
  { label: "Agenda", icon: CalendarDays, active: true },
  { label: "Pacientes", icon: UsersRound },
  { label: "Médicos", icon: Stethoscope },
  { label: "Configurações", icon: Settings },
];

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ""
  );
  return fromDateKey(`${part("year")}-${part("month")}-${part("day")}`);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function displayDate(date: Date, includeYear = false) {
  return date.toLocaleDateString("pt-BR", {
    weekday: includeYear ? undefined : "long",
    day: "numeric",
    month: "long",
    year: includeYear ? "numeric" : undefined,
  });
}

function weekDays(date: Date) {
  const monday = addDays(date, date.getDay() === 0 ? -6 : 1 - date.getDay());
  return Array.from({ length: 5 }, (_, index) => addDays(monday, index));
}

function sourcePresentation(source: string) {
  if (source === "lara") return { label: "Lara IA", icon: Sparkles, className: "lara-ia" };
  if (source === "panel") return { label: "Recepção", icon: UserRound, className: "recepção" };
  if (source === "import") return { label: "Importação", icon: FileText, className: "importação" };
  return { label: source, icon: FileText, className: "importação" };
}

function OriginBadge({ source }: { source: string }) {
  const presentation = sourcePresentation(source);
  const Icon = presentation.icon;
  return <span className={`origin-badge origin-${presentation.className}`}><Icon size={12} strokeWidth={2.2} />{presentation.label}</span>;
}

function statusPresentation(status: string) {
  if (status === "confirmed" || status === "scheduled") return { label: "Confirmado", className: "confirmed" };
  if (status === "pending") return { label: "Aguardando confirmação", className: "pending" };
  if (status === "completed") return { label: "Concluído", className: "confirmed" };
  if (status === "no_show") return { label: "Não compareceu", className: "cancelled" };
  if (status === "failed") return { label: "Falhou", className: "cancelled" };
  return { label: "Cancelado", className: "cancelled" };
}

function StatusBadge({ status }: { status: string }) {
  const presentation = statusPresentation(status);
  return <span className={`status-badge status-${presentation.className}`}>{presentation.label}</span>;
}

type WhatsAppInstance = {
  name: string;
  status: WhatsAppStatus;
  connected: boolean;
  phoneNumber?: string | null;
  profileName?: string | null;
  lastCheckedAt?: string;
};

const unknownWhatsApp: WhatsAppInstance = {
  name: "Cedipi",
  status: "unknown",
  connected: false,
};

function WhatsAppConnection() {
  const [instance, setInstance] = useState<WhatsAppInstance>(unknownWhatsApp);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/whatsapp/instance", { signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error("Status indisponível");
      setInstance(payload.instance);
      if (payload.instance.connected) setQrCode(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setInstance(unknownWhatsApp);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshStatus(controller.signal);
    const interval = window.setInterval(() => void refreshStatus(controller.signal), 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (!qrCode) return;
    const controller = new AbortController();
    const interval = window.setInterval(() => void refreshStatus(controller.signal), 5_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [qrCode, refreshStatus]);

  async function connect() {
    setConnecting(true);
    try {
      const response = await fetch("/api/whatsapp/instance/connect", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error("Conexão indisponível");
      if (payload.connected) {
        setQrCode(null);
        await refreshStatus();
      } else if (payload.qrCode) {
        setQrCode(payload.qrCode);
        setInstance((current) => ({ ...current, status: "connecting" }));
      }
    } catch {
      setInstance(unknownWhatsApp);
    } finally {
      setConnecting(false);
    }
  }

  const presentation = getWhatsAppPresentation(instance.status);

  return (
    <>
      <div className="whatsapp-control">
        <div className={`whatsapp-state-card whatsapp-${instance.status}`}>
          <span className="whatsapp-status-icon"><MessageCircle size={18} /></span>
          <div className="whatsapp-status-copy">
            <div className="whatsapp-status-title">
              {instance.status === "unknown" ? <AlertTriangle size={14} /> : <i />}
              <strong>{loading ? "Verificando WhatsApp..." : presentation.label}</strong>
            </div>
            <small>Instância {instance.name}</small>
            {(instance.profileName || instance.phoneNumber) && (
              <span className="whatsapp-metadata">
                {instance.profileName && <span>{instance.profileName}</span>}
                {instance.phoneNumber && <span>{instance.phoneNumber}</span>}
              </span>
            )}
          </div>
        </div>
        {presentation.action === "connect" ? (
          <button className="whatsapp-action" onClick={connect} disabled={connecting}>{connecting ? "Gerando QR..." : "Conectar WhatsApp"}</button>
        ) : presentation.action === "retry" ? (
          <button className="whatsapp-action whatsapp-retry" onClick={() => void refreshStatus()} disabled={loading}>Tentar novamente</button>
        ) : (
          <button className="whatsapp-refresh" onClick={() => void refreshStatus()} disabled={loading} aria-label={presentation.actionLabel}><RefreshCw size={14} /></button>
        )}
      </div>
      {qrCode && (
        <div className="modal-layer modal-top" role="dialog" aria-modal="true" aria-labelledby="whatsapp-connect-title">
          <button className="modal-backdrop" onClick={() => setQrCode(null)} aria-label="Fechar QR Code" />
          <div className="modal-card whatsapp-modal">
            <div className="modal-header"><div className="modal-title-icon"><MessageCircle size={20} /></div><div><h2 id="whatsapp-connect-title">Conectar WhatsApp</h2><p>Instância {instance.name}</p></div><button className="icon-button" onClick={() => setQrCode(null)} aria-label="Fechar"><X size={20} /></button></div>
            <div className="whatsapp-qr-content">
              <img src={qrCode} alt="QR Code para conectar a instância Cedipi ao WhatsApp" />
              <p>Escaneie este QR Code no WhatsApp em:<br /><strong>Configurações → Aparelhos conectados → Conectar aparelho.</strong></p>
              <span><i /> Aguardando leitura do QR Code</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Home() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayInSaoPaulo);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [availabilityByDate, setAvailabilityByDate] = useState<Record<string, AvailabilitySlot[]>>({});
  const [appointments, setAppointments] = useState<ApiAppointment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agendaError, setAgendaError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const submissionLock = useRef(false);

  const selectedDoctor = doctorById(doctors, selectedDoctorId);
  const selectedDoctorName = selectedDoctor?.name ?? null;
  const dateKey = toDateKey(selectedDate);
  const visibleDates = useMemo(
    () => (viewMode === "day" ? [dateKey] : weekDays(selectedDate).map(toDateKey)),
    [dateKey, selectedDate, viewMode],
  );
  const visibleDatesKey = visibleDates.join(",");
  const appointmentViews = useMemo(() => appointments.map(appointmentView), [appointments]);
  const selectedAppointment = appointmentViews.find((appointment) => appointment.id === selectedId) ?? null;
  const dayAppointments = appointmentViews.filter(
    (appointment) => appointment.doctor.id === selectedDoctorId && appointment.date === dateKey,
  );
  const configuredSlots = availabilityByDate[dateKey] ?? [];
  const availableSlots = useMemo(
    () => availableSlotsForAppointments(configuredSlots, appointments),
    [appointments, configuredSlots],
  );
  const confirmedCount = dayAppointments.filter(
    (appointment) => appointment.status === "confirmed" || appointment.status === "scheduled",
  ).length;
  const pendingCount = dayAppointments.filter((appointment) => appointment.status === "pending").length;
  const timelineItems = useMemo(() => {
    const eventItems = dayAppointments.map((appointment) => ({
      type: "appointment" as const,
      id: appointment.id,
      time: appointment.time,
      appointment,
    }));
    const slotItems = availableSlots.map((slot) => ({
      type: "slot" as const,
      id: slot.id,
      time: slotLocalParts(slot).time,
      slot,
    }));
    return [...eventItems, ...slotItems].sort(
      (left, right) => left.time.localeCompare(right.time) || left.type.localeCompare(right.type),
    );
  }, [availableSlots, dayAppointments]);

  const showToast = useCallback((message: string, kind: "success" | "error" = "success") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  const loadDoctors = useCallback(async (signal?: AbortSignal) => {
    setDoctorsLoading(true);
    setAgendaError(null);
    try {
      const items = await getDoctors(signal);
      setDoctors(items);
      setSelectedDoctorId((current) => (
        items.some((doctor) => doctor.id === current) ? current : items[0]?.id ?? null
      ));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setAgendaError("Não foi possível carregar os médicos.");
    } finally {
      if (!signal?.aborted) setDoctorsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDoctors(controller.signal);
    return () => controller.abort();
  }, [loadDoctors]);

  const loadAgenda = useCallback(async (signal?: AbortSignal) => {
    if (!selectedDoctorName) return;
    const dates = visibleDatesKey.split(",").filter(Boolean);
    setAgendaLoading(true);
    setAgendaError(null);
    try {
      const [slotGroups, nextAppointments] = await Promise.all([
        Promise.all(dates.map(async (date) => ({
          date,
          slots: await getAvailability(date, selectedDoctorName, signal),
        }))),
        getAppointments(signal),
      ]);
      if (signal?.aborted) return;
      setAvailabilityByDate((current) => {
        const next = { ...current };
        for (const group of slotGroups) next[group.date] = group.slots;
        return next;
      });
      setAppointments(nextAppointments);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setAgendaError("Não foi possível carregar a agenda. Tente novamente.");
    } finally {
      if (!signal?.aborted) setAgendaLoading(false);
    }
  }, [selectedDoctorName, visibleDatesKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadAgenda(controller.signal);
    return () => controller.abort();
  }, [loadAgenda]);

  function openFirstAvailableSlot() {
    if (availableSlots[0]) {
      setFormError(null);
      setSelectedSlot(availableSlots[0]);
      return;
    }
    showToast("Não há horários disponíveis para este médico nesta data.", "error");
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot || !acquireSubmissionLock(submissionLock)) return;

    setSubmitting(true);
    setFormError(null);
    const form = new FormData(event.currentTarget);
    const payload = buildCreateAppointmentPayload(selectedSlot, {
      name: String(form.get("patient") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? ""),
      exam: String(form.get("exam") ?? ""),
    });

    try {
      await postAppointmentAndRefresh(payload, () => loadAgenda());
      setSelectedSlot(null);
      showToast("Agendamento realizado com sucesso.");
    } catch (error) {
      const code = error instanceof AgendaApiError ? error.code : "request_failed";
      const message = appointmentErrorMessage(code);
      if ([
        "slot_already_occupied",
        "slot_rejected_by_n8n",
        "appointment_in_progress",
        "horario_invalido",
        "ocupado",
        "sem_horario",
      ].includes(code)) {
        setSelectedSlot(null);
        showToast(message, "error");
        await loadAgenda();
      } else {
        setFormError(message);
      }
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><span>C</span></div>
          <div><strong>CEDIPI</strong><span>Diagnóstico por imagem</span></div>
          <button className="sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Fechar menu"><X size={19} /></button>
        </div>
        <nav className="primary-nav" aria-label="Navegação principal">
          <p>MENU</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button className={item.active ? "nav-item active" : "nav-item"} key={item.label}><Icon size={19} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="lara-sidebar"><div className="lara-icon"><Sparkles size={17} /></div><div><strong>Lara IA</strong><small>Atendimento automatizado</small></div></div>
      </aside>
      {mobileNavOpen ? <button className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Fechar menu" /> : null}

      <main className="main-content">
        <header className="topbar">
          <div className="title-wrap">
            <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button>
            <div><h1>Agenda</h1><p>Gerencie os horários e atendimentos da CEDIPI</p></div>
          </div>
          <div className="header-actions">
            <button className="button button-secondary" onClick={() => setSelectedDate(todayInSaoPaulo())}><CalendarDays size={17} /> Hoje</button>
            <button className="button button-primary" onClick={openFirstAvailableSlot} disabled={!selectedDoctor || agendaLoading}><Plus size={18} /> Novo agendamento</button>
          </div>
        </header>

        <section className="doctor-selector" aria-label="Selecionar médico">
          {doctorsLoading ? <div className="inline-state"><RefreshCw className="spin" size={16} /> Carregando médicos...</div> : doctors.map((doctor) => (
            <button key={doctor.id} className={doctor.id === selectedDoctorId ? "doctor-tab selected" : "doctor-tab"} onClick={() => setSelectedDoctorId(doctor.id)}>
              <span className="doctor-avatar">{doctorInitials(doctor.name)}</span><span><strong>{doctor.name}</strong><small>Ultrassonografia</small></span>
              {doctor.id === selectedDoctorId ? <Check className="doctor-check" size={16} /> : null}
            </button>
          ))}
          {!doctorsLoading && doctors.length === 0 ? <div className="inline-state error-state">Nenhum médico disponível.</div> : null}
        </section>

        <section className="lara-banner">
          <div className="lara-banner-icon"><Sparkles size={18} /></div>
          <div><strong>Lara IA <span>Atendimento automático ativo</span></strong><p>Agendamentos realizados pela Lara aparecem automaticamente na agenda.</p></div>
          <WhatsAppConnection />
        </section>

        <section className="summary-row" aria-label="Resumo da agenda">
          <div className="summary-card"><span>Agendamentos hoje</span><strong>{dayAppointments.length}</strong></div>
          <div className="summary-card"><span>Confirmados</span><strong className="text-teal">{confirmedCount}</strong></div>
          <div className="summary-card"><span>Aguardando</span><strong className="text-amber">{pendingCount}</strong></div>
          <div className="summary-card"><span>Horários disponíveis</span><strong className="text-blue">{availableSlots.length}</strong></div>
        </section>

        <section className="calendar-panel">
          <div className="calendar-toolbar">
            <div className="date-navigation">
              <button className="icon-button" onClick={() => setSelectedDate(addDays(selectedDate, viewMode === "day" ? -1 : -7))} aria-label="Data anterior"><ChevronLeft size={19} /></button>
              <div className="date-title"><CalendarDays size={18} /><strong>{capitalize(displayDate(selectedDate))}</strong></div>
              <button className="icon-button" onClick={() => setSelectedDate(addDays(selectedDate, viewMode === "day" ? 1 : 7))} aria-label="Próxima data"><ChevronRight size={19} /></button>
              <button className="today-link" onClick={() => setSelectedDate(todayInSaoPaulo())}>Hoje</button>
            </div>
            <div className="view-toggle" aria-label="Modo de visualização">
              <button className={viewMode === "day" ? "active" : ""} onClick={() => setViewMode("day")}>Dia</button>
              <button className={viewMode === "week" ? "active" : ""} onClick={() => setViewMode("week")}>Semana</button>
            </div>
          </div>

          {agendaLoading ? (
            <div className="agenda-state"><RefreshCw className="spin" size={19} /> Carregando agenda...</div>
          ) : agendaError ? (
            <div className="agenda-state error-state"><AlertTriangle size={19} /><span>{agendaError}</span><button className="button button-secondary" onClick={() => void (selectedDoctor ? loadAgenda() : loadDoctors())}>Tentar novamente</button></div>
          ) : !selectedDoctor ? (
            <div className="agenda-state">Selecione um médico para consultar a agenda.</div>
          ) : viewMode === "day" ? (
            <div className="day-view">
              <div className="agenda-head"><span>HORÁRIO</span><div><span className="head-avatar">{doctorInitials(selectedDoctor.name)}</span><span><strong>{selectedDoctor.name}</strong><small>Agenda do dia</small></span></div><span>ATENDIMENTO</span></div>
              {timelineItems.length > 0 ? (
                <div className="time-grid">
                  {timelineItems.map((item) => (
                    <div className="time-row working" key={`${item.type}-${item.id}`}>
                      <time>{item.time}</time><div className="time-line" />
                      {item.type === "appointment" ? (
                        <button className="appointment-card" onClick={() => setSelectedId(item.appointment.id)}>
                          <span className="appointment-accent" /><span className="appointment-main"><strong>{item.appointment.patientName}</strong><small>{item.appointment.examName || "Exame não informado"}</small></span>
                          <OriginBadge source={item.appointment.source} /><StatusBadge status={item.appointment.status} /><ChevronRight className="appointment-chevron" size={17} />
                        </button>
                      ) : (
                        <button className="available-slot" onClick={() => { setFormError(null); setSelectedSlot(item.slot); }}><Plus size={14} /> Disponível</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="agenda-state empty-state"><CalendarDays size={20} /><strong>Sem horários para esta data</strong><span>Selecione outro dia ou médico para consultar a agenda.</span></div>
              )}
            </div>
          ) : (
            <div className="week-view">
              {weekDays(selectedDate).map((day) => {
                const key = toDateKey(day);
                const dayEvents = appointmentViews.filter((item) => item.doctor.id === selectedDoctorId && item.date === key);
                const daySlots = availableSlotsForAppointments(availabilityByDate[key] ?? [], appointments);
                return (
                  <button className={`week-day ${key === dateKey ? "today" : ""}`} key={key} onClick={() => { setSelectedDate(day); setViewMode("day"); }}>
                    <div className="week-day-head"><span>{day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span><strong>{day.getDate()}</strong></div>
                    <div className="week-hours">{daySlots.length ? daySlots.map((slot) => <span key={slot.id}>{slotLocalParts(slot).time}</span>) : <em>Sem horários</em>}</div>
                    <div className="week-events">
                      {dayEvents.map((item) => <span className="week-event" key={item.id}><time>{item.time}</time><strong>{item.patientName}</strong><small>{item.examName || "Exame não informado"}</small></span>)}
                      {!dayEvents.length && daySlots.length > 0 ? <span className="week-empty">Horários disponíveis</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {selectedAppointment ? (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Detalhes do agendamento">
          <button className="drawer-backdrop" onClick={() => setSelectedId(null)} aria-label="Fechar detalhes" />
          <aside className="details-drawer">
            <div className="drawer-header"><div><span>DETALHES DO AGENDAMENTO</span><h2>{selectedAppointment.patientName}</h2></div><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Fechar"><X size={20} /></button></div>
            <div className="drawer-body">
              <div className="exam-highlight"><div className="exam-icon"><FileText size={19} /></div><div><span>EXAME</span><strong>{selectedAppointment.examName || "Exame não informado"}</strong></div></div>
              <div className="detail-section"><h3>Data e atendimento</h3><div className="detail-grid">
                <div><CalendarDays size={17} /><span><small>Data</small><strong>{displayDate(fromDateKey(selectedAppointment.date), true)}</strong></span></div>
                <div><Clock3 size={17} /><span><small>Horário</small><strong>{selectedAppointment.time} às {selectedAppointment.endTime}</strong></span></div>
                <div><Stethoscope size={17} /><span><small>Médico</small><strong>{selectedAppointment.doctor.name}</strong></span></div>
                <div><MessageCircle size={17} /><span><small>Telefone</small><strong>{selectedAppointment.phone}</strong></span></div>
              </div></div>
              <div className="detail-section detail-pair"><div><h3>Origem</h3><OriginBadge source={selectedAppointment.source} /></div><div><h3>Status</h3><StatusBadge status={selectedAppointment.status} /></div></div>
              <div className="detail-section"><h3>Observações</h3><p className="notes-box">{selectedAppointment.notes || "Nenhuma observação registrada."}</p></div>
            </div>
            <div className="drawer-actions"><button className="text-button" onClick={() => setSelectedId(null)}>Fechar</button></div>
          </aside>
        </div>
      ) : null}

      {selectedSlot ? (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="new-title">
          <button className="modal-backdrop" onClick={() => { if (!submitting) setSelectedSlot(null); }} aria-label="Fechar modal" />
          <div className="modal-card modal-large">
            <div className="modal-header"><div className="modal-title-icon"><CalendarDays size={20} /></div><div><h2 id="new-title">Novo agendamento</h2><p>Preencha os dados para reservar o horário.</p></div><button className="icon-button" onClick={() => setSelectedSlot(null)} aria-label="Fechar" disabled={submitting}><X size={20} /></button></div>
            <form onSubmit={createAppointment}>
              <div className="selected-slot-summary" aria-label="Horário selecionado">
                <span><small>Médico</small><strong>{selectedSlot.doctor.name}</strong></span>
                <span><small>Data</small><strong>{displayDate(fromDateKey(slotLocalParts(selectedSlot).date), true)}</strong></span>
                <span><small>Horário</small><strong>{slotLocalParts(selectedSlot).time} às {slotLocalParts(selectedSlot).endTime}</strong></span>
              </div>
              <div className="form-grid">
                <label className="field span-2"><span>Paciente</span><div className="input-wrap"><UserRound size={17} /><input name="patient" placeholder="Nome completo do paciente" required autoFocus disabled={submitting} /></div></label>
                <label className="field span-2"><span>Telefone</span><div className="input-wrap"><MessageCircle size={17} /><input name="phone" inputMode="tel" placeholder="(00) 00000-0000" required disabled={submitting} /></div></label>
                <label className="field span-2"><span>E-mail <small>(opcional)</small></span><input name="email" type="email" placeholder="paciente@exemplo.com" disabled={submitting} /></label>
                <label className="field span-2"><span>Exame</span><input name="exam" placeholder="Nome do exame" required disabled={submitting} /></label>
                {formError ? <p className="form-error span-4" role="alert">{formError}</p> : null}
              </div>
              <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setSelectedSlot(null)} disabled={submitting}>Cancelar</button><button type="submit" className="button button-primary" disabled={submitting}>{submitting ? <RefreshCw className="spin" size={17} /> : <Check size={18} />}{submitting ? "Confirmando..." : "Confirmar agendamento"}</button></div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`toast toast-${toast.kind}`} role="status"><span>{toast.kind === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}</span>{toast.message}</div> : null}
    </div>
  );
}
