import { FormEvent, useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, KeyRound, LoaderCircle, Menu, Pencil, Plus, ShieldCheck, UserRound, X } from "lucide-react";
import { authErrorMessage, AuthUser, createUser, listUsers, resetUserPassword, updateUser } from "./auth-api";

type Dialog = { type: "create" } | { type: "edit" | "reset"; user: AuthUser } | null;

function roleLabel(role: AuthUser["role"]) { return role === "admin" ? "Administrador" : "Atendente"; }
function formatLastLogin(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Nunca acessou";
}

export function UsersScreen({ openMobileMenu, notify }: { openMobileMenu: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setUsers(await listUsers()); } catch { setError("Não foi possível carregar os usuários."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!dialog || saving) return;
    const data = new FormData(event.currentTarget); setSaving(true); setError(null);
    try {
      if (dialog.type === "create") {
        const temporaryPassword = String(data.get("temporaryPassword"));
        if (temporaryPassword !== String(data.get("confirmTemporaryPassword"))) throw new Error("password_confirmation");
        await createUser({ name: String(data.get("name")), email: String(data.get("email")), role: String(data.get("role")) as AuthUser["role"], temporaryPassword });
        notify("Usuário criado. A troca da senha temporária será exigida.");
      } else if (dialog.type === "edit") {
        await updateUser(dialog.user.id, { name: String(data.get("name")), email: String(data.get("email")), role: String(data.get("role")) as AuthUser["role"], active: data.get("active") === "on" });
        notify("Usuário atualizado.");
      } else {
        const temporaryPassword = String(data.get("temporaryPassword"));
        if (temporaryPassword !== String(data.get("confirmTemporaryPassword"))) throw new Error("password_confirmation");
        await resetUserPassword(dialog.user.id, temporaryPassword);
        notify("Senha temporária redefinida. As sessões do usuário foram encerradas.");
      }
      setDialog(null); await load();
    } catch (cause) { setError(cause instanceof Error && cause.message === "password_confirmation" ? "As senhas temporárias não coincidem." : authErrorMessage(cause)); } finally { setSaving(false); }
  }

  return <>
    <header className="topbar"><div className="title-wrap"><button className="mobile-menu" onClick={openMobileMenu} aria-label="Abrir menu"><Menu size={21} /></button><div><h1>Usuários</h1><p>Gerencie quem pode acessar o painel CEDIPI</p></div></div><button className="button button-primary" onClick={() => setDialog({ type: "create" })}><Plus size={17} /> Novo usuário</button></header>
    <section className="users-panel">
      <div className="users-panel-head"><div><ShieldCheck size={19} /><span><strong>Acessos ao painel</strong><small>{users.length} {users.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}</small></span></div></div>
      {loading ? <div className="users-state"><LoaderCircle className="spin" size={18} /> Carregando usuários...</div> : error && users.length === 0 ? <div className="users-state error-state"><AlertTriangle size={18} />{error}<button className="button button-secondary" onClick={() => void load()}>Tentar novamente</button></div> : <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Usuário</th><th>Perfil</th><th>Status</th><th>Último acesso</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><span className="user-identity"><i><UserRound size={15} /></i><span><strong>{user.name}</strong><small>{user.email}</small></span></span></td><td><span className="role-badge">{roleLabel(user.role)}</span></td><td><span className={`account-status ${user.active ? "active" : "inactive"}`}><i />{user.active ? "Ativo" : "Inativo"}</span>{user.mustChangePassword ? <small className="password-pending">Troca de senha pendente</small> : null}</td><td>{formatLastLogin(user.lastLoginAt)}</td><td><span className="row-actions"><button onClick={() => setDialog({ type: "edit", user })} aria-label={`Editar ${user.name}`}><Pencil size={15} /></button><button onClick={() => setDialog({ type: "reset", user })} aria-label={`Redefinir senha de ${user.name}`}><KeyRound size={15} /></button></span></td></tr>)}</tbody></table></div>}
      {error && users.length > 0 ? <p className="users-inline-error" role="alert">{error}</p> : null}
    </section>
    {dialog ? <div className="modal-layer modal-top" role="dialog" aria-modal="true"><button className="modal-backdrop" onClick={() => !saving && setDialog(null)} aria-label="Fechar modal" /><div className="modal-card modal-compact"><div className="modal-header"><div className="modal-title-icon">{dialog.type === "reset" ? <KeyRound size={19} /> : <UserRound size={19} />}</div><div><h2>{dialog.type === "create" ? "Novo usuário" : dialog.type === "edit" ? "Editar usuário" : "Redefinir senha"}</h2><p>{dialog.type === "reset" ? `Defina uma senha temporária para ${dialog.user.name}.` : "Configure o acesso ao painel."}</p></div><button className="icon-button" onClick={() => setDialog(null)} disabled={saving}><X size={19} /></button></div><form onSubmit={submit}>
      {dialog.type !== "reset" ? <div className="form-grid"><label className="field span-4"><span>Nome</span><input name="name" defaultValue={dialog.type === "edit" ? dialog.user.name : ""} required autoFocus /></label><label className="field span-4"><span>E-mail</span><input name="email" type="email" defaultValue={dialog.type === "edit" ? dialog.user.email : ""} required /></label><label className="field span-4"><span>Perfil</span><select name="role" defaultValue={dialog.type === "edit" ? dialog.user.role : "attendant"}><option value="attendant">Atendente</option><option value="admin">Administrador</option></select></label>{dialog.type === "create" ? <><label className="field span-4"><span>Senha temporária</span><input name="temporaryPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label><label className="field span-4"><span>Confirmar senha temporária</span><input name="confirmTemporaryPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label></> : <label className="check-field span-4"><input name="active" type="checkbox" defaultChecked={dialog.user.active} /><span>Usuário ativo</span></label>}</div> : <div className="form-grid"><label className="field span-4"><span>Nova senha temporária</span><input name="temporaryPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password" required autoFocus /></label><label className="field span-4"><span>Confirmar senha temporária</span><input name="confirmTemporaryPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label></div>}
      {error ? <p className="form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setDialog(null)} disabled={saving}>Cancelar</button><button className="button button-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? "Salvando..." : "Salvar"}</button></div>
    </form></div></div> : null}
  </>;
}
