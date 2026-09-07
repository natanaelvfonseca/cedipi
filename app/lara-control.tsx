import { RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { getAiControl, patchAiControl } from "./ai-control-api";
import {
  aiControlPresentation,
  aiControlReducer,
  initialAiControlState,
  isAiControlSwitchDisabled,
} from "./ai-control-model";

type LaraControlProps = {
  notify: (message: string, kind: "success" | "error") => void;
  compact?: boolean;
};

export function LaraControl({ notify, compact = false }: LaraControlProps) {
  const [state, dispatch] = useReducer(aiControlReducer, initialAiControlState);
  const saveLock = useRef(false);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    dispatch({ type: "load_started" });
    try {
      const enabled = await getAiControl(signal);
      dispatch({ type: "load_succeeded", enabled });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      dispatch({ type: "load_failed" });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  async function toggle() {
    if (saveLock.current || isAiControlSwitchDisabled(state) || state.globalEnabled === null) return;

    const previousEnabled = state.globalEnabled;
    const requestedEnabled = !previousEnabled;
    saveLock.current = true;
    dispatch({ type: "save_started" });

    try {
      const enabled = await patchAiControl(requestedEnabled);
      dispatch({ type: "save_succeeded", enabled });
      notify(enabled ? "Lara ativada." : "Lara pausada.", "success");
    } catch {
      dispatch({ type: "save_failed", previousEnabled });
      notify("Não foi possível alterar o status da Lara.", "error");
    } finally {
      saveLock.current = false;
    }
  }

  const presentation = aiControlPresentation(state.globalEnabled);
  const enabled = state.globalEnabled === true;
  const unavailable = state.globalEnabled === null;

  return (
    <section className={`lara-control-panel ${compact ? "lara-control-compact" : ""} ${enabled ? "lara-control-enabled" : ""} ${unavailable ? "lara-control-unavailable" : ""}`} aria-labelledby={compact ? "lara-global-control-title" : "lara-control-title"}>
      <div className="lara-control-heading">
        <span className="lara-control-icon"><Sparkles size={18} /></span>
        <div>
          <h2 id={compact ? "lara-global-control-title" : "lara-control-title"}>{compact ? "Lara IA" : "Controle da Lara"}</h2>
          <p>{compact ? "Controle global" : "Ative ou pause o atendimento automático por IA."}</p>
        </div>
      </div>
      {!compact ? <div className="lara-control-copy">
        <strong>Lara <span>Atendimento automático do WhatsApp</span></strong>
        <p>{state.loading ? "Consultando o status da IA..." : presentation.description}</p>
        {state.error === "save" ? <small role="alert">Não foi possível alterar o status da Lara.</small> : null}
      </div> : null}
      <div className="lara-control-action">
        <span className={`lara-control-status ${enabled ? "active" : unavailable ? "unknown" : "paused"}`}>
          <i />{state.loading ? "Consultando" : presentation.status}
        </span>
        <button
          type="button"
          className={`lara-switch ${enabled ? "on" : "off"} ${unavailable ? "unknown" : ""}`}
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "Pausar atendimento automático da Lara" : "Ativar atendimento automático da Lara"}
          disabled={isAiControlSwitchDisabled(state)}
          onClick={() => void toggle()}
        >
          <span />
        </button>
        {state.saving ? <small className="lara-saving"><RefreshCw className="spin" size={12} /> Salvando...</small> : null}
      </div>
    </section>
  );
}
