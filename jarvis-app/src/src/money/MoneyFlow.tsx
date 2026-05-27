import { useCallback, useEffect, useState } from "react";
import { useMoney } from "../data/NotesProvider";
import { ACCOUNT_META, ACCOUNT_KINDS, formatMoney, totalBalance, type Account, type AccountData, type AccountKind } from "./types";

const CHEV = <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const WALLET = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>;
const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

function AccountSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: AccountData; onSave: (d: AccountData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [balance, setBalance] = useState(initial ? String(initial.balance) : "");
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? "cash");
  const [touched, setTouched] = useState(false);
  const valid = name.trim().length > 0 && balance.trim() !== "" && Number.isFinite(Number(balance));
  return (
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Account" : "Edit Account"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field"><div className="input-label">Name</div>
            <input className={"input" + (touched && !name.trim() ? " input-error" : "")} placeholder="e.g. Checking" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="field"><div className="input-label">Balance (USD)</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} inputMode="numeric" placeholder="0" value={balance} onChange={(e) => setBalance(e.target.value)} />
            {touched && !valid && <div className="input-error">Enter a name and a number.</div>}</div>
          <div className="field"><div className="input-label">Type</div>
            <div className="chip-row">{ACCOUNT_KINDS.map((k) => (
              <button key={k} className={"chip" + (kind === k ? " active" : "")} onClick={() => setKind(k)}>{ACCOUNT_META[k].label}</button>))}</div></div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ name: name.trim(), balance: Number(balance), kind }); }}>Save</button>
          {mode === "edit" && onDelete && <button className="btn btn-danger btn-block" onClick={onDelete}>{TRASH}Delete Account</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

type Sheet = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

export default function MoneyFlow() {
  const svc = useMoney();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const reload = useCallback(async () => setAccounts(await svc.list()), [svc]);
  useEffect(() => { void reload(); }, [reload]);

  const editing = sheet.kind === "edit" ? accounts.find((a) => a.id === sheet.id) : undefined;
  const save = async (d: AccountData) => {
    if (sheet.kind === "new") await svc.create(d); else if (sheet.kind === "edit") await svc.update(sheet.id, d);
    setSheet({ kind: "closed" }); await reload();
  };

  return (
    <div className="screen">
      <div className="nav-bar"><div className="nav-large">Money</div></div>
      {accounts.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">{WALLET}</div><div className="empty-title">No accounts yet</div>
          <button className="btn btn-primary" onClick={() => setSheet({ kind: "new" })}>Add an Account</button></div>
      ) : (
        <>
          <div className="pad-x"><div className="card money-hero">
            <div className="money-hero-label">Total balance</div>
            <div className="money-hero-total">{formatMoney(totalBalance(accounts))}</div>
          </div></div>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Accounts</div></div></div>
          <div className="pad-x"><div className="card">
            {accounts.map((a) => {
              const m = ACCOUNT_META[a.data.kind];
              return (
                <div className="proj-row" role="button" tabIndex={0} key={a.id} onClick={() => setSheet({ kind: "edit", id: a.id })}>
                  <div className={"proj-icon cat-bg-" + m.slot}>{initialOf(a.data.name)}</div>
                  <div className="proj-meta"><div className="proj-tag">{m.label}</div><div className="proj-title">{a.data.name}</div></div>
                  <span className="money-amt">{formatMoney(a.data.balance)}</span>
                  {CHEV}
                </div>
              );
            })}
            <div className="proj-row" role="button" tabIndex={0} onClick={() => setSheet({ kind: "new" })}>
              <div className="sec-ico ico-accent">{PLUS}</div><div className="row-grow"><div className="conn-name">Add Account</div></div>
            </div>
          </div></div>
          <div className="screen-foot" />
        </>
      )}
      {sheet.kind !== "closed" && (
        <AccountSheet mode={sheet.kind === "new" ? "new" : "edit"} initial={editing?.data} onSave={save}
          onDelete={sheet.kind === "edit" ? async () => { await svc.remove(sheet.id); setSheet({ kind: "closed" }); await reload(); } : undefined}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
    </div>
  );
}
