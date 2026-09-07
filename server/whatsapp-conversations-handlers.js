import {
  whatsappConversationsService,
  WhatsAppConversationError,
} from "./whatsapp-conversations-service.js";
import { N8nAiControlError } from "./n8n-ai-control-client.js";
import {
  normalizeBrazilianPhone,
  normalizeIndividualConversationId,
} from "./whatsapp-phone.js";

function respondWithError(error, response) {
  const known = error instanceof WhatsAppConversationError || error instanceof N8nAiControlError;
  const status = known ? error.status : 502;
  const code = known ? error.code : "whatsapp_inbox_unavailable";
  console.error("Falha na integração da inbox do WhatsApp:", {
    code,
    upstreamStatus: known ? error.upstreamStatus : undefined,
  });
  response.status(status).json({ ok: false, error: code });
}

function parsedIdentity(value) {
  try {
    return normalizeIndividualConversationId(decodeURIComponent(value ?? ""));
  } catch {
    return null;
  }
}

function parsedPhone(value) {
  try {
    return normalizeBrazilianPhone(decodeURIComponent(value ?? ""));
  } catch {
    return null;
  }
}

export function createListWhatsAppConversationsHandler(service = whatsappConversationsService) {
  return async function listWhatsAppConversationsHandler(_request, response) {
    try {
      response.status(200).json({ ok: true, conversations: await service.listConversations() });
    } catch (error) {
      respondWithError(error, response);
    }
  };
}

export function createListWhatsAppMessagesHandler(service = whatsappConversationsService) {
  return async function listWhatsAppMessagesHandler(request, response) {
    const identity = parsedIdentity(request.params.conversationId);
    if (!identity) {
      response.status(400).json({ ok: false, error: "invalid_conversation" });
      return;
    }
    try {
      response.status(200).json({ ok: true, messages: await service.listMessages(identity.remoteJid) });
    } catch (error) {
      respondWithError(error, response);
    }
  };
}

export function createSendWhatsAppMessageHandler(service = whatsappConversationsService) {
  return async function sendWhatsAppMessageHandler(request, response) {
    const identity = parsedIdentity(request.params.conversationId);
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!identity || !text || text.length > 4096) {
      response.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }
    try {
      const message = await service.sendManualMessage({ ...identity, text });
      response.status(201).json({ ok: true, message });
    } catch (error) {
      respondWithError(error, response);
    }
  };
}

export function createGetConversationAiControlHandler(service = whatsappConversationsService) {
  return async function getConversationAiControlHandler(request, response) {
    const phone = parsedPhone(request.params.phone);
    if (!phone) {
      response.status(400).json({ ok: false, error: "invalid_phone" });
      return;
    }
    try {
      response.status(200).json({ ok: true, enabled: await service.getAiControl(phone) });
    } catch (error) {
      respondWithError(error, response);
    }
  };
}

export function createPatchConversationAiControlHandler(service = whatsappConversationsService) {
  return async function patchConversationAiControlHandler(request, response) {
    const phone = parsedPhone(request.params.phone);
    if (!phone || typeof request.body?.enabled !== "boolean") {
      response.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }
    try {
      const enabled = await service.setAiControl(phone, request.body.enabled);
      response.status(200).json({ ok: true, enabled });
    } catch (error) {
      respondWithError(error, response);
    }
  };
}
