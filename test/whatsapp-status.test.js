import assert from "node:assert/strict";
import test from "node:test";
import { getWhatsAppPresentation } from "../app/whatsapp-status.ts";

test("estado connected recebe destaque e ação de atualização", () => {
  assert.deepEqual(getWhatsAppPresentation("connected"), {
    label: "WhatsApp conectado",
    action: "refresh",
    actionLabel: "Atualizar estado do WhatsApp",
  });
});

test("estado disconnected oferece conexão explícita", () => {
  assert.equal(getWhatsAppPresentation("disconnected").action, "connect");
  assert.equal(getWhatsAppPresentation("disconnected").actionLabel, "Conectar WhatsApp");
});

test("estado unknown oferece nova tentativa sem parecer desconectado", () => {
  assert.equal(getWhatsAppPresentation("unknown").label, "Não foi possível verificar a conexão");
  assert.equal(getWhatsAppPresentation("unknown").actionLabel, "Tentar novamente");
});

test("estado connecting comunica conexão em andamento", () => {
  assert.equal(getWhatsAppPresentation("connecting").label, "Conectando WhatsApp...");
});
