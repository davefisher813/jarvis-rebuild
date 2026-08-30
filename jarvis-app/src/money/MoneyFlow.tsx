import { useCallback, useEffect, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { createPortal } from "react-dom";
import { useMoney, useTasks, useProfile, useCategories, useOptionalGoals } from "../data/NotesProvider";
import { effectiveKind } from "../categories/kinds";
import { ACCOUNT_META, ACCOUNT_KINDS, formatMoney, totalBalance, type Account, type AccountData, type AccountKind } from "./types";
import {
  loadEnvelopes, saveEnvelopes, setAsideTotal, leftToSpend, leftSub, shortLine,
  daysUntil, perDayLine, envelopeId, type Envelope,
} from "./budget";
import { activeBills, billSubline, paydayLine, paydayNext, monthDay, type PaydayInfo, type PaydayFreq } from "./bills";
import BillSheet, { type BillDraft } from "./BillSheet";
import type { TaskItem } from "../tasks/TasksService";
import { showToast } from "../shared/toast";
import { todayISO } from "../tasks/grouping";
import { catColor } from "../shared/categories";
import { DollarGlyph, RepeatGlyph, WalletGlyph, TargetGlyph } from "../shared/glyphs";
import type { Goal } from "../life/types";
import { savingsLine, savingsPct, savedTotal } from "../bigger/savings";

const CHEV = <div className="chev" />;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const WALLET = <WalletGlyph />;
const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
const REPEAT = <RepeatGlyph />;
// V2 anatomy (2026-08-15): money sections carry the green money tile.
const DOLLAR = <DollarGlyph />;

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

function AccountSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: AccountData; onSave: (d: AccountData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
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
          {/* B12: Save creates an account, so two taps created two. */}
          <button className="btn btn-primary btn-block" disabled={saving} onClick={() => { if (!valid) { setTouched(true); return; } setSaving(true); onSave({ name: name.trim(), balance: Number(balance), kind, asOf: todayISO() }); }}>{saving ? "Saving..." : "Save"}</button>
          {mode === "edit" && onDelete && <button className="btn btn-secondary btn-block btn-danger-text" onClick={onDelete}>{TRASH}Delete Account</button>}
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
  const [saving, setSaving] = useState(false);
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
          <div className="field"><div className="input-label">Next Payday</div>
            <input type="date" className="input" value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div className="field"><div className="input-label">How Often</div>
            <div className="segmented">
              <button type="button" className={"seg" + (freq === "weekly" ? " active" : "")} onClick={() => setFreq("weekly")}>Weekly</button>
              <button type="button" className={"seg" + (freq === "biweekly" ? " active" : "")} onClick={() => setFreq("biweekly")}>Every 2 Weeks</button>
              <button type="button" className={"seg" + (freq === "monthly" ? " active" : "")} onClick={() => setFreq("monthly")}>Monthly</button>
            </div></div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={saving} onClick={() => { if (!valid) { setTouched(true); return; } setSaving(true); onSave({ amount: Number(amount), next, freq }); }}>{saving ? "Saving..." : "Save"}</button>
          {onRemove && <button className="btn btn-secondary btn-block btn-danger-text" onClick={onRemove}>{TRASH}Remove Payday</button>}
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

export default function MoneyFlow({ onOpenTask }: { onOpenTask?: (id: string) => void } = {}) {
  const svc = useMoney();
  const tasksSvc = useTasks();
  const profileSvc = useProfile();
  const catsSvc = useCategories();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bills, setBills] = useState<TaskItem[]>([]);
  // Also tagged Money (2026-08-10): the "Money" category used to be its own
  // page with tasks like "Budget Review" or "File Taxes" living only there.
  // Now that tapping the category opens this tab instead, anything tagged to
  // it that ISN'T a bill would otherwise vanish from view entirely. This
  // keeps it visible, not stranded, without turning Money into a second task
  // list: bills stay bills, this is everything else that shares the tag.
  const [tagged, setTagged] = useState<TaskItem[]>([]);
  const [payday, setPayday] = useState<PaydayInfo | undefined>(undefined);
  const [isPersonal, setIsPersonal] = useState(true);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [billSheet, setBillSheet] = useState<BillSheetState>({ kind: "closed" });
  const [paydayOpen, setPaydayOpen] = useState(false);
  // Budgeting: envelopes are a plan he chose, and the breakdown stays folded
  // until he doubts the number.
  const [envelopes, setEnvelopes] = useState<Envelope[]>(() => loadEnvelopes());
  const [mathOpen, setMathOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  // PICK 24: savings goals, read here and written here. Optional service so
  // the Money tab still renders outside a full provider (bench, tests).
  const goalsSvc = useOptionalGoals();
  const [savingsGoals, setSavingsGoals] = useState<Goal[]>([]);
  const [saveInto, setSaveInto] = useState<string | null>(null);
  const [saveAmt, setSaveAmt] = useState("");
  const loadGoals = useCallback(async () => {
    if (!goalsSvc) return;
    const gl = await goalsSvc.list();
    setSavingsGoals(gl.filter((g) => !!g.data.moneyTarget && g.data.state !== "achieved" && !g.data.dropped));
  }, [goalsSvc]);
  useEffect(() => { void loadGoals(); }, [loadGoals]);
  const addSavings = async (g: Goal) => {
    const amt = Number(saveAmt);
    // Say WHY nothing happened, the same rule the envelope adder follows.
    if (!isFinite(amt) || amt <= 0) { showToast({ message: "Needs an amount over zero" }); return; }
    if (!goalsSvc) return;
    const d = todayISO();
    await goalsSvc.update(g.id, { saved: [...(g.data.saved ?? []), { d, amount: amt }] });
    setSaveInto(null); setSaveAmt("");
    await loadGoals();
    showToast({ message: formatMoney(amt) + " toward " + g.data.title });
  };
  const [envName, setEnvName] = useState("");
  const [envAmt, setEnvAmt] = useState("");
  const today = todayISO();

  const reload = useCallback(async () => {
    // Autopay bills whose date passed roll themselves forward first, so the
    // list never shows an autopay bill pretending to be overdue.
    await tasksSvc.rollAutopayBills();
    const [accts, allTasks, prof, cats] = await Promise.all([svc.list(), tasksSvc.listTasks(), profileSvc.get(), catsSvc.list()]);
    setAccounts(accts);
    setBills(activeBills(allTasks, todayISO()));
    setPayday(prof?.payday);
    setIsPersonal((prof?.template ?? "personal") === "personal");
    const moneyCatIds = new Set(cats.filter((c) => effectiveKind(c.data) === "money").map((c) => c.id));
    setTagged(allTasks.filter((t) => !t.data.done && !t.data.bill && moneyCatIds.has(t.data.category ?? "")));
  }, [svc, tasksSvc, profileSvc, catsSvc]);
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
    // The refusal now SAYS so (2026-08-09): a control that eats taps in
    // silence reads as broken, not protective.
    if (state === "paid" && b.data.recurrence) {
      showToast({ message: "Already paid · Next rolls in" });
      return;
    }
    await tasksSvc.toggleDone(b.id);
    await reload();
  };

  const anchor = payday && isPersonal && bills.length > 0 ? paydayLine(payday, bills, today) : null;

  // What is actually his. Derived from the paycheck he entered, the bills he
  // entered, and the money he chose to reserve. Absent entirely without a
  // payday, because without one there is no window and no honest answer.
  const nextPay = payday && isPersonal ? paydayNext(payday, today) : null;
  const billsOut = nextPay
    ? bills.filter((b) => !b.data.done && !!b.data.due && b.data.due <= nextPay)
        .reduce((sum, b) => sum + (b.data.bill?.amount ?? 0), 0)
    : 0;
  const setAside = setAsideTotal(envelopes);
  const left = payday && isPersonal ? leftToSpend(payday.amount, billsOut, setAside) : null;
  const daysLeft = nextPay ? daysUntil(today, nextPay) : 0;
  const balanceAsOf = accounts.map((a) => a.data.asOf).filter((d): d is string => !!d).sort().pop();

  const billRows = (
    <div>
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
              {/* V2 anatomy: state carries color (amber, never red); the words
                  themselves are the money laws' and stay untouched. */}
              <div className={sub.state === "overdue" ? "urgency urgency-warn" : "eyebrow"}>{sub.text}</div>
            </div>
            <span className={"money-amt" + (paid ? " paid" : "")}>{formatMoney(info.amount)}</span>
            {!info.autopay && !paid && info.payUrl && (
              <a className="bill-pay" href={info.payUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Pay</a>
            )}
          </div>
        );
      })}
      <button className="row row-act" onClick={() => setBillSheet({ kind: "new" })}>Add Bill</button>
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
      <PageHeader title="Money" />
      {accounts.length === 0 && bills.length === 0 && tagged.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">{WALLET}</div><div className="empty-title">No Accounts Yet</div>
          <button className="btn btn-primary" onClick={() => setSheet({ kind: "new" })}>Add an Account</button>
          <button className="btn btn-secondary" onClick={() => setBillSheet({ kind: "new" })}>Add a Bill</button></div>
      ) : (
        <>
          {/* THE NUMBER. One line answers "what is actually mine right now".
              The arithmetic behind it is one tap away and folded by default:
              nobody needs to re-read the math every single time. */}
          {left && (
            <>
              <div className="pad-x"><div className="card money-hero" role="button" tabIndex={0} onClick={() => setMathOpen(!mathOpen)}>
                <div className="money-hero-label">{nextPay ? "Yours until " + monthDay(nextPay) : "Yours"}</div>
                <div className="money-hero-total">{formatMoney(Math.max(0, left.amount))}</div>
                {left.amount < 0
                  ? <div className="money-hero-label">{shortLine(left)}</div>
                  : <div className="money-hero-label">{leftSub(left) || perDayLine(left, daysLeft)}</div>}
                {mathOpen && (
                  <div className="budget-math">
                    <div className="budget-row"><span>Paycheck</span><span>{formatMoney(left.paycheck)}</span></div>
                    {left.billsOut > 0 && (
                      <div className="budget-row"><span>Bills before {monthDay(nextPay!)}</span><span>-{formatMoney(left.billsOut)}</span></div>
                    )}
                    {left.setAside > 0 && (
                      <div className="budget-row"><span>Set aside</span><span>-{formatMoney(left.setAside)}</span></div>
                    )}
                    <div className="budget-row budget-total"><span>Yours</span><span>{formatMoney(left.amount)}</span></div>
                    {perDayLine(left, daysLeft) && <div className="money-hero-label">{perDayLine(left, daysLeft)}</div>}
                  </div>
                )}
              </div></div>

              <div className="sh2 sh2-quiet"><span className="t">Set Aside</span></div>
              <div>
                {envelopes.map((e) => (
                  <div className="row" key={e.id}>
                    <div className="row-grow"><div className="conn-name truncate">{e.name}</div></div>
                    <span className="money-amt">{formatMoney(e.amount)}</span>
                    <button className="conn-remove" aria-label={"Remove " + e.name}
                      onClick={() => setEnvelopes(saveEnvelopes(envelopes.filter((x) => x.id !== e.id)))}>{TRASH}</button>
                  </div>
                ))}
                {envOpen ? (
                  <div className="row">
                    <div className="row-grow budget-add">
                      <input className="input" placeholder="What For" value={envName} onChange={(ev) => setEnvName(ev.target.value)} />
                      <input className="input budget-amt" inputMode="numeric" placeholder="0" value={envAmt}
                        onChange={(ev) => setEnvAmt(ev.target.value)} />
                      <button className="btn btn-primary btn-sm" onClick={() => {
                        const amt = Number(envAmt);
                        // Say WHY nothing happened (2026-08-09): this button
                        // used to eat the tap in silence on a blank name or
                        // zero amount, unlike every sheet in this module.
                        if (!envName.trim() || !isFinite(amt) || amt <= 0) {
                          showToast({ message: !envName.trim() ? "Needs a name" : "Needs an amount over zero" });
                          return;
                        }
                        setEnvelopes(saveEnvelopes([...envelopes, { id: envelopeId(envelopes.length + Date.now() % 9999), name: envName, amount: amt }]));
                        setEnvName(""); setEnvAmt(""); setEnvOpen(false);
                      }}>Add</button>
                    </div>
                  </div>
                ) : (
                  <button className="row row-act" onClick={() => setEnvOpen(true)}>Set Money Aside</button>
                )}
              </div>
              {envelopes.length === 0 && (
                <div className="pad-x"><div className="input-help">
                  Reserved · Not spendable · A plan
                </div></div>
              )}
            </>
          )}

          {accounts.length > 0 && (
            <div className="pad-x"><div className="card money-hero">
              <div className="money-hero-label">Total balance</div>
              <div className="money-hero-total">{formatMoney(totalBalance(accounts))}</div>
              {/* Self-reported and it says so: the app has no live feed. */}
              <div className="money-hero-label">As you last entered it{balanceAsOf ? ` · ${monthDay(balanceAsOf)}` : ""}</div>
            </div></div>
          )}
          <div className="sh2 sh2-quiet"><span className="t">Bills</span></div>
          <div>{billRows}</div>

          {/* PICK 24 (Dave 2026-08-22): MONEY FLOWS INTO SAVINGS GOALS.
              A savings goal has been able to hold real logged money since
              Money v1, and the only door to it was two taps deep inside the
              Bigger Picture. Money gets entered where money lives. Same
              write, same derivation, same rule: only real logged dollars ever
              land here, never a skipped purchase (not-spending is not
              saving), so this is the one screen where the number and the goal
              can be kept honest in the same breath. */}
          {savingsGoals.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Saving Toward</span></div>
              <div>
                {savingsGoals.map((g) => (
                  <div className="row" key={g.id}>
                    <div className="row-glyph cat-fg-purple"><TargetGlyph /></div>
                    <div className="row-grow">
                      <div className="conn-name truncate">{g.data.title}</div>
                      <div className="conn-meta">{savingsLine(g.data.moneyTarget!, g.data.saved)}</div>
                      {savedTotal(g.data.saved) > 0 && (
                        <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, savingsPct(g.data.moneyTarget!, g.data.saved)) + "%" }} /></div>
                      )}
                    </div>
                    {saveInto === g.id ? (
                      <div className="row-grow budget-add">
                        <input className="input budget-amt" inputMode="numeric" placeholder="0" value={saveAmt}
                          onChange={(ev) => setSaveAmt(ev.target.value)} />
                        <button className="btn btn-primary btn-sm" onClick={() => void addSavings(g)}>Add</button>
                      </div>
                    ) : (
                      <button className="pill-act" onClick={() => { setSaveInto(g.id); setSaveAmt(""); }}>Add</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {tagged.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Also Tagged Money</span></div>
              <div>
                {/* These are TASKS, so they wear the task anatomy (locked
                    law: all task lists look identical). Bare text with a
                    chevron read as floating words, not a row he could act
                    on (Dave 2026-08-22). Check completes, body opens. */}
                {tagged.map((t) => (
                  <div className="row" key={t.id}>
                    <div className="task-check-tap" role="checkbox" aria-checked={false} aria-label="Complete"
                      onClick={(e) => { e.stopPropagation(); void (async () => { await tasksSvc.toggleDone(t.id); await reload(); })(); }}>
                      <div className={"task-check cat-bd-" + catColor(t.data.category)} />
                    </div>
                    <div className="row-grow" role="button" tabIndex={0} onClick={() => onOpenTask?.(t.id)}>
                      <div className="conn-name truncate">{t.data.text}</div>
                    </div>
                    {CHEV}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="sh2 sh2-quiet"><span className="t">Accounts</span><span className="n">{accounts.length}</span></div>
          <div>
            {accounts.map((a) => {
              const m = ACCOUNT_META[a.data.kind];
              return (
                <div className="proj-row" role="button" tabIndex={0} key={a.id} onClick={() => setSheet({ kind: "edit", id: a.id })}>
                  <div className={"row-glyph cat-fg-" + m.slot}>{WALLET}</div>
                  <div className="proj-meta"><div className="proj-title">{a.data.name}</div><div className="bp-sub">{m.label}</div></div>
                  <span className="money-amt">{formatMoney(a.data.balance)}</span>
                  {CHEV}
                </div>
              );
            })}
            <button className="row row-act" onClick={() => setSheet({ kind: "new" })}>Add Account</button>
          </div>
          <div className="screen-foot" />
        </>
      )}
      {sheet.kind !== "closed" && (
        <AccountSheet mode={sheet.kind === "new" ? "new" : "edit"} initial={editing?.data} onSave={save}
          onDelete={sheet.kind === "edit" ? async () => {
            // Toast + Undo (2026-08-09): Money was the only surface where a
            // delete just made the thing vanish. Same contract as everywhere.
            const gone = editing ? { ...editing.data } : null;
            await svc.remove(sheet.id);
            setSheet({ kind: "closed" });
            await reload();
            showToast({
              message: "Account deleted",
              actionLabel: "Undo",
              onAction: async () => { if (gone) await svc.create(gone); await reload(); },
            });
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {billSheet.kind !== "closed" && (
        <BillSheet mode={billSheet.kind === "new" ? "new" : "edit"}
          initial={editingBill ? { text: editingBill.data.text, due: editingBill.data.due ?? "", recurrence: editingBill.data.recurrence ?? null, bill: editingBill.data.bill! } : undefined}
          onSave={saveBill}
          onDelete={billSheet.kind === "edit" ? async () => {
            const gone = editingBill ? { ...editingBill.data } : null;
            const id = billSheet.id;
            setBillSheet({ kind: "closed" });
            await tasksSvc.deleteTask(id);
            await reload();
            showToast({
              message: "Bill deleted",
              actionLabel: "Undo",
              onAction: async () => {
                if (gone) await tasksSvc.createTask(gone.text, { due: gone.due ?? null, recurrence: gone.recurrence ?? undefined, bill: gone.bill });
                await reload();
              },
            });
          } : undefined}
          onCancel={() => setBillSheet({ kind: "closed" })} />
      )}
      {paydayOpen && (
        <PaydaySheet initial={payday}
          onSave={async (p) => { await profileSvc.save({ payday: p }); setPaydayOpen(false); await reload(); }}
          onRemove={payday ? async () => {
            // B10: one scalar with its old value in hand; the cheapest undo
            // in the whole app, and it was missing.
            const kept = payday;
            await profileSvc.save({ payday: undefined });
            setPaydayOpen(false);
            await reload();
            showToast({ message: "Payday removed", actionLabel: "Undo", onAction: () => void (async () => {
              await profileSvc.save({ payday: kept });
              await reload();
            })() });
          } : undefined}
          onCancel={() => setPaydayOpen(false)} />
      )}
    </div>
  );
}
