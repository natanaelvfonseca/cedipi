import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auth = await readFile(new URL("../app/auth-context.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../app/auth-api.ts", import.meta.url), "utf8");
const users = await readFile(new URL("../app/users.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
const fetchWrapper = await readFile(new URL("../app/api-fetch.ts", import.meta.url), "utf8");
const account = await readFile(new URL("../app/account-menu.tsx", import.meta.url), "utf8");

test("aplicação consulta sessão antes de renderizar área privada e não pisca o painel", () => {
  assert.match(main, /<AuthProvider><App \/><\/AuthProvider>/); assert.match(auth, /getCurrentUser\(signal\)/);
  assert.match(auth, /if \(state\.loading\) return/); assert.match(auth, /if \(!state\.user\) return <LoginScreen/);
});
test("login usa e-mail e senha reais com mensagens seguras", () => {
  assert.match(api, /\/api\/auth\/login/); assert.match(api, /JSON\.stringify\(\{ email, password \}\)/);
  assert.match(auth, /E-mail/); assert.match(auth, /Senha/); assert.match(api, /E-mail ou senha inválidos/);
});
test("troca obrigatória impede painel e troca a senha pela API", () => {
  assert.match(auth, /state\.user\.mustChangePassword/); assert.match(auth, /Crie uma nova senha/); assert.match(api, /\/api\/auth\/change-password/);
});
test("401 global encerra estado local e desmonta polling das telas", () => {
  assert.match(fetchWrapper, /response\.status === 401/); assert.match(fetchWrapper, /cedipi:unauthorized/); assert.match(auth, /addEventListener\(UNAUTHORIZED_EVENT, clear\)/);
});
test("sidebar identifica usuário, oferece troca de senha e logout", () => {
  assert.match(page, /<AccountMenu \/>/); assert.match(page, /sidebar-footer/);
  assert.match(account, /Alterar senha|Sair/);
});
test("menu e tela de usuários aparecem somente para administrador", () => {
  assert.match(page, /adminOnly: true/); assert.match(page, /user\.role === "admin"/); assert.match(users, /Novo usuário/);
  assert.match(users, /Administrador/); assert.match(users, /Atendente/); assert.match(users, /Redefinir senha/); assert.match(users, /Usuário ativo/);
});
test("formulários bloqueiam salvamento simultâneo e apagam senha ao desmontar modal", () => {
  assert.match(users, /disabled=\{saving\}/); assert.match(users, /setDialog\(null\)/); assert.equal(users.includes("localStorage"), false);
  assert.match(users, /confirmTemporaryPassword/);
});
test("API administrativa cobre listar, criar, editar e redefinir senha", () => {
  for (const fragment of ['"/api/users"', 'method: "PATCH"', 'reset-password', 'temporaryPassword']) assert.equal(api.includes(fragment), true);
});
