import { MessageCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatWhatsAppPhone,
  getWhatsAppInstance,
  type WhatsAppInstance,
} from "./whatsapp-instance-api";
import { getWhatsAppPresentation } from "./whatsapp-status";

const unavailableInstance: WhatsAppInstance = {
  name: "Cedipi",
  status: "unknown",
  connected: false,
  phoneNumber: null,
};

export function WhatsAppSidebarStatus() {
  const [instance, setInstance] = useState<WhatsAppInstance>(unavailableInstance);
  const [loading, setLoading] = useState(true);
  const requestActive = useRef(false);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    if (requestActive.current) return;
    requestActive.current = true;
    try {
      setInstance(await getWhatsAppInstance(signal));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setInstance(unavailableInstance);
    } finally {
      requestActive.current = false;
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshStatus(controller.signal);
    const interval = window.setInterval(() => void refreshStatus(controller.signal), 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      requestActive.current = false;
    };
  }, [refreshStatus]);

  const presentation = getWhatsAppPresentation(instance.status);
  const statusLabel = loading
    ? "Verificando WhatsApp..."
    : instance.status === "unknown" ? "Status indisponível" : presentation.label;
  const phone = formatWhatsAppPhone(instance.phoneNumber);

  return (
    <div className={`lara-sidebar sidebar-whatsapp-${instance.status}`} aria-label="Status do WhatsApp" aria-live="polite">
      <div className="lara-icon"><Sparkles size={17} /></div>
      <div className="lara-sidebar-copy">
        <strong>Lara IA</strong>
        <span className="sidebar-whatsapp-state"><i />{statusLabel}</span>
        {!loading && instance.status !== "unknown" ? (
          <small>{phone ? <span>{phone}</span> : null}<span>{instance.name}</span></small>
        ) : null}
      </div>
      <MessageCircle className="sidebar-whatsapp-icon" size={15} aria-hidden="true" />
    </div>
  );
}
