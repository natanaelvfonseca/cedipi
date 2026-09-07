import {
  connectWhatsAppInstance,
  disconnectWhatsAppInstance,
  publicInstance,
  syncWhatsAppInstance,
} from "./whatsapp-service.js";

function unavailableResponse(response) {
  return response.status(502).json({
    ok: false,
    instance: {
      name: process.env.EVOLUTION_INSTANCE_NAME ?? "Cedipi",
      status: "unknown",
      connected: false,
    },
  });
}

export function createGetWhatsAppInstanceHandler(sync = syncWhatsAppInstance) {
  return async function getWhatsAppInstanceHandler(_request, response) {
    try {
      const instance = await sync();
      response.status(200).json({ ok: true, instance: publicInstance(instance) });
    } catch (error) {
      console.error("Falha ao consultar a instância WhatsApp:", error);
      unavailableResponse(response);
    }
  };
}

export function createConnectWhatsAppHandler(connect = connectWhatsAppInstance) {
  return async function connectWhatsAppHandler(_request, response) {
    try {
      const result = await connect();
      response.status(200).json({ ok: true, ...result });
    } catch (error) {
      console.error("Falha ao solicitar conexão WhatsApp:", error);
      unavailableResponse(response);
    }
  };
}

export function createDisconnectWhatsAppHandler(disconnect = disconnectWhatsAppInstance) {
  return async function disconnectWhatsAppHandler(_request, response) {
    try {
      const result = await disconnect();
      response.status(200).json({ ok: true, ...result });
    } catch (error) {
      console.error("Falha ao desconectar WhatsApp:", error);
      unavailableResponse(response);
    }
  };
}
