import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const conversations = await readFile(new URL("../app/conversations.tsx", import.meta.url), "utf8");
const sidebarStatus = await readFile(new URL("../app/whatsapp-sidebar-status.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("Agenda não renderiza mais status WhatsApp nem controle global da Lara", () => {
  assert.equal(page.includes("<WhatsAppConnection"), false);
  assert.equal(page.includes("<LaraControl"), false);
  assert.equal(page.includes('className="lara-banner"'), false);
});

test("status WhatsApp real aparece na área Lara IA da sidebar", () => {
  assert.equal(page.includes("<WhatsAppSidebarStatus />"), true);
  assert.equal(sidebarStatus.includes('getWhatsAppInstance(signal)'), true);
  assert.equal(sidebarStatus.includes('Status indisponível'), true);
  assert.equal(sidebarStatus.includes('<strong>Lara IA</strong>'), true);
});

test("controle global da Lara existe somente em Conversas", () => {
  assert.equal(conversations.includes("<LaraControl compact"), true);
  assert.equal(page.includes("<LaraControl"), false);
});

for (const [id, title, description] of [
  ["patients", "Pacientes", "O gerenciamento de pacientes estará disponível em breve."],
  ["doctors", "Médicos", "O gerenciamento de médicos estará disponível em breve."],
  ["settings", "Configurações", "As configurações avançadas estarão disponíveis em breve."],
]) {
  test(`${title} possui navegação e estado EM BREVE`, () => {
    assert.equal(page.includes(`id: "${id}" as const`), true);
    assert.equal(page.includes(`title: "${title}"`), true);
    assert.equal(page.includes(description), true);
    assert.equal(page.includes("EM BREVE"), true);
  });
}

test("Agenda continua carregando médicos reais", () => {
  assert.equal(page.includes("const items = await getDoctors(signal)"), true);
  assert.equal(page.includes("doctors.map((doctor)"), true);
});

test("Agenda oferece novo agendamento livre e bloqueio múltiplo com estados reais", () => {
  assert.equal(page.includes("Escolha médico, data e um horário livre."), true);
  assert.equal(page.includes("Bloquear horários"), true);
  assert.equal(page.includes("selectedBlockSlots"), true);
  assert.equal(page.includes('slot.status === "blocked"'), true);
  assert.equal(page.includes('slot.status === "booked"'), true);
  assert.equal(page.includes("postScheduleBlocks"), true);
  assert.equal(page.includes("deleteScheduleBlocks"), true);
});

test("navegação preserva menu desktop e abertura mobile sem overflow", () => {
  assert.equal(page.includes('aria-label="Navegação principal"'), true);
  assert.equal(page.includes('setMobileNavOpen(true)'), true);
  assert.equal(styles.includes(".sidebar.sidebar-open"), true);
  assert.equal(styles.includes("min-width: 0"), true);
  assert.equal(styles.includes("overflow: hidden"), true);
});
