"use client";

import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  UserCog,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Role = "ADMIN" | "CURATOR" | "VIEWER";
type Scope = "ALL" | "MEDIA" | "PERSON" | "TAG" | "GROUP";

interface AccessRule {
  id?: string;
  effect: "ALLOW" | "DENY";
  scope: Scope;
  targetId: string | null;
  label?: string | null;
}

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastSeenAt?: string | null;
  accessRules: AccessRule[];
}

const demoUsers: ManagedUser[] = [
  { id: "demo-admin", name: "Sara Porta", email: "admin@frameo.local", role: "ADMIN", active: true, lastSeenAt: new Date().toISOString(), accessRules: [] },
  { id: "demo-curator", name: "Elena Riva", email: "elena@frameo.local", role: "CURATOR", active: true, lastSeenAt: new Date(Date.now() - 11 * 60_000).toISOString(), accessRules: [{ effect: "ALLOW", scope: "ALL", targetId: null, label: "Tutta la libreria" }] },
  { id: "demo-viewer", name: "Luca Bianchi", email: "luca@frameo.local", role: "VIEWER", active: true, lastSeenAt: new Date(Date.now() - 4 * 86_400_000).toISOString(), accessRules: [{ effect: "ALLOW", scope: "PERSON", targetId: "sofia", label: "Media con Sofia" }, { effect: "DENY", scope: "TAG", targetId: "private", label: "Tag private" }] },
  { id: "demo-guest", name: "Giulia Conti", email: "giulia@frameo.local", role: "VIEWER", active: false, lastSeenAt: null, accessRules: [] }
];

const roleLabel: Record<Role, string> = {
  ADMIN: "Amministratore",
  CURATOR: "Curatore",
  VIEWER: "Visualizzatore"
};

function UserDrawer({
  user,
  onClose,
  onSave
}: {
  user: ManagedUser;
  onClose: () => void;
  onSave: (user: ManagedUser) => void;
}) {
  const [draft, setDraft] = useState(user);
  const [scope, setScope] = useState<Scope>("PERSON");
  const [label, setLabel] = useState("");

  const addRule = (effect: "ALLOW" | "DENY") => {
    if (scope !== "ALL" && !label.trim()) return;
    setDraft((current) => ({
      ...current,
      accessRules: [
        ...current.accessRules,
        {
          effect,
          scope,
          targetId: scope === "ALL" ? null : label.trim().toLowerCase().replaceAll(" ", "-"),
          label: scope === "ALL" ? "Tutta la libreria" : label.trim()
        }
      ]
    }));
    setLabel("");
  };

  return (
    <div className="user-drawer-backdrop" onMouseDown={onClose}>
      <aside className="user-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="user-drawer-avatar">{draft.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
          <div><span>GESTIONE ACCESSI</span><h2>{draft.name}</h2><p>{draft.email}</p></div>
          <button onClick={onClose}><X size={19} /></button>
        </header>
        <div className="user-drawer-body">
          <section>
            <h3>Ruolo e stato</h3>
            <div className="role-selector">
              {(["ADMIN", "CURATOR", "VIEWER"] as Role[]).map((role) => (
                <button
                  className={draft.role === role ? "is-selected" : ""}
                  key={role}
                  onClick={() => setDraft((current) => ({ ...current, role }))}
                >
                  {role === "ADMIN" ? <ShieldCheck size={17} /> : role === "CURATOR" ? <UserCog size={17} /> : <Eye size={17} />}
                  <span><strong>{roleLabel[role]}</strong><small>{role === "ADMIN" ? "Gestisce tutto" : role === "CURATOR" ? "Organizza e modifica" : "Vede solo ciò che è permesso"}</small></span>
                  {draft.role === role ? <Check size={15} /> : null}
                </button>
              ))}
            </div>
            <button
              className={draft.active ? "account-toggle is-active" : "account-toggle"}
              onClick={() => setDraft((current) => ({ ...current, active: !current.active }))}
            >
              <span><strong>Account attivo</strong><small>Può accedere al workspace</small></span><i><b /></i>
            </button>
          </section>
          <section>
            <div className="user-section-title">
              <div><h3>Regole di visibilità</h3><p>Il divieto ha sempre precedenza sul permesso.</p></div>
              <span>{draft.accessRules.length}</span>
            </div>
            <div className="access-rule-list">
              {!draft.accessRules.length ? (
                <div className="no-rules"><EyeOff size={19} /><strong>Nessun contenuto visibile</strong><p>Aggiungi almeno una regola ALLOW.</p></div>
              ) : draft.accessRules.map((rule, index) => (
                <div className={`access-rule is-${rule.effect.toLowerCase()}`} key={`${rule.scope}-${rule.targetId}-${index}`}>
                  <span>{rule.effect === "ALLOW" ? <Eye size={15} /> : <EyeOff size={15} />}</span>
                  <p><strong>{rule.effect === "ALLOW" ? "Può vedere" : "Nascondi"}</strong><small>{rule.label ?? rule.scope}</small></p>
                  <em>{rule.scope}</em>
                  <button onClick={() => setDraft((current) => ({ ...current, accessRules: current.accessRules.filter((_, ruleIndex) => ruleIndex !== index) }))}><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="add-access-rule">
              <div>
                <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
                  <option value="PERSON">Persona</option>
                  <option value="TAG">Tag</option>
                  <option value="GROUP">Gruppo</option>
                  <option value="MEDIA">Singolo media</option>
                  <option value="ALL">Tutta la libreria</option>
                </select>
                <input disabled={scope === "ALL"} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={scope === "ALL" ? "Tutti i media" : "Nome o identificatore…"} />
              </div>
              <div><button onClick={() => addRule("ALLOW")}><Eye size={14} /> Consenti</button><button onClick={() => addRule("DENY")}><EyeOff size={14} /> Nascondi</button></div>
            </div>
          </section>
        </div>
        <footer><button onClick={onClose}>Annulla</button><button onClick={() => onSave(draft)}>Salva accessi</button></footer>
      </aside>
    </div>
  );
}

export function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>(demoUsers);
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void fetch("/api/users")
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { users?: ManagedUser[] } | null) => {
        if (payload?.users?.length) setUsers(payload.users);
      })
      .catch(() => undefined);
  }, []);

  const visible = useMemo(
    () => users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase())),
    [query, users]
  );

  const saveUser = (user: ManagedUser) => {
    setUsers((current) => current.map((entry) => entry.id === user.id ? user : entry));
    setSelected(null);
    void fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: user.role, active: user.active, accessRules: user.accessRules })
    }).catch(() => undefined);
  };

  return (
    <section className="user-management">
      <div className="management-hero">
        <div><span><Shield size={15} /> AMMINISTRAZIONE</span><h2>Utenti & accessi</h2><p>Decidi con precisione chi vede, modifica o scarica ogni parte della libreria.</p></div>
        <button onClick={() => setAdding(true)}><Plus size={17} /> Invita utente</button>
      </div>
      <div className="access-overview">
        <div><span className="overview-icon purple"><UsersRound size={19} /></span><p><strong>{users.filter((user) => user.active).length}</strong><small>Utenti attivi</small></p></div>
        <div><span className="overview-icon green"><ShieldCheck size={19} /></span><p><strong>{users.filter((user) => user.role === "ADMIN").length}</strong><small>Amministratori</small></p></div>
        <div><span className="overview-icon amber"><KeyRound size={19} /></span><p><strong>{users.reduce((total, user) => total + user.accessRules.length, 0)}</strong><small>Regole applicate</small></p></div>
      </div>
      <div className="management-toolbar">
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca un utente…" /></label>
        <button><Shield size={15} /> Registro accessi</button>
      </div>
      <div className="user-table">
        <div className="user-table-head"><span>UTENTE</span><span>RUOLO</span><span>VISIBILITÀ</span><span>ULTIMA ATTIVITÀ</span><span>STATO</span><span /></div>
        {visible.map((user) => (
          <button className="user-row" key={user.id} onClick={() => setSelected(user)}>
            <span className="user-identity"><i>{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</i><p><strong>{user.name}</strong><small><Mail size={11} /> {user.email}</small></p></span>
            <span className={`role-badge is-${user.role.toLowerCase()}`}>{user.role === "ADMIN" ? <ShieldCheck size={13} /> : user.role === "CURATOR" ? <UserCog size={13} /> : <Eye size={13} />}{roleLabel[user.role]}</span>
            <span className="visibility-summary"><strong>{user.role === "ADMIN" ? "Tutto" : `${user.accessRules.filter((rule) => rule.effect === "ALLOW").length} permessi`}</strong><small>{user.accessRules.filter((rule) => rule.effect === "DENY").length} esclusioni</small></span>
            <span className="last-seen">{user.lastSeenAt ? new Intl.RelativeTimeFormat("it", { numeric: "auto" }).format(Math.max(-30, Math.round((new Date(user.lastSeenAt).getTime() - Date.now()) / 86_400_000)), "day") : "Mai"}</span>
            <span className={user.active ? "status-badge is-active" : "status-badge"}><i />{user.active ? "Attivo" : "Sospeso"}</span>
            <span className="user-row-action"><MoreHorizontal size={17} /><ChevronRight size={15} /></span>
          </button>
        ))}
      </div>
      {selected ? <UserDrawer user={selected} onClose={() => setSelected(null)} onSave={saveUser} /> : null}
      {adding ? (
        <div className="simple-dialog-backdrop" onMouseDown={() => setAdding(false)}>
          <form className="simple-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const user: ManagedUser = { id: `local-${Date.now()}`, name: String(data.get("name")), email: String(data.get("email")), role: String(data.get("role")) as Role, active: true, accessRules: [] };
            setUsers((current) => [...current, user]);
            setAdding(false);
            void fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user) }).catch(() => undefined);
          }}>
            <header><span><UserRound size={18} /></span><div><h2>Invita una persona</h2><p>Potrai limitarne la visibilità subito dopo.</p></div><button type="button" onClick={() => setAdding(false)}><X size={18} /></button></header>
            <label>NOME<input name="name" required placeholder="Nome e cognome" /></label>
            <label>EMAIL<input name="email" type="email" required placeholder="nome@azienda.it" /></label>
            <label>RUOLO<select name="role"><option value="VIEWER">Visualizzatore</option><option value="CURATOR">Curatore</option><option value="ADMIN">Amministratore</option></select></label>
            <footer><button type="button" onClick={() => setAdding(false)}>Annulla</button><button type="submit">Invia invito</button></footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
