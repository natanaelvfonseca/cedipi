import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import { authErrorMessage, AuthUser, changeOwnPassword, getCurrentUser, login, logout } from "./auth-api";
import { UNAUTHORIZED_EVENT } from "./api-fetch";

type AuthContextValue = {
  user: AuthUser;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function PasswordForm({ forced, onSave }: { forced: boolean; onSave: (current: string, next: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const data = new FormData(event.currentTarget);
    const current = String(data.get("currentPassword") ?? "");
    const next = String(data.get("newPassword") ?? "");
    if (next !== String(data.get("confirmPassword") ?? "")) return setError("As novas senhas não coincidem.");
    setSaving(true); setError(null);
    try { await onSave(current, next); } catch (cause) { setError(authErrorMessage(cause)); } finally { setSaving(false); }
  }
  return <form className="auth-form" onSubmit={submit}>
    <label><span>Senha atual</span><input name="currentPassword" type="password" autoComplete="current-password" required autoFocus /></label>
    <label><span>Nova senha</span><input name="newPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
    <label><span>Confirmar nova senha</span><input name="confirmPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    <button className="button button-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}{saving ? "Salvando..." : forced ? "Definir nova senha" : "Alterar senha"}</button>
  </form>;
}

function LoginScreen({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting) return; const data = new FormData(event.currentTarget);
    setSubmitting(true); setError(null);
    try { onLogin(await login(String(data.get("email") ?? ""), String(data.get("password") ?? ""))); }
    catch (cause) { setError(authErrorMessage(cause)); } finally { setSubmitting(false); }
  }
  return <main className="auth-page"><section className="auth-card" aria-labelledby="login-title">
    <div className="auth-brand"><div className="brand-mark"><span>C</span></div><div><strong>CEDIPI</strong><small>Diagnóstico por imagem</small></div></div>
    <div className="auth-heading"><span><LockKeyhole size={20} /></span><h1 id="login-title">Acesso ao painel</h1><p>Entre com seu e-mail e senha para continuar.</p></div>
    <form className="auth-form" onSubmit={submit}>
      <label><span>E-mail</span><input name="email" type="email" autoComplete="username" required autoFocus /></label>
      <label><span>Senha</span><input name="password" type="password" autoComplete="current-password" required /></label>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <button className="button button-primary" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : null}{submitting ? "Entrando..." : "Entrar"}</button>
    </form>
  </section></main>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; user: AuthUser | null }>({ loading: true, user: null });
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setState({ loading: false, user: await getCurrentUser(signal) }); }
    catch { if (!signal?.aborted) setState({ loading: false, user: null }); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    const clear = () => setState({ loading: false, user: null });
    window.addEventListener(UNAUTHORIZED_EVENT, clear); return () => window.removeEventListener(UNAUTHORIZED_EVENT, clear);
  }, []);
  const signOut = useCallback(async () => { try { await logout(); } finally { setState({ loading: false, user: null }); } }, []);
  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const user = await changeOwnPassword(currentPassword, newPassword); setState({ loading: false, user });
  }, []);
  if (state.loading) return <main className="auth-page"><div className="auth-loading"><LoaderCircle className="spin" /> Verificando acesso...</div></main>;
  if (!state.user) return <LoginScreen onLogin={(user) => setState({ loading: false, user })} />;
  if (state.user.mustChangePassword) return <main className="auth-page"><section className="auth-card"><div className="auth-heading"><span><KeyRound size={20} /></span><h1>Crie uma nova senha</h1><p>Por segurança, altere a senha temporária antes de acessar o painel.</p></div><PasswordForm forced onSave={changePassword} /><button className="auth-link" onClick={() => void signOut()}>Sair</button></section></main>;
  return <AuthContext.Provider value={{ user: state.user, signOut, changePassword }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return value;
}

export { PasswordForm };
