import { AlertTriangle, CheckCircle2, MessageCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  connectWhatsAppInstance,
  disconnectWhatsAppInstance,
  formatWhatsAppPhone,
  getWhatsAppInstance,
  type WhatsAppInstance,
} from "./whatsapp-instance-api";
import { getWhatsAppPresentation } from "./whatsapp-status";
import { startControlledPolling } from "./whatsapp-model";

const unavailableInstance: WhatsAppInstance = {
  name: "Cedipi",
  status: "unknown",
  connected: false,
  phoneNumber: null,
  profileName: null,
};

export function WhatsAppSidebarStatus() {
  const [instance, setInstance] = useState<WhatsAppInstance>(unavailableInstance);
  const [loading, setLoading] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [action, setAction] = useState<"connect" | "disconnect" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectedSuccess, setConnectedSuccess] = useState(false);
  const requestActive = useRef(false);
  const statusRequestVersion = useRef(0);
  const qrVisible = useRef(false);

  const refreshStatus = useCallback(async (signal?: AbortSignal, force = false) => {
    if (requestActive.current && !force) return;
    const version = statusRequestVersion.current + 1;
    statusRequestVersion.current = version;
    requestActive.current = true;
    try {
      const next = await getWhatsAppInstance(signal);
      if (signal?.aborted || statusRequestVersion.current !== version) return;
      setInstance(next);
      if (next.connected && qrVisible.current) {
        qrVisible.current = false;
        setQrCode(null);
        setConnectedSuccess(true);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (statusRequestVersion.current === version) setInstance(unavailableInstance);
    } finally {
      if (statusRequestVersion.current === version) {
        requestActive.current = false;
        if (!signal?.aborted) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshStatus(controller.signal);
    const polling = startControlledPolling({
      task: () => refreshStatus(controller.signal),
      intervalMs: managerOpen && qrCode ? 2_000 : 15_000,
    });
    return () => {
      controller.abort();
      polling.stop();
      requestActive.current = false;
    };
  }, [managerOpen, qrCode, refreshStatus]);

  function openManager() {
    setManagerOpen(true);
    setConfirmDisconnect(false);
    setActionError(null);
    setConnectedSuccess(false);
  }

  function closeManager() {
    setManagerOpen(false);
    setConfirmDisconnect(false);
    setActionError(null);
    setConnectedSuccess(false);
    setQrCode(null);
    qrVisible.current = false;
  }

  async function connect() {
    if (action) return;
    statusRequestVersion.current += 1;
    requestActive.current = false;
    setAction("connect");
    setActionError(null);
    setConnectedSuccess(false);
    try {
      const result = await connectWhatsAppInstance();
      if (result.connected) {
        qrVisible.current = false;
        setQrCode(null);
        setInstance((current) => ({ ...current, status: "connected", connected: true }));
        setConnectedSuccess(true);
        void refreshStatus(undefined, true);
      } else {
        qrVisible.current = true;
        setQrCode(result.qrCode);
        setInstance((current) => ({ ...current, status: "qr_required", connected: false }));
      }
    } catch {
      setActionError("Não foi possível gerar o QR Code.");
    } finally {
      setAction(null);
    }
  }

  async function disconnect() {
    if (action) return;
    statusRequestVersion.current += 1;
    requestActive.current = false;
    setAction("disconnect");
    setActionError(null);
    try {
      await disconnectWhatsAppInstance();
      qrVisible.current = false;
      setQrCode(null);
      setConnectedSuccess(false);
      setConfirmDisconnect(false);
      setInstance((current) => ({ ...current, status: "disconnected", connected: false, phoneNumber: null, profileName: null }));
    } catch {
      setActionError("Não foi possível desconectar o WhatsApp.");
    } finally {
      setAction(null);
    }
  }

  const presentation = getWhatsAppPresentation(instance.status);
  const statusLabel = loading
    ? "Verificando WhatsApp..."
    : instance.status === "unknown" ? "Status indisponível" : presentation.label;
  const phone = formatWhatsAppPhone(instance.phoneNumber);

  return (
    <>
      <button type="button" className={`lara-sidebar sidebar-whatsapp-${instance.status}`} aria-label="Gerenciar conexão do WhatsApp" onClick={openManager}>
        <span className="lara-icon"><Sparkles size={17} /></span>
        <span className="lara-sidebar-copy">
          <strong>Lara IA</strong>
          <span className="sidebar-whatsapp-state"><i />{statusLabel}</span>
          {!loading && instance.status !== "unknown" ? (
            <small>{phone ? <span>{phone}</span> : null}<span>{instance.name}</span></small>
          ) : null}
        </span>
        <MessageCircle className="sidebar-whatsapp-icon" size={15} aria-hidden="true" />
      </button>

      {managerOpen ? createPortal((
        <div className="modal-layer modal-top" role="dialog" aria-modal="true" aria-labelledby="whatsapp-manager-title">
          <button className="modal-backdrop" onClick={closeManager} aria-label="Fechar gerenciamento do WhatsApp" />
          <div className="modal-card whatsapp-manager-modal">
            <div className="modal-header">
              <div className="modal-title-icon"><MessageCircle size={20} /></div>
              <div><h2 id="whatsapp-manager-title">WhatsApp</h2><p>Gerencie a conexão da instância {instance.name}</p></div>
              <button className="icon-button" onClick={closeManager} aria-label="Fechar"><X size={20} /></button>
            </div>

            {confirmDisconnect ? (
              <div className="whatsapp-manager-content whatsapp-disconnect-confirm">
                <span className="whatsapp-manager-alert"><AlertTriangle size={22} /></span>
                <h3>Desconectar o WhatsApp da CEDIPI?</h3>
                <p>A Lara e o painel deixarão de receber novas mensagens até que o WhatsApp seja conectado novamente.</p>
                {actionError ? <small role="alert">{actionError}</small> : null}
                <div className="whatsapp-manager-actions">
                  <button className="button button-secondary" onClick={() => { setConfirmDisconnect(false); setActionError(null); }} disabled={action !== null}>Cancelar</button>
                  <button className="button button-danger solid" onClick={() => void disconnect()} disabled={action !== null}>{action === "disconnect" ? <RefreshCw className="spin" size={16} /> : null}{action === "disconnect" ? "Desconectando..." : "Desconectar"}</button>
                </div>
              </div>
            ) : qrCode ? (
              <div className="whatsapp-manager-content whatsapp-qr-view">
                <h3>Escaneie este QR Code pelo WhatsApp</h3>
                <img src={qrCode} alt="QR Code para conectar a instância Cedipi ao WhatsApp" />
                <span className="whatsapp-waiting"><i />Aguardando conexão...</span>
                {actionError ? <small role="alert">{actionError}</small> : null}
                <button className="button button-secondary" onClick={() => void connect()} disabled={action !== null}>{action === "connect" ? <RefreshCw className="spin" size={16} /> : null}{action === "connect" ? "Gerando..." : "Gerar novo QR Code"}</button>
              </div>
            ) : (
              <div className="whatsapp-manager-content">
                {connectedSuccess ? <div className="whatsapp-connect-success"><CheckCircle2 size={24} /><strong>WhatsApp conectado com sucesso</strong></div> : null}
                <div className={`whatsapp-manager-status status-${instance.status}`}>
                  <span><MessageCircle size={21} /></span>
                  <div><small>STATUS</small><strong><i />{loading ? "Consultando..." : statusLabel}</strong><p>{instance.profileName || instance.name}{phone ? ` · ${phone}` : ""}</p></div>
                </div>
                {actionError ? <small role="alert">{actionError}</small> : null}
                {instance.connected ? (
                  <button className="button button-danger" onClick={() => { setActionError(null); setConfirmDisconnect(true); }}>Desconectar WhatsApp</button>
                ) : instance.status === "unknown" ? (
                  <button className="button button-secondary" onClick={() => void refreshStatus()} disabled={loading}>Tentar novamente</button>
                ) : (
                  <button className="button button-primary" onClick={() => void connect()} disabled={action !== null}>{action === "connect" ? <RefreshCw className="spin" size={16} /> : null}{action === "connect" ? "Gerando QR..." : "Conectar WhatsApp"}</button>
                )}
              </div>
            )}
          </div>
        </div>
      ), document.body) : null}
    </>
  );
}
