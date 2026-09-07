import {
  getGlobalAiEnabled,
  setGlobalAiEnabled,
} from "./ai-control-repository.js";

function databaseUnavailable(response) {
  return response.status(503).json({
    ok: false,
    error: "ai_control_unavailable",
  });
}

export function createGetAiControlHandler(readEnabled = getGlobalAiEnabled) {
  return async function getAiControlHandler(_request, response) {
    try {
      const globalEnabled = await readEnabled();
      response.status(200).json({ ok: true, globalEnabled });
    } catch {
      console.error("Falha ao consultar o controle global da IA.");
      databaseUnavailable(response);
    }
  };
}

export function createPatchAiControlHandler(updateEnabled = setGlobalAiEnabled) {
  return async function patchAiControlHandler(request, response) {
    if (typeof request.body?.enabled !== "boolean") {
      response.status(400).json({ ok: false, error: "invalid_enabled" });
      return;
    }

    try {
      const globalEnabled = await updateEnabled(request.body.enabled);
      response.status(200).json({ ok: true, globalEnabled });
    } catch {
      console.error("Falha ao atualizar o controle global da IA.");
      databaseUnavailable(response);
    }
  };
}
