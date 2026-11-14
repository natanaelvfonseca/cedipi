import { FormEvent, useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookOpen, Check, LoaderCircle, Menu, Plus, RefreshCw, Sparkles } from "lucide-react";
import { apiFetch } from "./api-fetch";

type Knowledge = { id: string; title: string; active: boolean; created_at: string };
type Handoff = { id: string; phone: string; reason: string; created_at: string; status: "open" | "closed" };
type OfficialDoc = { source_number: number; filename: string; imported_at: string };
type Exam = { code: string; name: string; price_cents: number;
  duration_minutes: number | null; doctor_names: string[];
  medical_approval: boolean; doctor_review: boolean; add_on_only: boolean;
  preparation: string | null; notes: string | null };
type Readiness = { officialDocuments: number; officialExams: number;
  schedulesConfigured: number; openaiConfigured: boolean;
  googleCalendarConfigured: boolean; bookingAutoConfirmationAvailable: boolean;
  whatsappTestMode: boolean; nativeCutover: boolean; status: string };
type BookingRequest = { id: string; phone: string; exam_name: string;
  preferred_date: string | null; preferred_start: string | null;
  doctor_name: string | null; patient_name: string | null;
  status: string; created_at: string };

async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw new Error("Falha ao consultar o sistema da Lara.");
  const data = await response.json();
  if (!data.ok) throw new Error("Resposta inválida do sistema.");
  return data as T;
}
const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
});
const reasonLabel: Record<string,string> = {
  scheduling: "Agendamento e horários",
  human: "Solicitou atendimento humano",
  urgent: "Situação de urgência",
  unknown_information: "Informação não confirmada",
  rate_limit: "Limite de respostas",
  delivery_uncertain: "Envio não confirmado",
  delivery_ack_missing: "Confirmação de WhatsApp ausente",
  handoff_pause_failed: "Falha ao pausar a IA",
  confirmation_uncertain: "Confirmação de entrega incerta",
  processing_failed: "Falha no processamento",
  unsafe_generated_response: "Resposta gerada não validada",
};

export function LaraManagement({
  openMobileMenu, notify,
}: {
  openMobileMenu: () => void;
  notify: (message: string, kind: "success" | "error") => void;
}) {
  const [sources,setSources] = useState<Knowledge[]>([]);
  const [handoffs,setHandoffs] = useState<Handoff[]>([]);
  const [exams,setExams] = useState<Exam[]>([]);
  const [bookingRequests,setBookingRequests] = useState<BookingRequest[]>([]);
  const [search,setSearch] = useState("");
  const [readiness,setReadiness] = useState<Readiness | null>(null);
  const [officialDocs,setOfficialDocs] = useState<OfficialDoc[]>([]);
  const [openedDoc,setOpenedDoc] = useState<number | null>(null);
  const [openedContent,setOpenedContent] = useState("");
  const [loadingDoc,setLoadingDoc] = useState(false);
  const [tab,setTab] = useState<"handoffs" | "knowledge" | "catalog" | "requests" | "documents">("catalog");
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [title,setTitle] = useState("");
  const [content,setContent] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [knowledge, handoffsResult, catalog, bookings, statusResult] = await Promise.all([
        requestApi<{ ok: true; sources: Knowledge[] }>("/api/lara/knowledge"),
        requestApi<{ ok: true; handoffs: Handoff[] }>("/api/lara/handoffs"),
        requestApi<{ ok: true; exams: Exam[]; documents: OfficialDoc[] }>("/api/lara/catalog"),
        requestApi<{ ok: true; requests: BookingRequest[] }>("/api/lara/booking-requests"),
        requestApi<{ ok: true; readiness: Readiness }>("/api/lara/readiness"),
      ]);
      setSources(knowledge.sources);
      setHandoffs(handoffsResult.handoffs);
      setExams(catalog.exams);
      setOfficialDocs(catalog.documents);
      setBookingRequests(bookings.requests);
      setReadiness(statusResult.readiness);
    } catch {
      setError("Não foi possível consultar os dados da Lara. Confira a conexão e as migrations.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function createSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving || !title.trim() || !content.trim()) return;
    setSaving(true); setError(null);
    try {
      await requestApi("/api/lara/knowledge", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      setTitle(""); setContent("");
      notify("Fonte de conhecimento cadastrada.", "success");
      await refresh();
    } catch {
      setError("Não foi possível cadastrar a informação. Tente novamente.");
    } finally { setSaving(false); }
  }

  async function toggleSource(source: Knowledge) {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      await requestApi("/api/lara/knowledge/" + encodeURIComponent(source.id), {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !source.active }),
      });
      notify(source.active ? "Fonte desativada." : "Fonte ativada.", "success");
      await refresh();
    } catch { setError("Não foi possível alterar a fonte."); }
    finally { setSaving(false); }
  }

  async function openOfficialDoc(item: OfficialDoc) {
    if (loadingDoc) return;
    if (openedDoc===item.source_number) { setOpenedDoc(null); setOpenedContent(""); return; }
    setLoadingDoc(true);
    try {
      const detail = await requestApi<{ok:true;content:string}>(
        "/api/lara/official-documents/" + item.source_number
      );
      setOpenedDoc(item.source_number);
      setOpenedContent(detail.content);
    } catch {
      setError("Não foi possível abrir o documento oficial.");
    } finally {setLoadingDoc(false);}
  }

  async function closeHandoff(item: Handoff) {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      await requestApi("/api/lara/handoffs/" + encodeURIComponent(item.id) + "/close",
        { method: "POST" });
      notify("Encaminhamento concluído. Reative a Lara na conversa apenas se necessário.", "success");
      await refresh();
    } catch { setError("Não foi possível concluir o atendimento."); }
    finally { setSaving(false); }
  }

  return <>
    <header className="topbar">
      <div className="title-wrap">
        <button className="mobile-menu" onClick={openMobileMenu} aria-label="Abrir menu"><Menu size={21} /></button>
        <div><h1>Lara IA</h1><p>Catálogo oficial, solicitações e encaminhamentos</p></div>
      </div>
      <button className="button button-secondary" onClick={() => void refresh()} disabled={loading}>
        <RefreshCw size={16} /> Atualizar
      </button>
    </header>
    <div className="lara-admin-intro">
      <Sparkles size={19} />
      <span>Base oficial CEDIPI: médicos, valores, durações e preparos. Os horários exibidos pela IA são preliminares até a conferência da agenda externa e, quando aplicável, a aprovação médica. Este painel não ativa envios automáticos.</span>
    </div>
    {readiness ? <div className="lara-admin-panel">
      <strong>Prontidão operacional</strong>
      <p className="lara-admin-note">
        {readiness.officialDocuments}/6 documentos importados · {readiness.officialExams}/47 exames · {readiness.schedulesConfigured}/3 médicos cadastrados.
        {" "}OpenAI: {readiness.openaiConfigured ? "configurada" : "credencial pendente"}.
        {" "}Google Agenda: {readiness.googleCalendarConfigured ? "credencial configurada" : "credencial pendente"}.
        {" "}Atendimento: {readiness.nativeCutover ? "Lara nativa" : readiness.whatsappTestMode ? "teste de WhatsApp limitado" : "webhook anterior"}.
        {" "}Confirmação automática de agendamentos: não habilitada enquanto não houver validação da agenda externa.
      </p>
    </div> : null}
    <div className="lara-admin-tabs" role="tablist" aria-label="Gestão da Lara">
      <button role="tab" aria-selected={tab === "catalog"} className={tab === "catalog" ? "active" : ""}
        onClick={() => setTab("catalog")}>Catálogo oficial ({exams.length})</button>
      <button role="tab" aria-selected={tab === "requests"} className={tab === "requests" ? "active" : ""}
        onClick={() => setTab("requests")}>Solicitações ({bookingRequests.length})</button>
      <button role="tab" aria-selected={tab === "documents"} className={tab === "documents" ? "active" : ""}
        onClick={() => setTab("documents")}>Documentos ({officialDocs.length})</button>
      <button role="tab" aria-selected={tab === "handoffs"} className={tab === "handoffs" ? "active" : ""}
        onClick={() => setTab("handoffs")}>Encaminhamentos ({handoffs.length})</button>
      <button role="tab" aria-selected={tab === "knowledge"} className={tab === "knowledge" ? "active" : ""}
        onClick={() => setTab("knowledge")}>Base de conhecimento ({sources.length})</button>
    </div>
    {error ? <p className="lara-admin-error" role="alert"><AlertTriangle size={16} /> {error}</p> : null}
    {loading ? <div className="lara-admin-empty"><LoaderCircle className="spin" size={18} /> Carregando...</div>
      : tab === "catalog" ? (
        <section className="lara-admin-panel">
          <h2>Exames e procedimentos homologados</h2>
          <p className="lara-admin-note">Valores e médicos dos documentos oficiais. Procedimentos com duração desconhecida ou sujeitos a aprovação médica são encaminhados à recepção antes da confirmação.</p>
          <input aria-label="Pesquisar exame" value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar por exame, parte do corpo ou médico..." />
          {!exams.length ? <p className="lara-admin-empty">Nenhum exame importado. Confira a importação dos documentos oficiais.</p> :
            <div className="lara-admin-list">{exams.filter((exam) =>
              [exam.name,...exam.doctor_names].join(" ").toLocaleLowerCase("pt-BR")
              .includes(search.toLocaleLowerCase("pt-BR"))).map((exam) => (
              <div className="lara-admin-item" key={exam.code}>
                <span><strong>{exam.name}</strong>
                  <small>{(exam.price_cents / 100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
                    {" · "}{exam.duration_minutes ? exam.duration_minutes + " min" : "Duração sob revisão"}
                    {" · "}{exam.doctor_names.map((name) => "Dr. " + name).join(" / ")}</small>
                  {exam.medical_approval || exam.doctor_review ?
                    <small>Requer conferência da equipe {exam.medical_approval ? "e aprovação médica" : ""}</small> : null}
                  {exam.preparation ? <small>Preparo: {exam.preparation}</small> : null}
                </span>
              </div>
            ))}</div>}
        </section>
      ) : tab === "documents" ? (
        <section className="lara-admin-panel">
          <h2>Seis documentos oficiais CEDIPI</h2>
          <p className="lara-admin-note">Consulta administrativa restrita. Contém protocolos clínicos e, em pagamentos, dados Pix. A Lara não entrega esses detalhes automaticamente sem validação.</p>
          {!officialDocs.length ? <p className="lara-admin-empty">Documentos não importados.</p> :
            <div className="lara-admin-list">{officialDocs.map((item) => (
              <div className="lara-admin-item" key={item.source_number}>
                <span><strong>{item.source_number}. {item.filename}</strong>
                  <small>Fonte oficial conferida</small>
                  {openedDoc===item.source_number ?
                    <pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit",fontSize:"0.86rem",
                      marginTop:12,maxHeight:500,overflowY:"auto"}}>{openedContent}</pre> : null}
                </span>
                <button className="button button-secondary" disabled={loadingDoc}
                  onClick={() => void openOfficialDoc(item)}>
                  {openedDoc===item.source_number?"Fechar":"Consultar"}
                </button>
              </div>
            ))}</div>}
        </section>
      ) : tab === "requests" ? (
        <section className="lara-admin-panel">
          <h2>Solicitações aguardando conferência</h2>
          <p className="lara-admin-note">Estas solicitações NÃO são agendamentos confirmados. Confira a agenda externa, o procedimento e a eventual taxa antes de finalizar o atendimento na conversa.</p>
          {!bookingRequests.length ? <p className="lara-admin-empty">Nenhuma solicitação pendente.</p> :
            <div className="lara-admin-list">{bookingRequests.map((item) => (
              <div className="lara-admin-item" key={item.id}>
                <span><strong>{item.exam_name}</strong>
                  <small>{item.patient_name || "Nome pendente"} · {item.phone}</small>
                  <small>{item.preferred_start
                    ? dateFormat.format(new Date(item.preferred_start)) : "Data a confirmar"}
                    {item.doctor_name ? " · Dr. " + item.doctor_name : ""}</small>
                  <small>{item.status === "awaiting_medical_approval"
                    ? "Aguardando aprovação médica e confirmação da agenda"
                    : "Aguardando verificação de disponibilidade pela recepção"}</small>
                </span>
              </div>
            ))}</div>}
        </section>
      ) : tab === "handoffs" ? (
      <section className="lara-admin-panel">
        <h2>Atendimentos aguardando a recepção</h2>
        <p className="lara-admin-note">Verifique a conversa no menu Conversas antes de marcar como concluída. Encerrar aqui não reativa a IA automaticamente.</p>
        {!handoffs.length ? <p className="lara-admin-empty">Nenhum encaminhamento pendente.</p> :
          <div className="lara-admin-list">{handoffs.map((item) => (
            <div className="lara-admin-item" key={item.id}>
              <span><strong>{item.phone}</strong><small>{reasonLabel[item.reason] ?? "Revisão humana"} · {dateFormat.format(new Date(item.created_at))}</small></span>
              <button className="button button-secondary" disabled={saving}
                onClick={() => void closeHandoff(item)}><Check size={15} /> Concluir</button>
            </div>
          ))}</div>}
      </section>
    ) : (
      <div className="lara-admin-columns">
        <section className="lara-admin-panel">
          <h2><BookOpen size={18} /> Informações autorizadas</h2>
          <p className="lara-admin-note">Cadastre apenas dados oficiais da clínica. Não inclua nomes de pacientes, laudos ou documentos médicos.</p>
          {!sources.length ? <p className="lara-admin-empty">Nenhuma fonte cadastrada.</p> :
            <div className="lara-admin-list">{sources.map((source) => (
              <div className="lara-admin-item" key={source.id}>
                <span><strong>{source.title}</strong><small>{source.active ? "Ativa para consulta" : "Desativada"}</small></span>
                <button className="button button-secondary" disabled={saving}
                  onClick={() => void toggleSource(source)}>{source.active ? "Desativar" : "Ativar"}</button>
              </div>
            ))}</div>}
        </section>
        <section className="lara-admin-panel">
          <h2><Plus size={18} /> Nova fonte</h2>
          <form className="lara-admin-form" onSubmit={(event) => void createSource(event)}>
            <label>Título da informação<input value={title} onChange={(event) => setTitle(event.target.value)}
              maxLength={200} required placeholder="Ex.: Endereço e horário de atendimento" /></label>
            <label>Conteúdo confirmado<textarea value={content} onChange={(event) => setContent(event.target.value)}
              maxLength={40000} rows={9} required placeholder="Informações da clínica, sem dados de pacientes." /></label>
            <button className="button button-primary" disabled={saving || !title.trim() || !content.trim()}>
              <Plus size={16} /> {saving ? "Salvando..." : "Cadastrar fonte"}
            </button>
          </form>
        </section>
      </div>
    )}
  </>;
}
