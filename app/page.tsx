"use client";

import {
  AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, CircleUserRound, Clock3,
  FileText, Menu, MessageCircle, Plus, RefreshCw, Settings, Sparkles, Stethoscope,
  UserRound, UsersRound, X, XCircle,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type DoctorId = "danilo" | "wagner" | "deison";
type Status = "Confirmado" | "Aguardando confirmação" | "Cancelado";
type Origin = "Lara IA" | "Recepção" | "WhatsApp";
type ViewMode = "day" | "week";

type Appointment = {
  id: number; doctorId: DoctorId; patient: string; phone: string; exam: string;
  date: string; time: string; endTime: string; origin: Origin; status: Status; notes: string;
};

type Doctor = {
  id: DoctorId; name: string; initials: string; demoDate: Date;
  schedule: Record<number, [string, string][]>;
};

const doctors: Doctor[] = [
  {
    id: "danilo", name: "Dr. Danilo", initials: "DD", demoDate: new Date(2026, 7, 31, 12),
    schedule: {
      1: [["09:00", "12:00"], ["14:00", "18:00"]], 2: [["14:00", "18:00"]],
      3: [["09:00", "12:00"]], 4: [["09:00", "12:00"], ["14:00", "18:00"]],
      5: [["14:00", "18:00"]],
    },
  },
  {
    id: "wagner", name: "Dr. Wagner", initials: "DW", demoDate: new Date(2026, 8, 1, 12),
    schedule: { 2: [["09:00", "12:00"]], 3: [["14:00", "18:00"]], 5: [["09:00", "12:00"]] },
  },
  {
    id: "deison", name: "Dr. Deison", initials: "DD", demoDate: new Date(2026, 8, 2, 12),
    schedule: { 3: [["15:00", "16:40"]], 5: [["15:00", "16:40"]] },
  },
];

const initialAppointments: Appointment[] = [
  { id: 1, doctorId: "danilo", patient: "Maria Oliveira", phone: "(11) 98745-3210", exam: "Ultrassom de abdômen total", date: "2026-08-31", time: "09:00", endTime: "09:20", origin: "WhatsApp", status: "Confirmado", notes: "Paciente orientada sobre jejum de 6 horas." },
  { id: 2, doctorId: "danilo", patient: "Ana Paula Santos", phone: "(11) 99624-8137", exam: "Ultrassom transvaginal", date: "2026-08-31", time: "10:00", endTime: "10:20", origin: "Lara IA", status: "Confirmado", notes: "Agendamento concluído automaticamente pelo atendimento da Lara." },
  { id: 3, doctorId: "danilo", patient: "Carlos Mendes", phone: "(11) 98802-4401", exam: "Doppler venoso de membro inferior", date: "2026-08-31", time: "11:20", endTime: "11:40", origin: "Recepção", status: "Aguardando confirmação", notes: "Aguardando retorno do paciente pelo WhatsApp." },
  { id: 4, doctorId: "danilo", patient: "Fernanda Lima", phone: "(11) 98218-7654", exam: "Ultrassom de tireoide", date: "2026-08-31", time: "14:40", endTime: "15:00", origin: "Lara IA", status: "Confirmado", notes: "Paciente recebeu as orientações de preparo." },
  { id: 5, doctorId: "danilo", patient: "Juliana Rocha", phone: "(11) 99122-3055", exam: "Ultrassom de mama", date: "2026-08-31", time: "16:00", endTime: "16:20", origin: "Recepção", status: "Confirmado", notes: "Trazer exames anteriores para comparação." },
  { id: 6, doctorId: "wagner", patient: "Roberto Nascimento", phone: "(11) 98170-6492", exam: "Ultrassom de próstata", date: "2026-09-01", time: "09:20", endTime: "09:40", origin: "Lara IA", status: "Confirmado", notes: "Orientações enviadas pela Lara." },
  { id: 7, doctorId: "wagner", patient: "Sônia Martins", phone: "(11) 99028-1160", exam: "Ultrassom pélvico", date: "2026-09-01", time: "10:20", endTime: "10:40", origin: "Recepção", status: "Aguardando confirmação", notes: "Contato realizado pela recepção." },
  { id: 8, doctorId: "deison", patient: "Patrícia Gomes", phone: "(11) 97420-8993", exam: "Doppler de carótidas", date: "2026-09-02", time: "15:00", endTime: "15:20", origin: "WhatsApp", status: "Confirmado", notes: "Chegar com 15 minutos de antecedência." },
];

const navItems = [
  { label: "Agenda", icon: CalendarDays, active: true }, { label: "Pacientes", icon: UsersRound },
  { label: "Médicos", icon: Stethoscope }, { label: "Configurações", icon: Settings },
];

const exams = [
  "Ultrassom de abdômen total", "Ultrassom transvaginal", "Ultrassom de tireoide",
  "Ultrassom de mama", "Doppler venoso de membro inferior", "Doppler de carótidas",
  "Ultrassom pélvico", "Ultrassom de próstata",
];

const slotTimes = Array.from({ length: 31 }, (_, index) => {
  const total = 8 * 60 + index * 20;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
});

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
function addMinutes(time: string, amount: number) {
  const total = toMinutes(time) + amount;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
function addDays(date: Date, amount: number) {
  const next = new Date(date); next.setDate(next.getDate() + amount); return next;
}
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function displayDate(date: Date, includeYear = false) {
  return date.toLocaleDateString("pt-BR", { weekday: includeYear ? undefined : "long", day: "numeric", month: "long", year: includeYear ? "numeric" : undefined });
}
function isWithinSchedule(doctor: Doctor, date: Date, time: string) {
  const ranges = doctor.schedule[date.getDay()] ?? []; const current = toMinutes(time);
  return ranges.some(([start, end]) => current >= toMinutes(start) && current < toMinutes(end));
}
function isOffHoursLabel(doctor: Doctor, date: Date, time: string) {
  return time === "08:00" || isWithinSchedule(doctor, date, addMinutes(time, -20));
}
function weekDays(date: Date) {
  const monday = addDays(date, date.getDay() === 0 ? -6 : 1 - date.getDay());
  return Array.from({ length: 5 }, (_, index) => addDays(monday, index));
}

function OriginBadge({ origin }: { origin: Origin }) {
  const Icon = origin === "Lara IA" ? Sparkles : origin === "WhatsApp" ? MessageCircle : UserRound;
  return <span className={`origin-badge origin-${origin.toLowerCase().replace(" ", "-")}`}><Icon size={12} strokeWidth={2.2} />{origin}</span>;
}
function StatusBadge({ status }: { status: Status }) {
  const className = status === "Confirmado" ? "confirmed" : status === "Cancelado" ? "cancelled" : "pending";
  return <span className={`status-badge status-${className}`}>{status}</span>;
}

type WhatsAppStatus = "connected" | "disconnected" | "connecting" | "unknown";
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

  const labels: Record<WhatsAppStatus, string> = {
    connected: "WhatsApp conectado",
    disconnected: "WhatsApp desconectado",
    connecting: "Conectando...",
    unknown: "Não foi possível verificar a conexão",
  };

  return (
    <>
      <div className="whatsapp-control">
        <div className={`whatsapp-state whatsapp-${instance.status}`}>
          {instance.status === "unknown" ? <AlertTriangle size={13} /> : <i />}
          <span><strong>{loading ? "Verificando WhatsApp..." : labels[instance.status]}</strong><small>{instance.profileName || instance.name}{instance.phoneNumber ? ` · ${instance.phoneNumber}` : ""}</small></span>
        </div>
        {instance.status === "disconnected" ? (
          <button className="whatsapp-action" onClick={connect} disabled={connecting}>{connecting ? "Gerando QR..." : "Conectar WhatsApp"}</button>
        ) : (
          <button className="whatsapp-refresh" onClick={() => void refreshStatus()} disabled={loading} aria-label="Atualizar estado do WhatsApp"><RefreshCw size={13} /></button>
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
  const [selectedDoctorId, setSelectedDoctorId] = useState<DoctorId>("danilo");
  const [selectedDate, setSelectedDate] = useState(new Date(2026, 7, 31, 12));
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [appointments, setAppointments] = useState(initialAppointments);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newModal, setNewModal] = useState<{ open: boolean; time?: string }>({ open: false });
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const selectedDoctor = doctors.find((doctor) => doctor.id === selectedDoctorId)!;
  const selectedAppointment = appointments.find((appointment) => appointment.id === selectedId) ?? null;
  const dateKey = toDateKey(selectedDate);
  const dayAppointments = appointments.filter((appointment) => appointment.doctorId === selectedDoctorId && appointment.date === dateKey);
  const workingSlots = slotTimes.filter((time) => isWithinSchedule(selectedDoctor, selectedDate, time));
  const availableCount = Math.max(0, workingSlots.length - dayAppointments.length);
  const confirmedCount = dayAppointments.filter((appointment) => appointment.status === "Confirmado").length;
  const pendingCount = dayAppointments.filter((appointment) => appointment.status === "Aguardando confirmação").length;
  const availableTimes = useMemo(() => workingSlots.filter((time) => !dayAppointments.some((appointment) => appointment.time === time)), [workingSlots, dayAppointments]);

  function showToast(message: string) {
    setToast(message); window.setTimeout(() => setToast(null), 3200);
  }
  function selectDoctor(id: DoctorId) {
    const doctor = doctors.find((item) => item.id === id)!;
    setSelectedDoctorId(id); setSelectedDate(doctor.demoDate);
  }
  function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const doctorId = form.get("doctor") as DoctorId; const date = String(form.get("date")); const time = String(form.get("time"));
    const appointment: Appointment = {
      id: Date.now(), doctorId, patient: String(form.get("patient")), phone: String(form.get("phone")),
      exam: String(form.get("exam")), date, time, endTime: addMinutes(time, 20), origin: "Recepção",
      status: "Confirmado", notes: String(form.get("notes") ?? ""),
    };
    setAppointments((current) => [...current, appointment]); setSelectedDoctorId(doctorId);
    setSelectedDate(fromDateKey(date)); setNewModal({ open: false }); showToast("Agendamento realizado com sucesso.");
  }
  function rescheduleAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedAppointment) return; const form = new FormData(event.currentTarget);
    const date = String(form.get("date")); const time = String(form.get("time"));
    setAppointments((current) => current.map((appointment) => appointment.id === selectedAppointment.id ? { ...appointment, date, time, endTime: addMinutes(time, 20) } : appointment));
    setSelectedDate(fromDateKey(date)); setRescheduleOpen(false); setSelectedId(null); showToast("Agendamento remarcado com sucesso.");
  }
  function cancelAppointment() {
    if (!selectedAppointment) return;
    setAppointments((current) => current.filter((appointment) => appointment.id !== selectedAppointment.id));
    setCancelOpen(false); setSelectedId(null); showToast("Agendamento cancelado. O horário está disponível novamente.");
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
        <div className="lara-sidebar"><div className="lara-icon"><Sparkles size={17} /></div><div><strong>Lara IA</strong><span><i /> Online</span><small>Atendimento automático ativo</small></div></div>
      </aside>
      {mobileNavOpen && <button className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Fechar menu" />}

      <main className="main-content">
        <header className="topbar">
          <div className="title-wrap">
            <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button>
            <div><h1>Agenda</h1><p>Gerencie os horários e atendimentos da CEDIPI</p></div>
          </div>
          <div className="header-actions">
            <button className="button button-secondary" onClick={() => setSelectedDate(new Date(2026, 7, 28, 12))}><CalendarDays size={17} /> Hoje</button>
            <button className="button button-primary" onClick={() => setNewModal({ open: true })}><Plus size={18} /> Novo agendamento</button>
          </div>
        </header>

        <section className="doctor-selector" aria-label="Selecionar médico">
          {doctors.map((doctor) => (
            <button key={doctor.id} className={doctor.id === selectedDoctorId ? "doctor-tab selected" : "doctor-tab"} onClick={() => selectDoctor(doctor.id)}>
              <span className="doctor-avatar">{doctor.initials}</span><span><strong>{doctor.name}</strong><small>Ultrassonografia</small></span>
              {doctor.id === selectedDoctorId && <Check className="doctor-check" size={16} />}
            </button>
          ))}
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
          <div className="summary-card"><span>Horários disponíveis</span><strong className="text-blue">{availableCount}</strong></div>
        </section>

        <section className="calendar-panel">
          <div className="calendar-toolbar">
            <div className="date-navigation">
              <button className="icon-button" onClick={() => setSelectedDate(addDays(selectedDate, viewMode === "day" ? -1 : -7))} aria-label="Data anterior"><ChevronLeft size={19} /></button>
              <div className="date-title"><CalendarDays size={18} /><strong>{capitalize(displayDate(selectedDate))}</strong></div>
              <button className="icon-button" onClick={() => setSelectedDate(addDays(selectedDate, viewMode === "day" ? 1 : 7))} aria-label="Próxima data"><ChevronRight size={19} /></button>
              <button className="today-link" onClick={() => setSelectedDate(new Date(2026, 7, 28, 12))}>Hoje</button>
            </div>
            <div className="view-toggle" aria-label="Modo de visualização">
              <button className={viewMode === "day" ? "active" : ""} onClick={() => setViewMode("day")}>Dia</button>
              <button className={viewMode === "week" ? "active" : ""} onClick={() => setViewMode("week")}>Semana</button>
            </div>
          </div>

          {viewMode === "day" ? (
            <div className="day-view">
              <div className="agenda-head"><span>HORÁRIO</span><div><span className="head-avatar">{selectedDoctor.initials}</span><span><strong>{selectedDoctor.name}</strong><small>Agenda do dia</small></span></div><span>ATENDIMENTO</span></div>
              <div className="time-grid">
                {slotTimes.map((time) => {
                  const appointment = dayAppointments.find((item) => item.time === time); const working = isWithinSchedule(selectedDoctor, selectedDate, time);
                  return (
                    <div className={`time-row ${working ? "working" : "off-hours"}`} key={time}>
                      <time>{time}</time><div className="time-line" />
                      {appointment ? (
                        <button className="appointment-card" onClick={() => setSelectedId(appointment.id)}>
                          <span className="appointment-accent" /><span className="appointment-main"><strong>{appointment.patient}</strong><small>{appointment.exam}</small></span>
                          <OriginBadge origin={appointment.origin} /><StatusBadge status={appointment.status} /><ChevronRight className="appointment-chevron" size={17} />
                        </button>
                      ) : working ? (
                        <button className="available-slot" onClick={() => setNewModal({ open: true, time })}><Plus size={14} /> Disponível</button>
                      ) : isOffHoursLabel(selectedDoctor, selectedDate, time) ? (
                        <span className="off-hours-label"><Clock3 size={14} /> Fora do horário de atendimento</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="week-view">
              {weekDays(selectedDate).map((day) => {
                const key = toDateKey(day); const dayEvents = appointments.filter((item) => item.doctorId === selectedDoctorId && item.date === key);
                const ranges = selectedDoctor.schedule[day.getDay()] ?? [];
                return (
                  <button className={`week-day ${key === dateKey ? "today" : ""}`} key={key} onClick={() => { setSelectedDate(day); setViewMode("day"); }}>
                    <div className="week-day-head"><span>{day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span><strong>{day.getDate()}</strong></div>
                    <div className="week-hours">{ranges.length ? ranges.map(([start, end]) => <span key={start}>{start}–{end}</span>) : <em>Sem atendimento</em>}</div>
                    <div className="week-events">
                      {dayEvents.map((item) => <span className="week-event" key={item.id}><time>{item.time}</time><strong>{item.patient}</strong><small>{item.exam}</small></span>)}
                      {!dayEvents.length && ranges.length > 0 && <span className="week-empty">Horários disponíveis</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {selectedAppointment && (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Detalhes do agendamento">
          <button className="drawer-backdrop" onClick={() => setSelectedId(null)} aria-label="Fechar detalhes" />
          <aside className="details-drawer">
            <div className="drawer-header"><div><span>DETALHES DO AGENDAMENTO</span><h2>{selectedAppointment.patient}</h2></div><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Fechar"><X size={20} /></button></div>
            <div className="drawer-body">
              <div className="exam-highlight"><div className="exam-icon"><FileText size={19} /></div><div><span>EXAME</span><strong>{selectedAppointment.exam}</strong></div></div>
              <div className="detail-section"><h3>Data e atendimento</h3><div className="detail-grid">
                <div><CalendarDays size={17} /><span><small>Data</small><strong>{displayDate(fromDateKey(selectedAppointment.date), true)}</strong></span></div>
                <div><Clock3 size={17} /><span><small>Horário</small><strong>{selectedAppointment.time} às {selectedAppointment.endTime}</strong></span></div>
                <div><Stethoscope size={17} /><span><small>Médico</small><strong>{doctors.find((item) => item.id === selectedAppointment.doctorId)?.name}</strong></span></div>
                <div><MessageCircle size={17} /><span><small>Telefone</small><strong>{selectedAppointment.phone}</strong></span></div>
              </div></div>
              <div className="detail-section detail-pair"><div><h3>Origem</h3><OriginBadge origin={selectedAppointment.origin} /></div><div><h3>Status</h3><StatusBadge status={selectedAppointment.status} /></div></div>
              <div className="detail-section"><h3>Observações</h3><p className="notes-box">{selectedAppointment.notes || "Nenhuma observação registrada."}</p></div>
            </div>
            <div className="drawer-actions"><button className="button button-secondary full" onClick={() => setRescheduleOpen(true)}><CalendarDays size={17} /> Remarcar</button><button className="button button-danger full" onClick={() => setCancelOpen(true)}><XCircle size={17} /> Cancelar agendamento</button><button className="text-button" onClick={() => setSelectedId(null)}>Fechar</button></div>
          </aside>
        </div>
      )}

      {newModal.open && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="new-title">
          <button className="modal-backdrop" onClick={() => setNewModal({ open: false })} aria-label="Fechar modal" />
          <div className="modal-card modal-large">
            <div className="modal-header"><div className="modal-title-icon"><CalendarDays size={20} /></div><div><h2 id="new-title">Novo agendamento</h2><p>Preencha os dados para reservar o horário.</p></div><button className="icon-button" onClick={() => setNewModal({ open: false })} aria-label="Fechar"><X size={20} /></button></div>
            <form onSubmit={createAppointment}>
              <div className="form-grid">
                <label className="field span-2"><span>Paciente</span><div className="input-wrap"><UserRound size={17} /><input name="patient" placeholder="Nome completo do paciente" required autoFocus /></div></label>
                <label className="field span-2"><span>Telefone</span><div className="input-wrap"><MessageCircle size={17} /><input name="phone" placeholder="(00) 00000-0000" required /></div></label>
                <label className="field span-4"><span>Exame</span><select name="exam" required defaultValue=""><option value="" disabled>Selecione o exame</option>{exams.map((exam) => <option key={exam}>{exam}</option>)}</select></label>
                <label className="field span-2"><span>Médico</span><select name="doctor" defaultValue={selectedDoctorId}>{doctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.name}</option>)}</select></label>
                <label className="field span-1"><span>Data</span><input type="date" name="date" defaultValue={dateKey} required /></label>
                <label className="field span-1"><span>Horário</span><select name="time" defaultValue={newModal.time ?? availableTimes[0] ?? "09:00"}>{slotTimes.map((time) => <option key={time}>{time}</option>)}</select></label>
                <label className="field span-4"><span>Observações <small>(opcional)</small></span><textarea name="notes" placeholder="Orientações ou informações importantes" rows={3} /></label>
              </div>
              <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setNewModal({ open: false })}>Cancelar</button><button type="submit" className="button button-primary"><Check size={18} /> Confirmar agendamento</button></div>
            </form>
          </div>
        </div>
      )}

      {rescheduleOpen && selectedAppointment && (
        <div className="modal-layer modal-top" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
          <button className="modal-backdrop" onClick={() => setRescheduleOpen(false)} aria-label="Fechar modal" />
          <div className="modal-card modal-compact">
            <div className="modal-header"><div className="modal-title-icon"><CalendarDays size={20} /></div><div><h2 id="reschedule-title">Remarcar atendimento</h2><p>Escolha uma nova data e horário.</p></div><button className="icon-button" onClick={() => setRescheduleOpen(false)} aria-label="Fechar"><X size={20} /></button></div>
            <form onSubmit={rescheduleAppointment}><div className="patient-mini"><CircleUserRound size={20} /><span><strong>{selectedAppointment.patient}</strong><small>{selectedAppointment.exam}</small></span></div><div className="form-grid"><label className="field span-2"><span>Nova data</span><input type="date" name="date" defaultValue={selectedAppointment.date} required /></label><label className="field span-2"><span>Novo horário</span><select name="time" defaultValue={selectedAppointment.time}>{slotTimes.map((time) => <option key={time}>{time}</option>)}</select></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setRescheduleOpen(false)}>Voltar</button><button type="submit" className="button button-primary">Confirmar novo horário</button></div></form>
          </div>
        </div>
      )}

      {cancelOpen && selectedAppointment && (
        <div className="modal-layer modal-top" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title">
          <button className="modal-backdrop" onClick={() => setCancelOpen(false)} aria-label="Fechar confirmação" />
          <div className="modal-card confirm-card"><div className="danger-icon"><XCircle size={25} /></div><h2 id="cancel-title">Cancelar agendamento?</h2><p>O atendimento de <strong>{selectedAppointment.patient}</strong> será removido e esse horário ficará disponível novamente.</p><div className="modal-actions"><button className="button button-secondary" onClick={() => setCancelOpen(false)}>Voltar</button><button className="button button-danger solid" onClick={cancelAppointment}>Cancelar agendamento</button></div></div>
        </div>
      )}
      {toast && <div className="toast" role="status"><span><Check size={16} /></span>{toast}</div>}
    </div>
  );
}
