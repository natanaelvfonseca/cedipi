import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireConversationSendLock,
  filterConversations,
  formatMessageTime,
  isSendableMessage,
  mergeMessages,
  messagePresentation,
  messageSide,
  sortMessages,
  startControlledPolling,
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
