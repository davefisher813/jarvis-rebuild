import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMoney, useTasks, useProfile } from "../data/NotesProvider";
import { ACCOUNT_META, ACCOUNT_KINDS, formatMoney, totalBalance, type Account, type AccountData, type AccountKind } from "./types";
import { activeBills, billSubline, paydayLine, monthDay, type PaydayInfo, type PaydayFreq } from "./bills";
import BillSheet, { type BillDraft } from "./BillSheet";
import type { TaskItem } from "../tasks/TasksService";
import { todayISO } from "../tasks/grouping";

const CHEV = <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const WALLET = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>;
const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
const REPEAT = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>;

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

function AccountSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: AccountData; onSave: (d: AccountData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [balance, setBalance] = useState(initial ? String(initial.balance) : "");
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? "cash");
  const [touched, setTouched] = useState(false);
  const valid = name.trim().length > 0 && balance.trim() !== "" && Number.isFinite(Number(balance));
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Account" : "Edit Account"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field"><div className="input-label">Name</div>
            <input className={"input" + (touched && !name.trim() ? " input-error" : "")} placeholder="e.g. Checking" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><div className="input-label">Balance (USD)</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} inputMode="numeric" placeholder="0" value={balance} onChange={(e) => setBalance(e.target.value)} />
            {touched && !valid && <div className="input-error">Enter a name and a number.</div>}</div>
          <div className="field"><div className="input-label">Type</div>
            <div className="chip-row">{ACCOUNT_KINDS.map((k) => (
              <button key={k} className={"chip" + (kind === k ? " active" : "")} onClick={() => setKind(k)}>{ACCOUNT_META[k].label}</button>))}</div></div>
        </div>
        <div className="pad-x sheet-actions">
          {/* Every save re-stamps asOf: the dated-balance line depends on it. */}
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ name: name.trim(), balance: Number(balance), kind, asOf: todayISO() }); }}>Save</button>
          {mode === "edit" && onDelete && <button className="btn btn-danger btn-block" onClick={onDelete}>{TRASH}Delete Account</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}

function PaydaySheet({ initial, onSave, onRemove, onCancel }: {
  initial?: PaydayInfo; onSave: (p: PaydayInfo) => void; onRemove?: () => void; onCancel: () => void;
}) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [next, setNext] = useState(initial?.next ?? "");
  const [freq, setFreq] = useState<PaydayFreq>(initial?.freq ?? "biweekly");
  const [touched, setTouched] = useState(false);
  const valid = amount.trim() !== "" && Number(amount) > 0 && !!next;
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Payday</div></div>
        <div className="pad-x sheet-form">
          <div className="field"><div className="input-label">Paycheck (USD)</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} inputMode="numeric" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {touched && !valid && <div className="input-error">Enter the amount and the next payday.</div>}</div>
          <div className="field"><div className="input-label">Next payday</div>
            <input type="date" className="input" value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div className="field"><div className="input-label">How often</div>
            <div className="segmented">
              <button type="button" className={"seg" + (freq === "weekly" ? " active" : "")} onClick={() => setFreq("weekly")}>Weekly</button>
              <button type="button" className={"seg" + (freq === "biweekly" ? " active" : "")} onClick={() => setFreq("biweekly")}>Every 2 Weeks</button>
              <button type="button" className={"seg" + (freq === "monthly" ? " active" : "")} onClick={() => setFreq("monthly")}>Monthly</button>
            </div></div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ amount: Number(amount), next, freq }); }}>Save</button>
          {onRemove && <button className="btn btn-danger btn-block" onClick={onRemove}>{TRASH}Remove Payday</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}

type Sheet = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };
type BillSheetState = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

export default function MoneyFlow() {
  const svc = useMoney();
  const tasksSvc = useTasks();
  const profileSvc = useProfile();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bills, setBills] = useState<TaskItem[]>([]);
  const [payday, setPayday] = useState<PaydayInfo | undefined>(undefined);
  const [isPersonal, setIsPersonal] = useState(true);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [billSheet, setBillSheet] = useState<BillSheetState>({ kind: "closed" });
  const [paydayOpen, setPaydayOpen] = useState(false);
  const today = todayISO();

  const reload = useCallback(async () => {
    // Autopay bills whose date passed roll themselves forward first, so the
    // list never shows an autopay bill pretending to be overdue.
    await tasksSvc.rollAutopayBills();
    const [accts, allTasks, prof] = await Promise.all([svc.list(), tasksSvc.listTasks(), profileSvc.get()]);
    setAccounts(accts);
    setBills(activeBills(allTasks, todayISO()));
    setPayday(prof?.payday);
    setIsPersonal((prof?.template ?? "personal") === "personal");
  }, [svc, tasksSvc, profileSvc]);
  useEffect(() => { void reload(); }, [reload]);

  const editing = sheet.kind === "edit" ? accounts.find((a) => a.id === sheet.id) : undefined;
  const save = async (d: AccountData) => {
    if (sheet.kind === "new") await svc.create(d); else if (sheet.kind === "edit") await svc.update(sheet.id, d);
    setSheet({ kind: "closed" }); await reload();
  };

  const editingBill = billSheet.kind === "edit" ? bills.find((b) => b.id === billSheet.id) : undefined;
  const saveBill = async (d: BillDraft) => {
    if (billSheet.kind === "new") {
      await tasksSvc.createTask(d.text, { due: d.due || null, recurrence: d.recurrence ?? undefined, bill: d.bill });
    } else if (billSheet.kind === "edit") {
      await tasksSvc.updateBillTask(billSheet.id, { text: d.text, due: d.due || null, recurrence: d.recurrence, bill: d.bill });
    }
    setBillSheet({ kind: "closed" }); await reload();
  };

  const markPaid = async (b: TaskItem) => {
    const state = billSubline(b, today).state;
    // A recently-paid recurring bill is already rolled to next month; a second
    // tap must not "pay" next month too. One-time bills can still un-check.
    if (state === "paid" && b.data.recurrence) return;
    await tasksSvc.toggleDone(b.id);
    await reload();
  };

  const anchor = payday && isPersonal && bills.length > 0 ? paydayLine(payday, bills, today) : null;
  const balanceAsOf = accounts.map((a) => a.data.asOf).filter((d): d is string => !!d).sort().pop();

  const billRows = (
    <div className="card">
      {anchor && (
        <div className="row" role="button" tabIndex={0} onClick={() => setPaydayOpen(true)}>
          <div className="row-grow">
            <div className="conn-name">{anchor.title}</div>
            <div className="eyebrow">{anchor.sub}</div>
          </div>
        </div>
      )}
      {bills.map((b) => {
        const sub = billSubline(b, today);
        const info = b.data.bill!;
        const paid = sub.state === "paid";
        return (
          <div className="row" key={b.id}>
            {info.autopay ? (
              <div className="sec-ico ico-blue">{REPEAT}</div>
            ) : (
              <div className="task-check-tap" role="checkbox" aria-checked={paid} aria-label={paid ? "Paid" : "Mark paid"}
                onClick={(e) => { e.stopPropagation(); void markPaid(b); }}>
                <div className={"task-check " + (paid ? "done" : "cat-bd-green")} />
              </div>
            )}
            <div className="row-grow" role="button" tabIndex={0} onClick={() => setBillSheet({ kind: "edit", id: b.id })}>
              <div className="conn-name truncate">{b.data.text}</div>
              <div className="eyebrow">{sub.text}</div>
            </div>
            <span className={"money-amt" + (paid ? " paid" : "")}>{formatMoney(info.amount)}</span>
            {!info.autopay && !paid && info.payUrl && (
              <a className="bill-pay" href={info.payUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Pay</a>
            )}
          </div>
        );
      })}
      <div className="row ob-addrow" role="button" tabIndex={0} onClick={() => setBillSheet({ kind: "new" })}>
        <div className="sec-ico ico-accent">{PLUS}</div><div className="row-grow"><div className="conn-name">Add Bill</div></div>
      </div>
      {isPersonal && !payday && bills.length > 0 && (
        <div className="row" role="button" tabIndex={0} onClick={() => setPaydayOpen(true)}>
          <div className="row-grow"><div className="conn-name">Set Up Payday</div></div>
          {CHEV}
        </div>
      )}
    </div>
  );

  return (
    <div className="screen">
      <div className="nav-bar"><div className="nav-large">Money</div></div>
      {accounts.length === 0 && bills.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">{WALLET}</div><div className="empty-title">No accounts yet</div>
          <button className="btn btn-primary" onClick={() => setSheet({ kind: "new" })}>Add an Account</button>
          <button className="btn btn-secondary" onClick={() => setBillSheet({ kind: "new" })}>Add a Bill</button></div>
      ) : (
        <>
          {accounts.length > 0 && (
            <div className="pad-x"><div className="card money-hero">
              <div className="money-hero-label">Total balance</div>
              <div className="money-hero-total">{formatMoney(totalBalance(accounts))}</div>
              {/* Self-reported and it says so: the app has no live feed. */}
              <div className="money-hero-label">As you last entered it{balanceAsOf ? ` · ${monthDay(balanceAsOf)}` : ""}</div>
            </div></div>
          )}
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Bills</div></div></div>
          <div className="pad-x">{billRows}</div>
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
      {billSheet.kind !== "closed" && (
        <BillSheet mode={billSheet.kind === "new" ? "new" : "edit"}
          initial={editingBill ? { text: editingBill.data.text, due: editingBill.data.due ?? "", recurrence: editingBill.data.recurrence ?? null, bill: editingBill.data.bill! } : undefined}
          onSave={saveBill}
          onDelete={billSheet.kind === "edit" ? async () => { const id = billSheet.id; setBillSheet({ kind: "closed" }); await tasksSvc.deleteTask(id); await reload(); } : undefined}
          onCancel={() => setBillSheet({ kind: "closed" })} />
      )}
      {paydayOpen && (
        <PaydaySheet initial={payday}
          onSave={async (p) => { await profileSvc.save({ payday: p }); setPaydayOpen(false); await reload(); }}
          onRemove={payday ? async () => { await profileSvc.save({ payday: undefined }); setPaydayOpen(false); await reload(); } : undefined}
          onCancel={() => setPaydayOpen(false)} />
      )}
    </div>
  );
}
