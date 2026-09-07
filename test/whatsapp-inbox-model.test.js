import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireConversationSendLock,
  acquireHistoryLoadLock,
  filterConversations,
  formatMessageTime,
  hasNewMessages,
  isNearMessagesEnd,
  isSendableMessage,
  isCurrentConversationResponse,
  mergeMessages,
  messagePresentation,
  messageSide,
  sortMessages,
  scrollTopAfterPrepend,
  startControlledPolling,
  shouldLoadOlderHistory,
  whatsappDisplayTimezone,
} from "../app/whatsapp-model.ts";

const conversations = [
  { id: "jid-1", phone: "5547991935149", name: "João da Silva" },
  { id: "jid-2", phone: "5547888877777", name: "Maria" },
];

test("busca conversas localmente por nome sem depender de acentos", () => {
  assert.deepEqual(filterConversations(conversations, "joao"), [conversations[0]]);
});

test("busca conversas localmente por telefone", () => {
  assert.deepEqual(filterConversations(conversations, "91935149"), [conversations[0]]);
});

test("mensagem recebida pertence ao paciente e enviada pertence à CEDIPI", () => {
  assert.equal(messageSide({ fromMe: false }), "patient");
  assert.equal(messageSide({ fromMe: true }), "cedipi");
});

test("ordena mensagens cronologicamente", () => {
  const newer = { id: "2", timestamp: "2026-09-07T12:01:00Z" };
  const older = { id: "1", timestamp: "2026-09-07T12:00:00Z" };
  assert.deepEqual(sortMessages([newer, older]).map((item) => item.id), ["1", "2"]);
});

test("apresenta placeholders honestos para imagem, áudio e documento", () => {
  assert.deepEqual(messagePresentation({ type: "image", text: "Legenda" }), { label: "Imagem recebida", detail: "Legenda" });
  assert.deepEqual(messagePresentation({ type: "audio", text: null }), { label: "Áudio recebido", detail: null });
  assert.deepEqual(messagePresentation({ type: "document", text: null }), { label: "Documento recebido", detail: null });
  assert.deepEqual(messagePresentation({ type: "document", text: "laudo.pdf" }), { label: "laudo.pdf", detail: null });
});

test("mensagem vazia não pode ser enviada", () => {
  assert.equal(isSendableMessage("   \n"), false);
  assert.equal(isSendableMessage("Olá"), true);
});

test("lock impede envio duplicado até ser liberado", () => {
  const lock = { current: false };
  assert.equal(acquireConversationSendLock(lock), true);
  assert.equal(acquireConversationSendLock(lock), false);
  lock.current = false;
  assert.equal(acquireConversationSendLock(lock), true);
});

test("mensagem enviada é incorporada ao histórico sem duplicar", () => {
  const first = { id: "1", timestamp: "2026-09-07T12:00:00Z" };
  const sent = { id: "2", timestamp: "2026-09-07T12:01:00Z" };
  assert.deepEqual(mergeMessages([first], [sent, sent]).map((item) => item.id), ["1", "2"]);
});

test("polling adiciona novas sem duplicar ou remover histórico antigo", () => {
  const old = { id: "old", timestamp: "2026-09-07T10:00:00Z" };
  const recent = { id: "recent", timestamp: "2026-09-07T12:00:00Z", status: "PENDING" };
  const updated = { ...recent, status: "READ" };
  const next = { id: "next", timestamp: "2026-09-07T12:01:00Z" };
  const merged = mergeMessages([old, recent], [updated, next, next]);
  assert.deepEqual(merged.map((item) => item.id), ["old", "recent", "next"]);
  assert.equal(merged[1].status, "READ");
});

test("prepend preserva a posição visual do scroll", () => {
  assert.equal(scrollTopAfterPrepend({ scrollHeight: 1200, scrollTop: 80 }, 2600), 1480);
});

test("detecta proximidade do final com threshold estável", () => {
  assert.equal(isNearMessagesEnd({ scrollHeight: 1000, scrollTop: 300, clientHeight: 600 }), true);
  assert.equal(isNearMessagesEnd({ scrollHeight: 1000, scrollTop: 279, clientHeight: 600 }), false);
});

test("polling distingue mensagem nova de atualização de status", () => {
  const current = [{ id: "1", timestamp: "2026-09-07T12:00:00Z", fromMe: true, type: "text", text: "Oi" }];
  assert.equal(hasNewMessages(current, [{ ...current[0], status: "READ" }]), false);
  assert.equal(hasNewMessages(current, [{ ...current[0] }, { id: "2", timestamp: "2026-09-07T12:01:00Z", fromMe: false, type: "text", text: "Olá" }]), true);
});

test("lock impede duas cargas simultâneas do histórico", () => {
  const lock = { current: false };
  assert.equal(acquireHistoryLoadLock(lock), true);
  assert.equal(acquireHistoryLoadLock(lock), false);
});

test("resposta atrasada de outra conversa ou geração é ignorada", () => {
  const base = { requestedConversationId: "joao", requestVersion: 1, currentVersion: 1 };
  assert.equal(isCurrentConversationResponse({ ...base, selectedConversationId: "joao" }), true);
  assert.equal(isCurrentConversationResponse({ ...base, selectedConversationId: "maria" }), false);
  assert.equal(isCurrentConversationResponse({ ...base, selectedConversationId: "joao", currentVersion: 2 }), false);
  assert.equal(isCurrentConversationResponse({ ...base, selectedConversationId: "joao", aborted: true }), false);
});

test("hasMore=false encerra o infinite scroll", () => {
  assert.equal(shouldLoadOlderHistory(20, true), true);
  assert.equal(shouldLoadOlderHistory(20, false), false);
  assert.equal(shouldLoadOlderHistory(200, true), false);
});

test("polling cria um timer e impede tarefas sobrepostas", async () => {
  let timers = 0;
  let clears = 0;
  let calls = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const polling = startControlledPolling({
    task: async () => { calls += 1; await pending; },
    intervalMs: 5000,
    setIntervalImpl: () => { timers += 1; return 123; },
    clearIntervalImpl: () => { clears += 1; },
  });
  const first = polling.tick();
  const second = polling.tick();
  assert.equal(timers, 1);
  assert.equal(calls, 1);
  finish();
  await Promise.all([first, second]);
  polling.stop();
  assert.equal(clears, 1);
});

test("polling pausa quando documento está oculto", async () => {
  let calls = 0;
  const polling = startControlledPolling({
    task: async () => { calls += 1; },
    intervalMs: 5000,
    isVisible: () => false,
    setIntervalImpl: () => 123,
    clearIntervalImpl: () => {},
  });
  await polling.tick();
  polling.stop();
  assert.equal(calls, 0);
});

test("horários usam America/Sao_Paulo", () => {
  assert.equal(whatsappDisplayTimezone, "America/Sao_Paulo");
  assert.equal(formatMessageTime("2026-09-07T12:00:00.000Z"), "09:00");
});
