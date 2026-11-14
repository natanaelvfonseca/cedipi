import { FormEvent, useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookOpen, Check, LoaderCircle, Menu, Plus, RefreshCw, Sparkles } from "lucide-react";
import { apiFetch } from "./api-fetch";

type Knowledge = { id: string; title: string; active: boolean; created_at: string };
type Handoff = { id: string; phone: string; reason: string; created_at: string; status: "open" | "closed" };

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
  const [tab,setTab] = useState<"handoffs" | "knowledge">("handoffs");
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [title,setTitle] = useState("");
  const [content,setContent] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [knowledge, handoffsResult] = await Promise.all([
        requestApi<{ ok: true; sources: Knowledge[] }>("/api/lara/knowledge"),
        requestApi<{ ok: true; handoffs: Handoff[] }>("/api/lara/handoffs"),
      ]);
      setSources(knowledge.sources);
      setHandoffs(handoffsResult.handoffs);
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
        <div><h1>Lara IA</h1><p>Conhecimento e encaminhamentos da recepção</p></div>
      </div>
      <button className="button button-secondary" onClick={() => void refresh()} disabled={loading}>
        <RefreshCw size={16} /> Atualizar
      </button>
    </header>
    <div className="lara-admin-intro">
      <Sparkles size={19} />
      <span>A Lara utiliza informações cadastradas e encaminha agendamentos e assuntos sem confirmação para a equipe. Este painel não ativa o envio automático.</span>
    </div>
    <div className="lara-admin-tabs" role="tablist" aria-label="Gestão da Lara">
      <button role="tab" aria-selected={tab === "handoffs"} className={tab === "handoffs" ? "active" : ""}
        onClick={() => setTab("handoffs")}>Encaminhamentos ({handoffs.length})</button>
      <button role="tab" aria-selected={tab === "knowledge"} className={tab === "knowledge" ? "active" : ""}
        onClick={() => setTab("knowledge")}>Base de conhecimento ({sources.length})</button>
    </div>
    {error ? <p className="lara-admin-error" role="alert"><AlertTriangle size={16} /> {error}</p> : null}
    {loading ? <div className="lara-admin-empty"><LoaderCircle className="spin" size={18} /> Carregando...</div>
      : tab === "handoffs" ? (
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
