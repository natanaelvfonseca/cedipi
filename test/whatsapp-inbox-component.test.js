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

test("sucesso limpa campo, atualiza mensagens e consulta IA novamente", () => {
  assert.equal(source.includes('setDraft("")'), true);
  assert.equal(source.includes("loadMessages(selectedConversation, undefined, false, true, true)"), true);
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
