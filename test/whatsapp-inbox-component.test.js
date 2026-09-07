import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/conversations.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("sidebar seleciona a tela de Conversas", () => {
  assert.equal(page.includes('id: "conversations"'), true);
  assert.equal(page.includes("<Conversations"), true);
});

test("seleção carrega mensagens pelo id e IA pelo phone", () => {
  assert.equal(source.includes("getWhatsAppMessages(conversation.id"), true);
  assert.equal(source.includes("getConversationAiControl(conversation.phone"), true);
});

test("sucesso limpa campo, insere a resposta sem recarregar o histórico e consulta IA", () => {
  assert.equal(source.includes('setDraft("")'), true);
  const submitSection = source.slice(source.indexOf("async function submitMessage"), source.indexOf("function handleComposerKeyDown"));
  assert.equal(submitSection.includes("mergeMessages(current, [sent])"), true);
  assert.equal(submitSection.includes("loadRecentMessages"), false);
  assert.equal(source.includes("loadIndividualControl(selectedConversation, undefined, true)"), true);
});

test("controle global reutiliza LaraControl", () => {
  assert.equal(source.includes("<LaraControl compact"), true);
});

test("layout mobile alterna lista e chat sem overflow horizontal", () => {
  assert.equal(styles.includes(".inbox-shell.has-selection .conversations-list { display: none; }"), true);
  assert.equal(styles.includes("grid-template-columns: 330px minmax(0,1fr)"), true);
  assert.equal(styles.includes("min-width: 0"), true);
});

test("mídias são carregadas separadamente e possuem fallbacks visuais", () => {
  assert.equal(source.includes("getWhatsAppMessageMedia"), true);
  assert.equal(source.includes("Imagem indisponível"), true);
  assert.equal(source.includes("Áudio indisponível"), true);
  assert.equal(source.includes("Documento indisponível"), true);
  assert.equal(source.includes("<audio controls"), true);
  assert.equal(source.includes("Abrir documento"), true);
});

test("polling de mensagens não inclui download de mídia", () => {
  const pollingTask = source.match(/task: \(\) => loadRecentMessages\([^\n]+/g) ?? [];
  assert.equal(pollingTask.length > 0, true);
  assert.equal(pollingTask.some((line) => line.includes("getWhatsAppMessageMedia")), false);
});

test("abertura carrega lote recente e inicia scroll no final", () => {
  assert.equal(source.includes("getWhatsAppMessages(conversation.id, null, signal)"), true);
  assert.equal(source.includes("scrollTop = messagesPane.current.scrollHeight"), true);
});

test("topo carrega anteriores uma vez e respeita hasMore", () => {
  assert.equal(source.includes("shouldLoadOlderHistory(pane.scrollTop, messagesPagination.hasMore)"), true);
  assert.equal(source.includes("acquireHistoryLoadLock(olderMessagesRequestActive)"), true);
  assert.equal(source.includes("Carregando mensagens anteriores..."), true);
});

test("prepend preserva scroll e troca de conversa invalida respostas antigas", () => {
  assert.equal(source.includes("scrollTopAfterPrepend(snapshot, pane.scrollHeight)"), true);
  assert.equal(source.includes("selectedIdRef.current !== conversation.id"), true);
  assert.equal(source.includes("olderMessagesAbortController.current?.abort()"), true);
});

test("imagens carregam apenas quando entram na área visível", () => {
  assert.equal(source.includes("new IntersectionObserver"), true);
  assert.equal(source.includes('message.type === "image" ? imageVisible : requested'), true);
});

test("object URLs são revogadas ao desmontar ou trocar de conversa", () => {
  assert.equal(source.includes("URL.createObjectURL(blob)"), true);
  assert.equal(source.includes("URL.revokeObjectURL(objectUrl)"), true);
});

test("frontend não contém API key nem URL da Evolution", () => {
  assert.equal(source.includes("EVOLUTION_API_KEY"), false);
  assert.equal(source.includes("getBase64FromMediaMessage"), false);
});
