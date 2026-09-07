import { useState } from "react";
import { ChevronUp, KeyRound, LogOut, UserRound, X } from "lucide-react";
import { PasswordForm, useAuth } from "./auth-context";

export function AccountMenu() {
  const { user, signOut, changePassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  return <>
    <div className="account-menu"><button className="account-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span className="account-avatar"><UserRound size={16} /></span><span><strong>{user.name}</strong><small>{user.role === "admin" ? "Administrador" : "Atendente"}</small></span><ChevronUp className={open ? "expanded" : ""} size={15} /></button>{open ? <div className="account-popover"><button onClick={() => { setPasswordOpen(true); setOpen(false); }}><KeyRound size={15} />Alterar senha</button><button onClick={() => void signOut()}><LogOut size={15} />Sair</button></div> : null}</div>
    {passwordOpen ? <div className="modal-layer modal-top" role="dialog" aria-modal="true" aria-labelledby="password-title"><button className="modal-backdrop" onClick={() => setPasswordOpen(false)} aria-label="Fechar modal" /><div className="modal-card modal-compact"><div className="modal-header"><div className="modal-title-icon"><KeyRound size={19} /></div><div><h2 id="password-title">Alterar senha</h2><p>Defina uma nova senha para sua conta.</p></div><button className="icon-button" onClick={() => setPasswordOpen(false)}><X size={19} /></button></div><div className="account-password-form"><PasswordForm forced={false} onSave={async (current, next) => { await changePassword(current, next); setPasswordOpen(false); }} /></div></div></div> : null}
  </>;
}
