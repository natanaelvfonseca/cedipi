import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../app/whatsapp-sidebar-status.tsx", import.meta.url), "utf8");
const browserApi = await readFile(new URL("../app/whatsapp-instance-api.ts", import.meta.url), "utf8");
const serverApp = await readFile(new URL("../server/app.js", import.meta.url), "utf8");
const evolutionClient = await readFile(new URL("../server/evolution-client.js", import.meta.url), "utf8");

test("área Lara IA abre o gerenciamento da conexão", () => {
  assert.equal(component.includes('aria-label="Gerenciar conexão do WhatsApp"'), true);
  assert.equal(component.includes("setManagerOpen(true)"), true);
  assert.equal(component.includes("createPortal"), true);
  assert.equal(component.includes("document.body"), true);
});

test("QR ativa polling de dois segundos e cleanup interrompe o timer", () => {
  assert.equal(component.includes("managerOpen && qrCode ? 2_000 : 15_000"), true);
  assert.equal(component.includes("polling.stop()"), true);
  assert.equal(component.includes("setQrCode(null)"), true);
});

test("estado real conectado remove QR e mostra sucesso", () => {
  assert.equal(component.includes("next.connected && qrVisible.current"), true);
  assert.equal(component.includes("setConnectedSuccess(true)"), true);
  assert.equal(component.includes("WhatsApp conectado com sucesso"), true);
});

test("ações invalidam respostas antigas de status", () => {
  assert.equal(component.includes("statusRequestVersion.current += 1"), true);
  assert.equal(component.includes("statusRequestVersion.current !== version"), true);
});

test("QR expirado pode ser gerado novamente sem regeneração automática", () => {
  assert.equal(component.includes("Gerar novo QR Code"), true);
  assert.equal(component.includes('onClick={() => void connect()}'), true);
  assert.equal(component.includes("intervalMs: managerOpen && qrCode ? 2_000 : 15_000"), true);
});

test("logout exige confirmação e comunica impacto", () => {
  assert.equal(component.includes("Desconectar o WhatsApp da CEDIPI?"), true);
  assert.equal(component.includes("A Lara e o painel deixarão de receber novas mensagens"), true);
  assert.equal(component.includes("setConfirmDisconnect(true)"), true);
});

test("frontend usa somente endpoints públicos e não contém API key", () => {
  assert.equal(browserApi.includes("/api/whatsapp/instance/connect"), true);
  assert.equal(browserApi.includes("/api/whatsapp/instance/disconnect"), true);
  assert.equal(browserApi.includes("EVOLUTION_API_KEY"), false);
  assert.equal(component.includes("EVOLUTION_API_KEY"), false);
});

test("backend publica disconnect e Evolution nunca chama delete da instância", () => {
  assert.equal(serverApp.includes('app.post("/api/whatsapp/instance/disconnect"'), true);
  assert.equal(evolutionClient.includes("/instance/logout/"), true);
  assert.equal(evolutionClient.includes("/instance/delete/"), false);
});
