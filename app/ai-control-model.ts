export type AiControlState = {
  globalEnabled: boolean | null;
  loading: boolean;
  saving: boolean;
  error: "load" | "save" | null;
};

export type AiControlAction =
  | { type: "load_started" }
  | { type: "load_succeeded"; enabled: boolean }
  | { type: "load_failed" }
  | { type: "save_started" }
  | { type: "save_succeeded"; enabled: boolean }
  | { type: "save_failed"; previousEnabled: boolean };

export const initialAiControlState: AiControlState = {
  globalEnabled: null,
  loading: true,
  saving: false,
  error: null,
};

export function aiControlReducer(
  state: AiControlState,
  action: AiControlAction,
): AiControlState {
  switch (action.type) {
    case "load_started":
      return { ...state, loading: true, error: null };
    case "load_succeeded":
      return { globalEnabled: action.enabled, loading: false, saving: false, error: null };
    case "load_failed":
      return { globalEnabled: null, loading: false, saving: false, error: "load" };
    case "save_started":
      return { ...state, saving: true, error: null };
    case "save_succeeded":
      return { globalEnabled: action.enabled, loading: false, saving: false, error: null };
    case "save_failed":
      return {
        globalEnabled: action.previousEnabled,
        loading: false,
        saving: false,
        error: "save",
      };
  }
}

export function aiControlPresentation(globalEnabled: boolean | null) {
  if (globalEnabled === true) {
    return {
      status: "Ativa",
      description: "Quando pausada, a Lara deixa de responder automaticamente às novas mensagens do WhatsApp.",
    };
  }
  if (globalEnabled === false) {
    return {
      status: "Pausada",
      description: "A Lara está pausada e não responderá automaticamente até ser ativada novamente.",
    };
  }
  return {
    status: "Status indisponível",
    description: "Não foi possível consultar o status da IA.",
  };
}

export function isAiControlSwitchDisabled(state: AiControlState) {
  return state.loading || state.saving || state.globalEnabled === null;
}
