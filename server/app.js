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
  createDeleteScheduleBlocksHandler,
  createListScheduleBlocksHandler,
  createPostScheduleBlocksHandler,
} from "./schedule-blocks-handlers.js";
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
import { createAuthService } from "./auth-service.js";
import { createLoginRateLimiter } from "./login-rate-limit.js";
import {
  createChangePasswordHandler,
  createLoginHandler,
  createLogoutHandler,
  createMeHandler,
  createUsersHandlers,
} from "./auth-handlers.js";
import { createRequireAuth, requireAdmin, requirePasswordChanged, verifySameOrigin } from "./auth-middleware.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(serverDirectory, "../dist");

export function createApp({ authService = createAuthService(), loginRateLimiter = createLoginRateLimiter() } = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", verifySameOrigin);
  app.get("/api/health/database", createDatabaseHealthHandler());
  app.post("/api/auth/login", createLoginHandler(authService, loginRateLimiter));

  app.use("/api", createRequireAuth(authService));
  app.get("/api/auth/me", createMeHandler());
  app.post("/api/auth/logout", createLogoutHandler(authService));
  app.post("/api/auth/change-password", createChangePasswordHandler(authService));
  app.use("/api", requirePasswordChanged);

  const users = createUsersHandlers(authService);
  app.get("/api/users", requireAdmin, users.list);
  app.post("/api/users", requireAdmin, users.create);
  app.patch("/api/users/:userId", requireAdmin, users.update);
  app.post("/api/users/:userId/reset-password", requireAdmin, users.resetPassword);
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
  app.get("/api/scheduling/blocks", createListScheduleBlocksHandler());
  app.post("/api/scheduling/blocks", createPostScheduleBlocksHandler());
  app.delete("/api/scheduling/blocks", createDeleteScheduleBlocksHandler());
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
  app.use((error, _request, response, _next) => {
    console.error("Erro interno na API CEDIPI.");
    if (!response.headersSent) response.status(500).json({ ok: false, error: "internal_error" });
  });

  return app;
}
