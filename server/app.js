import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createDatabaseHealthHandler } from "./database-health.js";
import {
  createConnectWhatsAppHandler,
  createDisconnectWhatsAppHandler,
  createGetWhatsAppInstanceHandler,
} from "./whatsapp-handlers.js";
import {
  createListAppointmentsHandler,
  createListAvailabilityHandler,
  createListDoctorsHandler,
} from "./scheduling-handlers.js";
import { createLiveAvailabilityHandler } from "./n8n-agenda-handlers.js";
import { createPostAppointmentHandler } from "./appointments-handlers.js";
import {
  createGetAiControlHandler,
  createPatchAiControlHandler,
} from "./ai-control-handlers.js";
import {
  createGetConversationAiControlHandler,
  createGetWhatsAppMessageMediaHandler,
  createListWhatsAppConversationsHandler,
  createListWhatsAppMessagesHandler,
  createPatchConversationAiControlHandler,
  createSendWhatsAppMessageHandler,
} from "./whatsapp-conversations-handlers.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(serverDirectory, "../dist");

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health/database", createDatabaseHealthHandler());
  app.get("/api/whatsapp/instance", createGetWhatsAppInstanceHandler());
  app.post("/api/whatsapp/instance/connect", createConnectWhatsAppHandler());
  app.post("/api/whatsapp/instance/disconnect", createDisconnectWhatsAppHandler());
  app.get("/api/whatsapp/conversations", createListWhatsAppConversationsHandler());
  app.get("/api/whatsapp/conversations/:conversationId/messages", createListWhatsAppMessagesHandler());
  app.get("/api/whatsapp/conversations/:conversationId/messages/:messageId/media", createGetWhatsAppMessageMediaHandler());
  app.post("/api/whatsapp/conversations/:conversationId/messages", createSendWhatsAppMessageHandler());
  app.get("/api/whatsapp/conversations/:phone/ai-control", createGetConversationAiControlHandler());
  app.patch("/api/whatsapp/conversations/:phone/ai-control", createPatchConversationAiControlHandler());
  app.get("/api/doctors", createListDoctorsHandler());
  app.get("/api/scheduling/availability", createListAvailabilityHandler());
  app.get("/api/scheduling/live-availability", createLiveAvailabilityHandler());
  app.get("/api/appointments", createListAppointmentsHandler());
  app.post("/api/appointments", createPostAppointmentHandler());
  app.get("/api/ai-control", createGetAiControlHandler());
  app.patch("/api/ai-control", createPatchAiControlHandler());
  app.use(express.static(distDirectory));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(path.join(distDirectory, "index.html"));
  });

  return app;
}
