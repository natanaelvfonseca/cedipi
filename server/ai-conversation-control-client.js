import { createN8nAiControlClient } from "./n8n-ai-control-client.js";
import {
  getConversationAiEnabled,
  setConversationAiEnabled,
} from "./ai-conversation-control-repository.js";

export class AiControlUnavailableError extends Error {
  constructor(code = "ai_control_unavailable") {
    super(code);
    this.name = "AiControlUnavailableError";
    this.code = code;
    this.status = 503;
  }
}

// Keep n8n as default until Lara has been fully migrated.
export function createAiConversationControlClient({
  mode = process.env.CEDIPI_AI_CONTROL_BACKEND ?? "n8n",
  legacyFactory = createN8nAiControlClient,
  repository = {
    getStatus: getConversationAiEnabled,
    setEnabled: setConversationAiEnabled,
  },
} = {}) {
  if (mode === "n8n") return legacyFactory();
  if (mode !== "database") throw new AiControlUnavailableError("ai_control_invalid_backend");

  return {
    async getStatus(phone) {
      try {
        return await repository.getStatus(phone);
      } catch {
        throw new AiControlUnavailableError();
      }
    },
    async setEnabled(phone, enabled) {
      try {
        return await repository.setEnabled(phone, enabled);
      } catch {
        throw new AiControlUnavailableError();
      }
    },
  };
}
