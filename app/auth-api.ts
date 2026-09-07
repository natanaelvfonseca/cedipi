import { apiFetch } from "./api-fetch.ts";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "attendant";
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export class AuthApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
    this.name = "AuthApiError";
  }
}

async function request<T>(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try { response = await fetchImpl(url, init); } catch { throw new AuthApiError("network_error", 0); }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new AuthApiError("invalid_response", response.status); }
  if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true) {
    const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error : "request_failed";
    throw new AuthApiError(code, response.status);
  }
  return payload as T;
}

export async function getCurrentUser(signal?: AbortSignal, fetchImpl: typeof fetch = fetch) {
  return (await request<{ ok: true; user: AuthUser }>("/api/auth/me", { signal }, fetchImpl)).user;
}

export async function login(email: string, password: string, fetchImpl: typeof fetch = fetch) {
  return (await request<{ ok: true; user: AuthUser }>("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  }, fetchImpl)).user;
}

export async function logout(fetchImpl: typeof fetch = apiFetch) {
  await request<{ ok: true }>("/api/auth/logout", { method: "POST" }, fetchImpl);
}

export async function changeOwnPassword(currentPassword: string, newPassword: string, fetchImpl: typeof fetch = apiFetch) {
  return (await request<{ ok: true; user: AuthUser }>("/api/auth/change-password", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }),
  }, fetchImpl)).user;
}

export async function listUsers(fetchImpl: typeof fetch = apiFetch) {
  return (await request<{ ok: true; users: AuthUser[] }>("/api/users", {}, fetchImpl)).users;
}

export async function createUser(input: { name: string; email: string; role: AuthUser["role"]; temporaryPassword: string }, fetchImpl: typeof fetch = apiFetch) {
  return (await request<{ ok: true; user: AuthUser }>("/api/users", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }, fetchImpl)).user;
}

export async function updateUser(userId: string, input: Partial<Pick<AuthUser, "name" | "email" | "role" | "active">>, fetchImpl: typeof fetch = apiFetch) {
  return (await request<{ ok: true; user: AuthUser }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }, fetchImpl)).user;
}

export async function resetUserPassword(userId: string, temporaryPassword: string, fetchImpl: typeof fetch = apiFetch) {
  return (await request<{ ok: true; user: AuthUser }>(`/api/users/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ temporaryPassword }),
  }, fetchImpl)).user;
}

export function authErrorMessage(error: unknown) {
  if (!(error instanceof AuthApiError)) return "Não foi possível concluir a operação.";
  const messages: Record<string, string> = {
    invalid_credentials: "E-mail ou senha inválidos.", too_many_attempts: "Muitas tentativas. Aguarde alguns minutos.",
    invalid_current_password: "A senha atual está incorreta.", invalid_password: "A senha deve ter entre 10 e 128 caracteres.",
    password_unchanged: "A nova senha deve ser diferente da atual.", email_already_exists: "Este e-mail já está cadastrado.",
    cannot_disable_self: "Você não pode desativar seu próprio acesso.", last_active_admin: "É necessário manter ao menos um administrador ativo.",
  };
  return messages[error.code] ?? "Não foi possível concluir a operação.";
}
