import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { useMoney, useTasks, useProfile, useCategories, useOptionalGoals, useTracker, useOptionalLedger } from "../data/NotesProvider";
import { effectiveKind } from "../categories/kinds";
import { ACCOUNT_META, ACCOUNT_KINDS, ENTITY_ACCOUNT, formatMoney, totalBalance, isLiability, signedBalance, type Account, type AccountData, type AccountKind } from "./types";
import { useFreshLists } from "../data/useFreshLists";
import { ENTITY_TASK, type Recurrence } from "../notes/types";
import {
  loadEnvelopes, forgetLocalEnvelopes, cleanEnvelopes, setAsideTotal, leftToSpend, leftSub, shortLine,
  daysUntil, perDayLine, envelopeId, type Envelope,
} from "./budget";
import { activeBills, billSubline, paydayLine, paydayNext, monthDay, paidThisMonth, type PaydayInfo, type PaydayFreq } from "./bills";
import BillSheet, { type BillDraft } from "./BillSheet";
import BillDetailSheet from "./screens/BillDetailSheet";
import { useMarkBillPaid } from "./useMarkBillPaid";
import { Amounts } from "./MoneyFacts";
import { billAmount, ledgerBillsOut, ledgerChip, ledgerLine, ledgerPaidThisMonth, mergedBills } from "./billView";
import { suggestMonthly } from "./ledger/recurring";
import { isPaid } from "./ledger/status";
import { ENTITY_MONEY_BILL, type Bill, type BillRecurrence } from "./ledger/types";
import { dismissSuggestion, isSuggestionDismissed, suggestionKey } from "./suggestionMemory";
import TrackerScreen from "./screens/TrackerScreen";
import ReceiptsSection from "./screens/ReceiptsSection";
import MatchesCard from "./screens/MatchesCard";
import type { TaskItem } from "../tasks/TasksService";
import { showToast } from "../shared/toast";
import { todayISO } from "../tasks/grouping";
import { goalTone } from "../shared/categories";
import { RepeatGlyph, WalletGlyph, TargetGlyph, DollarGlyph } from "../shared/glyphs";
import { TaskRow } from "../tasks/screens/TasksPage";
import { daysBetween } from "../upnext/upnext";
import { attemptWrite } from "../shared/guard";
import { lineCase, titleCase } from "../shared/casing";
import { inMonth, thisMonth, incomeCents, spentCents, fmtCents, ENTITY_MONEY_TX } from "./tracker";
import type { Goal } from "../life/types";
import { savingsLine, savingsPct, savedTotal } from "../bigger/savings";
import { Paperclip, Calendar, FolderKanban, Clock, Check as CheckGlyph } from "../shared/icons";
import { FormSheet, Group, FieldRow, MenuRow, DeleteRow, ErrorLine } from "../shared/FormSheet";
import { pressable } from "../shared/pressable";
import MoneyRow, { type RowVerb } from "./MoneyRow";
import RowActionSheet, { type RowAction } from "../shared/RowActionSheet";
import RowCtxAction from "../shared/RowCtxAction";

const CHEV = <div className="chev" />;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const WALLET = <WalletGlyph />;
const REPEAT = <RepeatGlyph />;

// THE BILL'S CHIP (ruled 2026-09-01, "Bill rows: amount right, urgency
// chip"; built 2026-09-02 with the Notes and Money port). The same distance
// chip a task row wears, in the same two tones: the system red for late,
// warn for due soon. Beyond six days out, paid, or on autopay, no chip: the
// second line carries the date words and nothing shouts.
function billChip(t: TaskItem, today: string): { cls: string; text: string } | null {
  const b = t.data.bill;
  const due = t.data.due;
  if (!b || b.autopay || !due) return null;
  const over = daysBetween(due, today);
  if (over > 0) return { cls: "u-late", text: lineCase(over === 1 ? "1 day late" : `${over} days late`) };
  const gap = daysBetween(today, due);
  if (gap === 0) return { cls: "u-today", text: "Today" };
  if (gap === 1) return { cls: "u-today", text: "Tomorrow" };
  if (gap <= 6) return { cls: "u-today", text: `In ${gap} Days` };
  return null;
}

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

function AccountSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: AccountData; onSave: (d: AccountData) => void | Promise<boolean | void>; onDelete?: () => void; onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  // HMN-F-13 (2026-09-05): a credit account's field asks for what is OWED,
  // so an older record that stored the debt as a negative shows its size here
  // and is written back in the new shape the next time it is saved.
  const [balance, setBalance] = useState(initial ? String(initial.kind === "credit" ? Math.abs(initial.balance) : initial.balance) : "");
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? "cash");
  const [touched, setTouched] = useState(false);
  const valid = name.trim().length > 0 && balance.trim() !== "" && Number.isFinite(Number(balance));
  const owed = isLiability(kind);
  // Every save re-stamps asOf: the dated-balance line depends on it.
  // B12: Save creates an account, so two taps created two.
  // HMN-F-09 (2026-09-05): the B12 latch went in without an error path, so a
  // failed write left this button reading "Saving" for good and ate every
  // further tap. The parent's false (or a throw) unlatches it, the way every
  // other sheet in the app has done since BRAIN-F-09.
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    const r = onSave({ name: name.trim(), balance: Number(balance), kind, asOf: todayISO() });
    void Promise.resolve(r).then((ok) => { if (ok === false) setSaving(false); }, () => setSaving(false));
  };
  // THE ACCOUNT SHEET ON THE SHEET BAR (2026-09-02): the name as the row,
  // the balance typed at the right, the type as a value that opens the
  // dropdown, Delete as the last group.
  return (
    <FormSheet title={mode === "new" ? "New Account" : "Edit Account"} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Account">
        <FieldRow tone="blue" glyph={<WalletGlyph />} value={name} onChange={setName} placeholder="e.g. Checking" ariaLabel="Account name"
          error={touched && !name.trim()} right={false} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label={owed ? "Owed" : "Balance"} value={balance} onChange={setBalance} placeholder="0" inputMode="numeric"
          ariaLabel={owed ? "Amount owed in dollars" : "Balance in dollars"} error={touched && !valid && !!name.trim()} />
        <MenuRow tone="indigo" glyph={<FolderKanban className="ic" />} label="Type" value={kind} ariaLabel="Account type"
          options={ACCOUNT_KINDS.map((k) => ({ value: k, label: ACCOUNT_META[k].label }))} onPick={(v) => setKind(v as AccountKind)} />
      </Group>
      <ErrorLine text={touched && !valid ? "Enter a name and a number." : null} />
      {mode === "edit" && onDelete && (
        <Group className="xs-actions"><DeleteRow label="Delete Account" onClick={onDelete} /></Group>
      )}
    </FormSheet>
  );
}

function PaydaySheet({ initial, onSave, onRemove, onCancel }: {
  initial?: PaydayInfo; onSave: (p: PaydayInfo) => void | Promise<boolean | void>; onRemove?: () => void; onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [next, setNext] = useState(initial?.next ?? "");
  const [freq, setFreq] = useState<PaydayFreq>(initial?.freq ?? "biweekly");
  const [touched, setTouched] = useState(false);
  const valid = amount.trim() !== "" && Number(amount) > 0 && !!next;
  // HMN-F-09 (2026-09-05): same unlatch as the account sheet above.
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    const r = onSave({ amount: Number(amount), next, freq });
    void Promise.resolve(r).then((ok) => { if (ok === false) setSaving(false); }, () => setSaving(false));
  };
  return (
    <FormSheet title="Payday" onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Paycheck">
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" value={amount} onChange={setAmount} placeholder="0" inputMode="numeric"
          ariaLabel="Paycheck in dollars" error={touched && !valid} />
        <FieldRow tone="orange" glyph={<Calendar className="ic" />} label="Next Payday" type="date" value={next} onChange={setNext} ariaLabel="Next payday" />
        <MenuRow tone="sky" glyph={<RepeatGlyph />} label="How Often" value={freq} ariaLabel="How often"
          options={[{ value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Every 2 Weeks" }, { value: "monthly", label: "Monthly" }]}
          onPick={(v) => setFreq(v as PaydayFreq)} />
      </Group>
      <ErrorLine text={touched && !valid ? "Enter the amount and the next payday." : null} />
      {onRemove && (
        <Group className="xs-actions"><DeleteRow label="Remove Payday" onClick={onRemove} /></Group>
      )}
    </FormSheet>
  );
}

type Sheet = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

// A SET-ASIDE IS ONE SHEET (Dave 2026-10-05, locked: no form inside a card, no pill inside a row). It used to be an
// inline adder in the Set Aside card, its Add and Save the card's own pill. The head's capsule opens this, and so
// does a tap on a set-aside row, filled; Save replaces it in place. Remove is the last group, as on every other sheet.
function EnvelopeSheet({ initial, onSave, onRemove, onCancel }: {
  initial?: Envelope; onSave: (name: string, amount: number) => void | Promise<boolean | void>; onRemove?: () => void; onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [touched, setTouched] = useState(false);
  const amt = Number(amount);
  const valid = name.trim().length > 0 && amount.trim() !== "" && Number.isFinite(amt) && amt > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    const r = onSave(name, amt);
    void Promise.resolve(r).then((ok) => { if (ok === false) setSaving(false); }, () => setSaving(false));
  };
  return (
    <FormSheet title={initial ? "Edit Set Aside" : "Set Money Aside"} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Set Aside">
        <FieldRow tone="blue" glyph={<WalletGlyph />} value={name} onChange={setName} placeholder="What For" ariaLabel="What for"
          error={touched && !name.trim()} right={false} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" value={amount} onChange={setAmount} placeholder="0" inputMode="numeric"
          ariaLabel="Amount in dollars" error={touched && !valid && !!name.trim()} />
      </Group>
      <ErrorLine text={touched && !valid ? (!name.trim() ? "Needs a Name" : "Needs an Amount Over Zero") : null} />
      {onRemove && <Group className="xs-actions"><DeleteRow label="Remove Set Aside" onClick={onRemove} /></Group>}
    </FormSheet>
  );
}

// MONEY INTO A SAVINGS GOAL IS ONE SHEET TOO (the same ruling): the goal's row is clean, its verb is Add, and the amount
// is typed here. Only real logged dollars ever land (a skipped purchase is not saving).
function SavingsSheet({ goal, onSave, onCancel }: { goal: Goal; onSave: (amount: string) => void | Promise<boolean | void>; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState("");
  const save = () => {
    if (saving) return;
    setSaving(true);
    void Promise.resolve(onSave(amount)).then((ok) => { if (ok === false) setSaving(false); }, () => setSaving(false));
  };
  return (
    <FormSheet title="Add Savings" onCancel={onCancel} onSave={save} saveLabel={saving ? "Saving" : "Add"}>
      <Group label={titleCase(goal.data.title)}>
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" value={amount} onChange={setAmount} placeholder="0" inputMode="numeric"
          ariaLabel="Amount in dollars" />
      </Group>
    </FormSheet>
  );
}

type BillSheetState =
  | { kind: "closed" }
  | { kind: "new" }
  // A legacy bill (a task with data.bill) keeps the sheet and the path it has
  // always had; a ledger bill edits through correctBill.
  | { kind: "edit"; id: string }
  | { kind: "editLedger"; id: string }
  // UP-CORE-13 (2026-09-05): a receipt that has been read. The draft is
  // prefilled from what the picture said and nothing is written until Save.
  | { kind: "paid"; initial: BillDraft; paidOn: string; fileId: string };

export default function MoneyFlow({ onOpenTask, onOpenEntity, openAccountId, openNonce, onOpenConsumed }: { onOpenTask?: (id: string) => void;
  /** The shell's door to any entity, used to open the email a bill came from. */
  onOpenEntity?: (kind: string, id: string) => void;
  // SHELL-F-21 (2026-09-05): a Money search hit used to land on this tab's
  // normal first screen, with the account it named neither opened nor
  // highlighted, and the row in search wore a chevron promising otherwise
  // (SearchFlow.tsx:190). This tab had no deep-link prop at all, which the
  // shell's own comment admitted (AppShell.tsx:380-382). An account opens the
  // way a tap on its row opens it: its own sheet. Same one-shot shape as
  // every other intent (shell/intents.ts).
  openAccountId?: string; openNonce?: number; onOpenConsumed?: () => void } = {}) {
  const svc = useMoney();
  const tasksSvc = useTasks();
  const profileSvc = useProfile();
  const catsSvc = useCategories();
  const trackerSvc = useTracker();
  const ledger = useOptionalLedger();
  const [accounts, setAccounts] = useState<Account[]>([]);
  // THE TRACKER ROW'S NET (2026-09-26, the pass-off: "the Tracker row's net
  // green (more in) or red (more out)"). This month's income less spending
  // from the tracker's own transactions, an amount in or out, which is a
  // meaning the key colours; null until the tracker has a transaction this
  // month, and the row then says only where it goes.
  const [monthNet, setMonthNet] = useState<number | null>(null);
  const [bills, setBills] = useState<TaskItem[]>([]);
  // Bills in the Money ledger (their own entity, never tasks). The list below
  // shows these and the legacy bill tasks together.
  const [ledgerBills, setLedgerBills] = useState<Bill[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [paidMonth, setPaidMonth] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  // Also tagged Money (2026-08-10): the "Money" category used to be its own
  // page with tasks like "Budget Review" or "File Taxes" living only there.
  // Now that tapping the category opens this tab instead, anything tagged to
  // it that ISN'T a bill would otherwise vanish from view entirely. This
  // keeps it visible, not stranded, without turning Money into a second task
  // list: bills stay bills, this is everything else that shares the tag.
  const [tagged, setTagged] = useState<TaskItem[]>([]);
  const [payday, setPayday] = useState<PaydayInfo | undefined>(undefined);
  // S5-Q33 (2026-09-04): "the budget half is off for Student and Business."
  // The arithmetic (budget.ts/bills.ts) takes only dates and amounts -- no
  // template parameter exists to gate on, and never did. The gate is ONLY
  // here, and it used to read "personal," which caught Student in the same
  // net as Business. Business stays excluded on purpose: irregular revenue
  // makes "a paycheck" the wrong shape, and the honest-money rule (budget.ts
  // top comment) forbids fabricating a regular one. Student has a real,
  // recurring inflow (allowance, stipend, a job) and is the template this
  // product leads with -- there was never a reason for it to lose this half.
  const [payHalfOn, setPayHalfOn] = useState(true);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [billSheet, setBillSheet] = useState<BillSheetState>({ kind: "closed" });
  const [paydayOpen, setPaydayOpen] = useState(false);
  // Budgeting: envelopes are a plan he chose, and the breakdown stays folded
  // until he doubts the number.
  // HMN-F-12 (2026-09-05), option A: they are read from the profile now, not
  // from this device, so reload fills them the same way it fills payday.
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  // The one-time lift of what this device already had, attempted once per
  // mount: a failed write leaves the local copy exactly where it was.
  const lifted = useRef(false);
  const [mathOpen, setMathOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  // PICK 24: savings goals, read here and written here. Optional service so
  // the Money tab still renders outside a full provider (bench, tests).
  const goalsSvc = useOptionalGoals();
  const [savingsGoals, setSavingsGoals] = useState<Goal[]>([]);
  const [saveInto, setSaveInto] = useState<string | null>(null);
  const loadGoals = useCallback(async () => {
    if (!goalsSvc) return;
    const gl = await goalsSvc.list();
    setSavingsGoals(gl.filter((g) => !!g.data.moneyTarget && g.data.state !== "achieved" && !g.data.dropped));
  }, [goalsSvc]);
  useEffect(() => { void loadGoals(); }, [loadGoals]);
  const addSavings = async (g: Goal, text: string): Promise<boolean> => {
    const amt = Number(text);
    // Say WHY nothing happened, the same rule the envelope adder follows.
    if (!text.trim() || !isFinite(amt) || amt <= 0) { showToast({ message: "Needs an Amount Over Zero" }); return false; }
    if (!goalsSvc) return false;
    const d = todayISO();
    // HMN-F-09: the receipt below is a claim that the money landed, so it
    // fires only after the write resolved.
    if (!(await attemptWrite(() => goalsSvc.update(g.id, { saved: [...(g.data.saved ?? []), { d, amount: amt }] })))) return false;
    setSaveInto(null);
    await loadGoals();
    showToast({ message: formatMoney(amt) + " toward " + g.data.title });
    return true;
  };
  // THE SET-ASIDE SHEET (Dave 2026-10-05: a set-aside row opens itself in the sheet it was made in, filled, and Save
  // replaces it in place; Remove is a swipe, a menu line and the sheet's last group).
  const [envSheet, setEnvSheet] = useState<{ kind: "new" } | { kind: "edit"; id: string } | null>(null);
  // HMN-F-12 (2026-09-05): every envelope change is one guarded write to the
  // profile, and the screen only shows what actually landed.
  const writeEnvelopes = async (next: Envelope[]): Promise<boolean> => {
    const clean = cleanEnvelopes(next);
    const ok = await attemptWrite(() => profileSvc.save({ envelopes: clean }));
    if (ok) setEnvelopes(clean);
    return ok;
  };
  // Reversible without a confirm: removing one had no Undo at all, and this
  // is a plan someone made, not a typo.
  const removeEnvelope = async (e: Envelope) => {
    const before = envelopes;
    if (!(await writeEnvelopes(envelopes.filter((x) => x.id !== e.id)))) return;
    showToast({ message: "Set Aside Removed", actionLabel: "Undo", onAction: () => void writeEnvelopes(before) });
  };
  const today = todayISO();

  // RECEIPTS are records now (Money ledger, 2026-10-03) and live in
  // screens/ReceiptsSection. The paperclip in the bar only asks it to open a
  // new one, by bumping this number.
  const [receiptAdd, setReceiptAdd] = useState(0);

  const reload = useCallback(async () => {
    // Autopay bills whose date passed roll themselves forward first, so the
    // list never shows an autopay bill pretending to be overdue.
    await tasksSvc.rollAutopayBills();
    const [accts, allTasks, prof, cats, trk, lb] = await Promise.all([
      svc.list(), tasksSvc.listTasks(), profileSvc.get(), catsSvc.list(),
      // Best effort: a tracker that cannot be read costs the row its net,
      // never the page.
      trackerSvc.load().catch(() => null),
      // The ledger's bills, best effort for the same reason: a failed read
      // keeps what is on screen (null) rather than showing no bills at all.
      ledger ? ledger.listBills().catch(() => null) : Promise.resolve([] as Bill[]),
    ]);
    if (lb) setLedgerBills(lb);
    setAccounts(accts);
    const txs = trk ? inMonth(trk.txs, thisMonth()) : [];
    setMonthNet(txs.length > 0 ? incomeCents(txs) - spentCents(txs) : null);
    setBills(activeBills(allTasks, todayISO()));
    // UP-CORE-13 (2026-09-05): what actually went out this month, from the
    // paid bills the app holds. Read off the whole task list, because
    // activeBills drops a one-time bill thirty days after it was paid.
    const legacyPaid = paidThisMonth(allTasks, todayISO());
    const ledgerPaid = lb ? ledgerPaidThisMonth(lb, todayISO()) : { total: 0, count: 0 };
    setPaidMonth({ total: legacyPaid.total + ledgerPaid.total, count: legacyPaid.count + ledgerPaid.count });
    setPayday(prof?.payday);
    setPayHalfOn((prof?.template ?? "personal") !== "business");
    // HMN-F-12: the profile is the truth. An account that has never written
    // one still has whatever this phone stored, so it goes up once and the
    // local copy is forgotten; nothing is lost and nothing syncs twice.
    if (prof?.envelopes) {
      setEnvelopes(prof.envelopes);
    } else {
      const local = loadEnvelopes();
      setEnvelopes(local);
      if (local.length > 0 && !lifted.current) {
        lifted.current = true;
        if (await attemptWrite(() => profileSvc.save({ envelopes: local }))) forgetLocalEnvelopes();
      }
    }
    const moneyCatIds = new Set(cats.filter((c) => effectiveKind(c.data) === "money").map((c) => c.id));
    setTagged(allTasks.filter((t) => !t.data.done && !t.data.bill && moneyCatIds.has(t.data.category ?? "")));
  }, [svc, tasksSvc, profileSvc, catsSvc, trackerSvc, ledger]);
  useEffect(() => { void reload(); }, [reload]);
  // UP-PLAT-06 (2026-09-06): this page draws accounts AND the bills that live
  // as tasks, so a bill paid on the laptop repaints here too.
  // The tracker's transactions too (2026-09-26): the Tracker row carries
  // this month's net, so an import or an edit on another device repaints it.
  useFreshLists([ENTITY_ACCOUNT, ENTITY_TASK, ENTITY_MONEY_TX, ENTITY_MONEY_BILL], reload);

  // SHELL-F-21: the account the shell was asked to open, once the list it
  // lives in has arrived. Held until then rather than opening an empty sheet;
  // an id with no account behind it (deleted since) opens nothing, quietly,
  // the same as a link to a deleted person.
  // A BILL IS OPENED THE SAME WAY (a Today bill card, a search hit): the id
  // may name a ledger bill, which opens its own page.
  useEffect(() => {
    if (!openAccountId) return;
    if (accounts.some((a) => a.id === openAccountId)) setSheet({ kind: "edit", id: openAccountId });
    else if (ledgerBills.some((b) => b.id === openAccountId)) setDetailId(openAccountId);
    else return;
    onOpenConsumed?.();
     
  }, [openAccountId, openNonce, accounts, ledgerBills]);

  const editing = sheet.kind === "edit" ? accounts.find((a) => a.id === sheet.id) : undefined;
  // HMN-F-09 (2026-09-05): Money was the last module writing outside the
  // guard. Every write below runs through attemptWrite, so a rejection says
  // "Couldn't save" instead of nothing, and the sheet keeps what was typed.
  const save = async (d: AccountData): Promise<boolean> => {
    const ok = await attemptWrite(async () => {
      if (sheet.kind === "new") await svc.create(d); else if (sheet.kind === "edit") await svc.update(sheet.id, d);
    });
    if (!ok) return false;
    setSheet({ kind: "closed" }); await reload();
    return true;
  };

  // Delete an account with the way back (Toast + Undo, 2026-08-09: Money was the only surface where a delete just made
  // the thing vanish). The row's swipe, the menu and the sheet all land here. HMN-F-09: "Account deleted" is a claim, so
  // it waits for the write.
  const removeAccount = async (id: string, data: AccountData | undefined): Promise<boolean> => {
    const gone = data ? { ...data } : null;
    if (!(await attemptWrite(() => svc.remove(id)))) return false;
    setSheet({ kind: "closed" });
    await reload();
    showToast({
      message: "Account Deleted",
      actionLabel: "Undo",
      onAction: async () => { if (gone) await attemptWrite(() => svc.create(gone)); await reload(); },
    });
    return true;
  };

  const editingBill = billSheet.kind === "edit" ? bills.find((b) => b.id === billSheet.id) : undefined;
  const detailBill = detailId ? ledgerBills.find((b) => b.id === detailId) : undefined;
  const editingLedger = billSheet.kind === "editLedger" ? ledgerBills.find((b) => b.id === billSheet.id) : undefined;
  // The sheet's draft as the ledger takes it. A blank due date stays blank (a
  // guessed one is worse than none), a blank currency is dollars, and only a
  // repeat the ledger knows is passed on.
  const ledgerInput = (d: BillDraft) => ({
    vendor: d.text,
    amount: d.bill.amount,
    currency: d.currency ?? null,
    dueDate: d.due || null,
    notes: d.notes || null,
    autopay: !!d.bill.autopay,
    payUrl: d.bill.payUrl ?? null,
    recurrence: (d.recurrence === "weekly" || d.recurrence === "monthly" || d.recurrence === "yearly" ? d.recurrence : null) as BillRecurrence | null,
  });
  const saveBill = async (d: BillDraft): Promise<boolean> => {
    let note: string | null = null;
    const ok = await attemptWrite(async () => {
      if (billSheet.kind === "new" || billSheet.kind === "paid") {
        // A new bill is a LEDGER bill, never a task (the ledger's first rule).
        if (!ledger) throw new Error("no ledger");
        const r = await ledger.addBill(ledgerInput(d));
        if (!r.ok) throw new Error(r.errors.join(","));
        if (r.duplicate) note = "Already On Your List";
        if (billSheet.kind === "paid") {
          // From a Receipt: the sheet said "Files as paid <day>" and the person
          // pressed Save, which is their own word that it was paid that day.
          const w = await ledger.markBillPaidByUser(r.id, billSheet.paidOn);
          if (!w.ok) throw new Error(w.reason);
        }
      } else if (billSheet.kind === "editLedger") {
        if (!ledger) throw new Error("no ledger");
        const { recurrence, ...rest } = ledgerInput(d);
        const r = await ledger.correctBill(billSheet.id, { ...rest, recurrence });
        if (!r.ok) throw new Error(r.reason);
      } else if (billSheet.kind === "edit") {
        // A legacy bill task keeps the path it has always had.
        await tasksSvc.updateBillTask(billSheet.id, { text: d.text, due: d.due || null, recurrence: d.recurrence as Recurrence | null, bill: d.bill });
      }
    });
    if (!ok) return false;
    setBillSheet({ kind: "closed" }); await reload();
    if (note) showToast({ message: note });
    return true;
  };

  // MARK PAID for a ledger bill, through the one door every Mark Paid shares
  // (confirm, or one tap with Undo: confirmMarkPaid.ts). Legacy rows use
  // markPaid below, untouched.
  const ledgerPay = useMarkBillPaid(reload);

  // Take the paid state off. The toast's Undo puts back exactly what was there:
  // the payment link for a matched payment, the person's word otherwise.
  const removePaidState = async (b: Bill) => {
    if (!ledger) return;
    const was = b.data;
    if (!(await attemptWrite(async () => { const r = await ledger.unmarkBillPaid(b.id); if (!r.ok) throw new Error(r.reason); }))) return;
    await reload();
    showToast({
      message: "Marked Unpaid", actionLabel: "Undo",
      onAction: () => void (async () => {
        await attemptWrite(async () => {
          const e = was.paidEvidence;
          if (!e || !was.paidAt) return;
          const r = e.type === "transaction" ? await ledger.approveBillMatch(b.id, e.transactionId) : await ledger.markBillPaid(b.id, e, was.paidAt);
          if (!r.ok) throw new Error(r.reason);
        });
        await reload();
      })(),
    });
  };

  // Delete a ledger bill with the way back (restoreBill puts the same record
  // under the same id). The snapshot is the service's own, taken before the
  // delete.
  const deleteLedgerBill = async (b: Bill): Promise<boolean> => {
    if (!ledger) return false;
    const taken: { bill: Bill | null } = { bill: null };
    if (!(await attemptWrite(async () => { taken.bill = await ledger.removeBill(b.id); }))) return false;
    setDetailId(null);
    await reload();
    showToast({
      message: "Bill Deleted",
      actionLabel: "Undo",
      onAction: async () => {
        if (taken.bill) await attemptWrite(() => ledger.restoreBill(taken.bill!));
        await reload();
      },
    });
    return true;
  };

  const markPaid = async (b: TaskItem) => {
    const state = billSubline(b, today).state;
    // A recently-paid recurring bill is already rolled to next month; a second
    // tap must not "pay" next month too. One-time bills can still un-check.
    // The refusal now SAYS so (2026-08-09): a control that eats taps in
    // silence reads as broken, not protective.
    if (state === "paid" && b.data.recurrence) {
      showToast({ message: "Already Paid · Next Rolls In" });
      return;
    }
    if (!(await attemptWrite(() => tasksSvc.toggleDone(b.id)))) return;
    await reload();
  };

  // The same delete the bill sheet performs, reachable from the row's swipe
  // (Dave 2026-09-20: "should be able to delete always"). Written once here
  // and once in the sheet's onDelete rather than shared, because the sheet
  // also has to close itself and only after the write lands (HMN-F-09); what
  // both owe the user is identical and is the part that matters: a snapshot
  // taken BEFORE the write, so Undo restores the bill's recurrence and
  // amount, not just its name.
  const deleteBill = async (b: TaskItem) => {
    const gone = { ...b.data };
    if (!(await attemptWrite(() => tasksSvc.deleteTask(b.id)))) return;
    await reload();
    showToast({
      message: "Bill Deleted",
      actionLabel: "Undo",
      onAction: async () => {
        // createTask will not make a bill any more (a new bill is a ledger
        // bill); Undo puts the stored task back whole, as it was.
        await attemptWrite(() => tasksSvc.recreateFrom(gone));
        await reload();
      },
    });
  };

  const entries = mergedBills(ledgerBills, bills, today);
  const anchor = payday && payHalfOn && entries.length > 0
    ? paydayLine(payday, bills, today, ledgerBillsOut(ledgerBills, paydayNext(payday, today), today))
    : null;

  // What is actually his. Derived from the paycheck he entered, the bills he
  // entered, and the money he chose to reserve. Absent entirely without a
  // payday, because without one there is no window and no honest answer.
  const nextPay = payday && payHalfOn ? paydayNext(payday, today) : null;
  const billsOut = nextPay
    ? bills.filter((b) => !b.data.done && !!b.data.due && b.data.due <= nextPay)
        .reduce((sum, b) => sum + (b.data.bill?.amount ?? 0), 0) + ledgerBillsOut(ledgerBills, nextPay, today)
    : 0;
  const setAside = setAsideTotal(envelopes);
  const left = payday && payHalfOn ? leftToSpend(payday.amount, billsOut, setAside) : null;
  const daysLeft = nextPay ? daysUntil(today, nextPay) : 0;
  const balanceAsOf = accounts.map((a) => a.data.asOf).filter((d): d is string => !!d).sort().pop();

  // TASKS TAGGED MONEY ARE TASKS (Health's Up Next got the same row on
  // 2026-09-02: "like it does everywhere else"): the Tasks page's own row,
  // check, swipe, Delete with Undo. No Start here: money is not a fifteen-
  // minute block. No Tomorrow either, for the reason bills never had one.
  const deleteTagged = async (id: string) => {
    const t = await tasksSvc.task(id);
    const ok = await attemptWrite(() => tasksSvc.deleteTask(id));
    await reload();
    if (ok && t) {
      showToast({
        message: "Task Deleted",
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(() => tasksSvc.recreateFrom(t));
          await reload();
        },
      });
    }
  };

  // THE ONE SUGGESTION AT A TIME (quiet by design): three or more bills from
  // one vendor, the same amount, on consecutive months, none already monthly,
  // and not waved off this session. suggestMonthly reads the bills the person
  // entered and asks no model.
  const [, setSuggestTick] = useState(0);
  const suggestion = suggestMonthly(ledgerBills).find((x) => !isSuggestionDismissed(suggestionKey(x)));
  const suggestionCurrency = ledgerBills.find((b) => b.id === suggestion?.billId)?.data.currency ?? "USD";
  const [offerOpen, setOfferOpen] = useState(false);
  const notNowSuggestion = () => {
    if (!suggestion) return;
    dismissSuggestion(suggestionKey(suggestion));
    setSuggestTick((n) => n + 1);
  };
  const acceptSuggestion = async (x: NonNullable<typeof suggestion>) => {
    if (!ledger) return;
    const ok = await attemptWrite(async () => { const r = await ledger.confirmBillRecurrence(x.billId, x.recurrence); if (!r.ok) throw new Error(r.reason); });
    if (!ok) return;
    await reload();
    showToast({
      message: "Now Monthly", actionLabel: "Undo",
      onAction: () => void (async () => {
        await attemptWrite(async () => { const r = await ledger.correctBill(x.billId, { recurrence: null }); if (!r.ok) throw new Error(r.reason); });
        await reload();
      })(),
    });
  };

  // THE BILL ROW'S ONE VERB (Dave 2026-10-05, locked): Mark Paid. It is the swipe-left, the tray's first button, the
  // long-press menu's first line and, once the bill's moment has come (late, or due today), the one quiet word on the
  // row (RowCtxAction). Swipe right is the same Paid, as it has been since UP-CORE-15. No Pay or Track pill: the pay
  // link is in the menu and the sheet. Autopay is exempt by the money law (the app cannot know a payment cleared, so
  // there is nothing for a gesture or a word to claim), and a paid bill has nothing to mark.
  const payVerb = (run: () => void): RowVerb => ({ label: "Mark Paid", icon: <CheckGlyph className="ic" />, run });
  const dueNow = (chip: { cls: string; text: string } | null) => !!chip && (chip.cls === "u-late" || /\btoday$/i.test(chip.text));
  const payLinkAction = (url: string | undefined): RowAction[] =>
    url ? [{ label: "Pay", onPick: () => { window.open(/^https?:\/\//i.test(url) ? url : "https://" + url, "_blank", "noopener,noreferrer"); } }] : [];

  // A legacy bill row: a task with data.bill, exactly as it has always drawn.
  const legacyRow = (b: TaskItem) => {
        const sub = billSubline(b, today);
        const info = b.data.bill!;
        const paid = sub.state === "paid";
        const chip = paid ? null : billChip(b, today);
        // The chip says how close; the words say when. "IN 2 DAYS" over
        // "Due in 2 days" said one thing twice (caught on the port).
        // THE LINE WEARS THE KEY (§AM, 2026-09-26). Paid is green, the key's
        // word for it, as the amount beside it already is. An autopay bill's
        // words stay the row's one grey and its day is a date in small caps,
        // with no dot baked between them (F3, F5). An unpaid bill's due date
        // is a date too: the chip ahead of it wears the colour and says how
        // close, the date says when. A bill with no date has nothing to say
        // here, so the row says nothing (§AK).
        const line = paid
          ? <span className="r-goal fact good">{lineCase(sub.text)}</span>
          : sub.state === "autopay"
            ? <><span className="r-goal r-cat">{lineCase(sub.text)}</span>{sub.when && <span className="fact date">{sub.when}</span>}</>
            : b.data.due
              ? <span className="fact date">{"Due " + monthDay(b.data.due)}</span>
              : null;
        const canPay = !paid && !info.autopay;
        const pay = () => void markPaid(b);
        const open = () => setBillSheet({ kind: "edit", id: b.id });
        // His own typed names are SHOWN in Title Case and stored as typed (the whole casing rule, 2026-09-26).
        const title = titleCase(b.data.text);
        return (
          <MoneyRow key={b.id} name={title}
            verb={canPay ? payVerb(pay) : null}
            complete={canPay ? { label: "Paid", run: pay } : null}
            onDelete={() => void deleteBill(b)}
            menu={[
              ...(canPay ? [{ label: "Mark Paid", onPick: pay }] : []),
              ...(canPay ? payLinkAction(info.payUrl) : []),
              { label: "Edit", onPick: open },
              { label: "Delete", destructive: true, onPick: () => void deleteBill(b) },
            ]}
            onOpen={open}>
            {info.autopay ? (
              <div className="task-check-tap"><span className="gm-slot cat-fg-green">{REPEAT}</span></div>
            ) : (
              <div className="task-check-tap" role="checkbox" aria-checked={paid} aria-label={paid ? "Paid" : "Mark paid"}
                onClick={(e) => { e.stopPropagation(); void markPaid(b); }}>
                <div className={"task-check" + (paid ? " done" : "")} />
              </div>
            )}
            <div className="task-title">
              <span className="task-name">{title}</span>
              {(chip || line) && (
                <div className="r-k">
                  {chip && <span className={"uchip " + chip.cls}>{chip.text}</span>}
                  {/* The words are the money laws' own (bills.ts) and stay. */}
                  {line}
                </div>
              )}
            </div>
            <span className={"money-amt" + (paid ? " paid" : "")}>{formatMoney(info.amount)}</span>
            <RowCtxAction when={canPay && dueNow(chip)} label="Mark Paid" ariaLabel={"Mark Paid " + title} onAct={pay} />
          </MoneyRow>
        );
  };

  // A LEDGER BILL ROW. The same anatomy as the legacy row beside it (check,
  // name, one grey line with the chip, amount) so the two read as one list;
  // what differs is the source of every word (billView.ts, from the ledger's
  // computed status) and that a tap opens the bill's own page.
  const ledgerRow = (bill: Bill) => {
    const d = bill.data;
    const paid = isPaid(d);
    const chip = paid ? null : ledgerChip(d, today);
    const line = ledgerLine(d, today);
    // With a chip saying how close ("Due in 3 Days"), the line only says which
    // day, so "Due" is not said twice.
    const lineEl = paid
      ? <span className="r-goal fact good">{line.text}</span>
      : line.state === "reconfirm"
        // 2026-10-05 (visual catalog gate, R3): a correction reopened a paid
        // bill and it waits for the person, which is the key's "needs you
        // soon" amber, not the row's grey. (In light a stylesheet rule still
        // draws .r-goal.fact.warn in grey; reported, not worked around here,
        // because a bare .fact.warn takes the row title's size.)
        ? <span className="r-goal fact warn">{line.text}</span>
        : line.state === "autopay"
          ? <><span className="r-goal r-cat">{line.text}</span>{line.when && <span className="fact date">{line.when}</span>}</>
          : line.state === "due"
            ? <span className="fact date">{chip && d.dueDate ? monthDay(d.dueDate) : line.text}</span>
            : null;
    const canPay = !paid && !d.autopay;
    const pay = () => ledgerPay.request(bill);
    const open = () => setDetailId(bill.id);
    const title = titleCase(d.vendor);
    return (
      <MoneyRow key={bill.id} name={title}
        verb={canPay ? payVerb(pay) : null}
        complete={canPay ? { label: "Paid", run: pay } : null}
        onDelete={() => void deleteLedgerBill(bill)}
        menu={[
          ...(canPay ? [{ label: "Mark Paid", onPick: pay }] : []),
          ...(canPay ? payLinkAction(d.payUrl) : []),
          ...(d.paidAt ? [{ label: "Remove Paid State", onPick: () => void removePaidState(bill) }] : []),
          { label: "Edit", onPick: () => setBillSheet({ kind: "editLedger", id: bill.id }) },
          { label: "Delete", destructive: true, onPick: () => void deleteLedgerBill(bill) },
        ]}
        onOpen={open}>
        {d.autopay ? (
          <div className="task-check-tap"><span className="gm-slot cat-fg-green">{REPEAT}</span></div>
        ) : (
          <div className="task-check-tap" role="checkbox" aria-checked={paid} aria-label={paid ? "Paid" : "Mark paid"}
            onClick={(e) => { e.stopPropagation(); if (paid) setDetailId(bill.id); else ledgerPay.request(bill); }}>
            <div className={"task-check" + (paid ? " done" : "")} />
          </div>
        )}
        <div className="task-title">
          <span className="task-name">{title}</span>
          {(chip || lineEl) && (
            <div className="r-k">
              {chip && <span className={"uchip " + chip.cls}>{chip.text}</span>}
              {lineEl}
            </div>
          )}
        </div>
        <span className={"money-amt" + (paid ? " paid" : "")}>{billAmount(d)}</span>
        <RowCtxAction when={canPay && dueNow(chip)} label="Mark Paid" ariaLabel={"Mark Paid " + title} onAct={pay} />
      </MoneyRow>
    );
  };

  // THE BILL ROW (ruled 2026-09-01: amount right, urgency chip; built with the
  // Notes and Money port 2026-09-02). The task row's own anatomy: the
  // rounded-square check (autopay wears the repeat glyph in that column,
  // because there is nothing to tick), the name, one grey line with the
  // chip and the date words, the amount in the trailing column. The caps
  // eyebrow that used to carry the date is gone with the rest of them.
  // Add Bill is the Bills head's capsule, never a row at the foot of this card.
  const hasBillRows = !!anchor || entries.length > 0;
  const billRows = (
    <>
      {anchor && (
        <div className="task-row p2" {...pressable(() => setPaydayOpen(true))}>
          <div className="task-title">
            <span className="task-name">{anchor.title}</span>
            <div className="r-k"><span className="r-goal r-cat"><Amounts text={lineCase(anchor.sub)} /></span></div>
          </div>
          {CHEV}
        </div>
      )}
      {entries.map((e) => (e.kind === "legacy" ? legacyRow(e.task) : ledgerRow(e.bill)))}
      {payHalfOn && !payday && entries.length > 0 && (
        <div className="task-row p2" {...pressable(() => setPaydayOpen(true))}>
          <div className="task-title"><span className="task-name">Set Up Payday</span></div>
          {CHEV}
        </div>
      )}
    </>
  );

  // A bare account row, shared by the balance card and the Accounts card. A tap opens its sheet (which holds Delete);
  // swipe left is Delete, and the long press is the menu.
  const accountRow = (a: Account) => {
    const m = ACCOUNT_META[a.data.kind];
    const open = () => setSheet({ kind: "edit", id: a.id });
    const title = titleCase(a.data.name);
    return (
      <MoneyRow key={a.id} name={title} onDelete={() => void removeAccount(a.id, a.data)}
        menu={[{ label: "Edit", onPick: open }, { label: "Delete", destructive: true, onPick: () => void removeAccount(a.id, a.data) }]}
        onOpen={open}>
        <div className="task-title">
          <span className="task-name">{title}</span>
          {/* THE KIND RIDES A DOT (2026-09-26, the pass-off: "a kind dot per
              account"). ACCOUNT_META has carried a colour slot per kind since
              Money v1 and nothing drew it; the catalog's category primitive
              puts it on the dot and leaves the word the row's one grey (§AM:
              the category rides a dot, never the words). Green cash, sky
              savings, blue investment, red credit, graphite other. */}
          <div className="r-k"><span className="r-goal r-cat fact cat"><span className={"cd cat-bg-" + m.slot} />{m.label}</span></div>
        </div>
        {/* A negative balance is a fact, not an alarm: it reads in the
            quiet ink with its sign, never in red (L1, red is a verb).
            HMN-F-13: a credit account shows what it takes off the total,
            so the row and the number above it can never disagree. */}
        <span className={"money-amt" + (signedBalance(a.data) < 0 ? " money-neg" : "")}>{formatMoney(signedBalance(a.data))}</span>
      </MoneyRow>
    );
  };

  // The head's one capsule for the section's one action (Dave 2026-10-05, locked): Add Account lives on the Accounts
  // head, as New Event and Schedule sit on Tonight's, never as a row at the foot of a card.
  const addAccountCapsule = <button className="see-all pill-action" onClick={() => setSheet({ kind: "new" })}>Add Account</button>;

  // THE TOP OF MONEY (Notes and Money catalog, 2026-09-02). Which shape
  // leads the page is the catalog's third pick; the constant is the switch.
  //   "hero-accts": the balance card holds its accounts (recommended)
  //   "bills-lead": bills first, the balance as one line under the title
  //   "before":     the old order on the ruled cards, accounts last
  // THE TRACKER (PASSOFF 2026-09-19). Its own screen rather than a section
  // in this scroll: it is four tabs over a month of transactions, which is a
  // place you go rather than something you glance at on the way past. This
  // page keeps every section it already had.
  const [tracker, setTracker] = useState(false);
  const MONEY_TOP = "hero-accts" as "hero-accts" | "bills-lead" | "before";
  // Self-reported and it says so, then the day it was entered, as a date
  // (§AM F5), with the dot between them drawn by .facts rather than baked
  // into the words (F3).
  // The count is back beside them (the lead, 2026-09-26: "As You Last
  // Entered It · Sep 18 · 4 Accounts"), a number with no state, so white
  // (§AM); the words before it keep the line's one grey (§AK). It is a
  // wrapping .conn-meta of facts, not a .facts row: one line on a hero
  // card, not a list row, so at type scale 1.4 it takes a second line
  // rather than cutting both ends, and the CSS still draws the dots.
  const balanceFacts = (
    <div className="money-hero-label conn-meta">
      <span className="fact">As You Last Entered It</span>
      {balanceAsOf && <span className="fact date">{monthDay(balanceAsOf)}</span>}
      <span className="fact"><b>{accounts.length} {accounts.length === 1 ? "Account" : "Accounts"}</b></span>
    </div>
  );

  const receiptsSection = <ReceiptsSection addNonce={receiptAdd} />;

  // Back from the tracker re-reads: the row under it says this month's net
  // and the tracker is where that number changes.
  if (tracker) return <TrackerScreen onBack={() => { setTracker(false); void reload(); }} />;

  // WHERE IT WENT. The hero answers what is left; this is the door to the
  // other half. It is rendered in both branches below on purpose: a page
  // with no accounts yet is precisely where someone arrives to import a
  // month of transactions, and hiding the way in until they have typed a
  // balance would be the wrong way round.
  const trackerRow = (
    <div className="pad-x"><div className="card list-card-ruled">
      <div className="row money-tracker-row" {...pressable(() => setTracker(true))}>
        <div className="row-grow">
          <div className="conn-name">Tracker</div>
          {/* The net is the row's one key colour, green when more came in
              than went out and the system red when more went out (over the
              limit, §AM), ahead of the row's one grey; a month with nothing
              tracked says nothing. Zero exactly is a number with no state,
              white. The period is the tracker's own: its dashboard opens on
              this month, and the fact is kept short so it never ellipsizes
              beside the door's words at type scale 1.4. */}
          <div className="facts">
            {monthNet != null && monthNet !== 0 && (
              <span className={"fact " + (monthNet > 0 ? "good" : "red")}>{lineCase(`${fmtCents(Math.abs(monthNet))} more ${monthNet > 0 ? "in" : "out"}`)}</span>
            )}
            {monthNet === 0 && <span className="fact"><b>Even This Month</b></span>}
            <span className="fact">Spending, Budgets and Subscriptions</span>
          </div>
        </div>
        {CHEV}
      </div>
    </div></div>
  );

  return (
    <div className="screen ruled">
      {/* The bar keeps the receipt's paperclip. Add Account is the Accounts head's capsule now, one door for the one
          action (Dave 2026-10-05, locked: a section-level action lives in its section head). */}
      <PageHeader title="Money" actions={<BarAction label="Add a Receipt" onClick={() => setReceiptAdd((n) => n + 1)}><Paperclip className="ic" /></BarAction>} />
      {accounts.length === 0 && entries.length === 0 && tagged.length === 0 ? (
        <>
        <div className="empty-state"><div className="empty-icon">{WALLET}</div><div className="empty-title">No Accounts Yet</div>
          <button className="btn btn-primary" onClick={() => setSheet({ kind: "new" })}>Add an Account</button>
          <button className="btn btn-secondary" onClick={() => setBillSheet({ kind: "new" })}>Add a Bill</button></div>
          {trackerRow}
          <MatchesCard />
          {receiptsSection}
        </>
      ) : (
        <>
          {/* THE NUMBER. One line answers "what is actually mine right now".
              The arithmetic behind it is one tap away and folded by default:
              nobody needs to re-read the math every single time. */}
          {left && (
            <>
              <div className="pad-x"><div className="card list-card-ruled money-hero" {...pressable(() => setMathOpen(!mathOpen))}>
                <div className="money-hero-label">{nextPay ? "Yours Until " + monthDay(nextPay) : "Yours"}</div>
                <div className="money-hero-total">{formatMoney(Math.max(0, left.amount))}</div>
                {/* Under the total: the shortfall, or what the total is
                    after, or (with no bills or set-aside) the per-day line.
                    The per-day amount is worked out, so it wears sky here
                    exactly as it does inside the math below (§AM). The
                    shortfall is over the limit, which the key says in red,
                    the same red the late chip on a bill already wears. */}
                {left.amount < 0
                  ? <div className="money-hero-label"><span className="fact red">{lineCase(shortLine(left))}</span></div>
                  : leftSub(left)
                    ? <div className="money-hero-label">{lineCase(leftSub(left)!)}</div>
                    : perDayLine(left, daysLeft) && <div className="money-hero-label"><span className="fact est">{lineCase(perDayLine(left, daysLeft)!)}</span></div>}
                {mathOpen && (
                  <div className="budget-math">
                    <div className="budget-row"><span>Paycheck</span><span>{formatMoney(left.paycheck)}</span></div>
                    {left.billsOut > 0 && (
                      <div className="budget-row"><span>Bills Before {monthDay(nextPay!)}</span><span>-{formatMoney(left.billsOut)}</span></div>
                    )}
                    {left.setAside > 0 && (
                      <div className="budget-row"><span>Set Aside</span><span>-{formatMoney(left.setAside)}</span></div>
                    )}
                    <div className="budget-row budget-total"><span>Yours</span><span>{formatMoney(left.amount)}</span></div>
                    {/* With no bills or set-aside, the line under the total
                        already IS the per-day line: say it once. Shown, it
                        is an amount the app worked out, so it wears sky. */}
                    {leftSub(left) && perDayLine(left, daysLeft) && (
                      <div className="money-hero-label"><span className="fact est">{lineCase(perDayLine(left, daysLeft)!)}</span></div>
                    )}
                  </div>
                )}
              </div></div>

              {/* SET MONEY ASIDE IS THE HEAD'S CAPSULE (Dave 2026-10-05, locked: a section-level action lives in the head,
                  never in a card). With nothing set aside the section is its head and the capsule, no empty plate (rule
                  12); a set-aside row is clean, its tap the sheet, its swipe Remove. */}
              <div className="sh2 sh2-quiet"><span className="t">Set Aside</span>{envelopes.length > 0 && <span className="n">{envelopes.length}</span>}
                <button className="see-all pill-action" onClick={() => setEnvSheet({ kind: "new" })}>Set Money Aside</button></div>
              {envelopes.length > 0 && (
                <div className="pad-x"><div className="card list-card-ruled">
                  {envelopes.map((e) => (
                    <MoneyRow key={e.id} name={titleCase(e.name)} onDelete={() => void removeEnvelope(e)} deleteLabel="Remove"
                      menu={[{ label: "Edit", onPick: () => setEnvSheet({ kind: "edit", id: e.id }) }, { label: "Remove", destructive: true, onPick: () => void removeEnvelope(e) }]}
                      onOpen={() => setEnvSheet({ kind: "edit", id: e.id })}>
                      <div className="task-title"><span className="task-name">{titleCase(e.name)}</span></div>
                      <span className="money-amt">{formatMoney(e.amount)}</span>
                    </MoneyRow>
                  ))}
                </div></div>
              )}
              {envelopes.length === 0 && (
                <div className="pad-x"><div className="facts">
                  <span className="fact">Reserved</span><span className="fact">Not Spendable</span><span className="fact">A Plan</span>
                </div></div>
              )}
            </>
          )}

          {/* THE BALANCE AND ITS PARTS, ONE CARD (the recommended shape): the
              total big, then the accounts it is made of as rows under it. */}
          {MONEY_TOP === "hero-accts" && (
            <div className="sh2 sh2-quiet"><span className="t">Accounts</span>{accounts.length > 0 && <span className="n">{accounts.length}</span>}{addAccountCapsule}</div>
          )}
          {MONEY_TOP === "hero-accts" && accounts.length > 0 && (
            <div className="pad-x"><div className="card list-card-ruled money-hero-card">
              <div className="money-hero">
                <div className="money-hero-label">Total Balance</div>
                <div className="money-hero-total">{formatMoney(totalBalance(accounts))}</div>
                {/* Self-reported and it says so: the app has no live feed.
                    The accounts are the rows right under it, so it does not
                    count them as well. */}
                {balanceFacts}
              </div>
              {accounts.map(accountRow)}
            </div></div>
          )}
          {MONEY_TOP === "bills-lead" && accounts.length > 0 && (
            <div className="money-line"><b>{formatMoney(totalBalance(accounts))}</b> across {accounts.length} {accounts.length === 1 ? "account" : "accounts"}, as you last entered it{balanceAsOf && <> <span className="fact date">{monthDay(balanceAsOf)}</span></>}</div>
          )}
          {MONEY_TOP === "before" && accounts.length > 0 && (
            <div className="pad-x"><div className="card list-card-ruled money-hero">
              <div className="money-hero-label">Total Balance</div>
              <div className="money-hero-total">{formatMoney(totalBalance(accounts))}</div>
              {balanceFacts}
            </div></div>
          )}

          {trackerRow}

          <MatchesCard />

          {/* ADD BILL IS THE HEAD'S CAPSULE, and a Bills section with nothing in it is its head and the capsule, no empty
              plate (Dave 2026-10-05, rule 12). */}
          <div className="sh2 sh2-quiet"><span className="t">Bills</span>{entries.length > 0 && <span className="n">{entries.length}</span>}
            <button className="see-all pill-action" onClick={() => setBillSheet({ kind: "new" })}>Add Bill</button></div>
          {hasBillRows && <div className="pad-x"><div className="card list-card-ruled">{billRows}</div></div>}
          {suggestion && (
            // A QUIET OFFER, NEVER A SCHEDULE (the ledger's rule): the pattern the bills already show, and two answers.
            // Nothing is scheduled until Yes. It is a row, so it carries no pill (Dave 2026-10-05, locked): the tap asks
            // (Make It Monthly, Not Now, or open the bill whose history is the evidence), the swipe is Not Now.
            // THE QUESTION IS THE ROW'S NAME (2026-10-05, the visual catalog gate, R1 and R5, and the facts-never-clip
            // ruling): it is the only thing that says what Yes means. The bill and its amount are a white fact (a name
            // and a number with no state) and the count is the row's one grey.
            <div className="pad-x"><div className="card list-card-ruled">
              <MoneyRow name="Make It Monthly" menuTitle="Make It Monthly?"
                verb={{ label: "Not Now", icon: <Clock className="ic" />, run: notNowSuggestion }}
                menu={[]}
                onOpen={() => setOfferOpen(true)}>
                <div className="task-title">
                  <span className="task-name">Make It Monthly?</span>
                  <div className="r-k"><div className="facts">
                    <span className="fact"><b>{titleCase(suggestion.vendor) + ", " + billAmount({ amountCents: suggestion.amountCents, currency: suggestionCurrency })}</b></span>
                    <span className="fact">{lineCase(`${suggestion.count} months in a row`)}</span>
                  </div></div>
                </div>
              </MoneyRow>
            </div></div>
          )}

          {/* UP-CORE-13 (2026-09-05): PAID THIS MONTH. Money could say what
              is owed and never what has gone out, so the receipts a person
              files added up to nothing. It counts the paid bills in the app
              and claims nothing more: not a balance, not a budget, and not a
              statement about the account. Absent on a month with none, which
              is a fact rather than a zero. */}
          {paidMonth.count > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Paid This Month</span><span className="n">{paidMonth.count}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {/* A paid amount is green (the lead, 2026-09-26: "A paid
                    amount is --good"), the same green the paid bill's amount
                    above it already wears. The count stays the one grey. */}
                <div className="row">
                  <div className="row-grow"><span className="money-amt paid">{formatMoney(paidMonth.total)}</span></div>
                  <span className="conn-meta">{lineCase(`${paidMonth.count} ${paidMonth.count === 1 ? "bill" : "bills"} in the app`)}</span>
                </div>
              </div></div>
            </>
          )}

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
              <div className="sh2 sh2-quiet"><span className="t">Saving Toward</span><span className="n">{savingsGoals.length}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {savingsGoals.map((g) => {
                  // The row's one verb is Add (Dave 2026-09-15: "I want all rows clickable"; 2026-10-05: no pill on a
                  // row), so the tap, the swipe and the menu all open the amount sheet. A goal has nothing to complete
                  // here, so there is no right swipe.
                  const add = () => setSaveInto(g.id);
                  const title = titleCase(g.data.title);
                  return (
                    <MoneyRow key={g.id} name={title} className="goal-row-ruled"
                      verb={{ label: "Add", icon: PLUS, run: add }}
                      menu={[{ label: "Add Money", onPick: add }]}
                      onOpen={add}>
                      {/* Area color, brand red when unhomed -- the same
                          goalTone every goal glyph wears (2026-08-31). */}
                      <div className="task-check-tap"><span className={"gm-slot " + goalTone(g.data.tags)}><TargetGlyph /></span></div>
                      <div className="task-title">
                        {/* His own goal title is SHOWN in Title Case and stored
                            as typed (the whole casing rule, 2026-09-26). */}
                        <span className="task-name">{title}</span>
                        <div className="r-k"><span className="r-goal r-cat">{lineCase(savingsLine(g.data.moneyTarget!, g.data.saved))}</span></div>
                        {savedTotal(g.data.saved) > 0 && (
                          <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, savingsPct(g.data.moneyTarget!, g.data.saved)) + "%" }} /></div>
                        )}
                      </div>
                    </MoneyRow>
                  );
                })}
              </div></div>
            </>
          )}

          {tagged.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Also Tagged Money</span><span className="n">{tagged.length}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {/* These are TASKS, so they wear the task row (locked law: all
                    task lists look identical), check, swipe and all. */}
                {tagged.map((t) => (
                  <TaskRow
                    key={t.id}
                    item={t}
                    today={today}
                    onToggle={(id) => void (async () => {
                      if (!(await attemptWrite(() => tasksSvc.toggleDone(id)))) return;
                      await reload();
                    })()}
                    onOpen={onOpenTask}
                    onDelete={(id) => void deleteTagged(id)}
                  />
                ))}
              </div></div>
            </>
          )}

          {receiptsSection}

          {MONEY_TOP !== "hero-accts" && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Accounts</span><span className="n">{accounts.length}</span>{addAccountCapsule}</div>
              {accounts.length > 0 && <div className="pad-x"><div className="card list-card-ruled">{accounts.map(accountRow)}</div></div>}
            </>
          )}
          <div className="screen-foot" />
        </>
      )}
      {sheet.kind !== "closed" && (
        <AccountSheet mode={sheet.kind === "new" ? "new" : "edit"} initial={editing?.data} onSave={save}
          onDelete={sheet.kind === "edit" ? () => void removeAccount(sheet.id, editing?.data) : undefined}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {envSheet && (
        <EnvelopeSheet initial={envSheet.kind === "edit" ? envelopes.find((x) => x.id === envSheet.id) : undefined}
          onSave={async (name, amt) => {
            const next = envSheet.kind === "edit"
              ? envelopes.map((x) => (x.id === envSheet.id ? { ...x, name, amount: amt } : x))
              : [...envelopes, { id: envelopeId(), name, amount: amt }];
            const ok = await writeEnvelopes(next);
            if (ok) setEnvSheet(null);
            return ok;
          }}
          onRemove={envSheet.kind === "edit" ? () => {
            const e = envelopes.find((x) => x.id === envSheet.id);
            setEnvSheet(null);
            if (e) void removeEnvelope(e);
          } : undefined}
          onCancel={() => setEnvSheet(null)} />
      )}
      {(() => {
        const g = saveInto ? savingsGoals.find((x) => x.id === saveInto) : undefined;
        return g ? <SavingsSheet goal={g} onSave={(text) => addSavings(g, text)} onCancel={() => setSaveInto(null)} /> : null;
      })()}
      {offerOpen && suggestion && (
        <RowActionSheet title="Make It Monthly?"
          actions={[
            { label: "Make It Monthly", onPick: () => void acceptSuggestion(suggestion) },
            { label: "Not Now", onPick: notNowSuggestion },
            { label: "Open Bill", onPick: () => setDetailId(suggestion.billId) },
          ]}
          onCancel={() => setOfferOpen(false)} />
      )}
      {billSheet.kind !== "closed" && (
        <BillSheet mode={billSheet.kind === "new" ? "new" : billSheet.kind === "paid" ? "paid" : "edit"}
          paidOn={billSheet.kind === "paid" ? billSheet.paidOn : undefined}
          // 2026-09-11: "paid" carries the receipt's read-out in its own
          // initial; only reading editingBill opened From a Receipt empty.
          ledger={billSheet.kind !== "edit"}
          initial={billSheet.kind === "paid" ? billSheet.initial
            : editingLedger ? {
                text: editingLedger.data.vendor, due: editingLedger.data.dueDate ?? "", recurrence: editingLedger.data.recurrence ?? null,
                notes: editingLedger.data.notes ?? "", currency: editingLedger.data.currency,
                bill: {
                  amount: editingLedger.data.amountCents / 100,
                  ...(editingLedger.data.autopay ? { autopay: true } : {}),
                  ...(editingLedger.data.payUrl ? { payUrl: editingLedger.data.payUrl } : {}),
                },
              }
            : editingBill ? { text: editingBill.data.text, due: editingBill.data.due ?? "", recurrence: editingBill.data.recurrence ?? null, bill: editingBill.data.bill! } : undefined}
          onSave={saveBill}
          onMarkPaid={billSheet.kind === "edit" && editingBill && !editingBill.data.bill?.autopay && billSubline(editingBill, today).state !== "paid"
            ? () => { setBillSheet({ kind: "closed" }); void markPaid(editingBill); } : undefined}
          onDelete={billSheet.kind === "editLedger" ? async () => {
            // A ledger bill's Delete takes the sheet with it only once the
            // delete has landed, and Undo is restoreBill.
            if (editingLedger && (await deleteLedgerBill(editingLedger))) setBillSheet({ kind: "closed" });
          } : billSheet.kind === "edit" ? async () => {
            const gone = editingBill ? { ...editingBill.data } : null;
            const id = billSheet.id;
            // HMN-F-09: the sheet used to close before the write, so a failed
            // delete took the bill sheet away and left the bill. It closes
            // after, and only when the delete actually happened.
            if (!(await attemptWrite(() => tasksSvc.deleteTask(id)))) return;
            setBillSheet({ kind: "closed" });
            await reload();
            showToast({
              message: "Bill Deleted",
              actionLabel: "Undo",
              onAction: async () => {
                if (gone) await attemptWrite(() => tasksSvc.recreateFrom(gone));
                await reload();
              },
            });
          } : undefined}
          onCancel={() => setBillSheet({ kind: "closed" })} />
      )}
      {detailBill && (
        <BillDetailSheet bill={detailBill} today={today} onOpenEntity={onOpenEntity}
          onClose={() => setDetailId(null)}
          onEdit={() => setBillSheet({ kind: "editLedger", id: detailBill.id })}
          onMarkPaid={() => ledgerPay.request(detailBill)}
          onRemovePaid={() => void removePaidState(detailBill)}
          onDelete={() => void deleteLedgerBill(detailBill)} />
      )}
      {ledgerPay.sheet}
      {paydayOpen && (
        <PaydaySheet initial={payday}
          onSave={async (p) => {
            if (!(await attemptWrite(() => profileSvc.save({ payday: p })))) return false;
            setPaydayOpen(false); await reload();
            return true;
          }}
          onRemove={payday ? async () => {
            // B10: one scalar with its old value in hand; the cheapest undo
            // in the whole app, and it was missing.
            const kept = payday;
            if (!(await attemptWrite(() => profileSvc.save({ payday: undefined })))) return;
            setPaydayOpen(false);
            await reload();
            showToast({ message: "Payday Removed", actionLabel: "Undo", onAction: () => void (async () => {
              await attemptWrite(() => profileSvc.save({ payday: kept }));
              await reload();
            })() });
          } : undefined}
          onCancel={() => setPaydayOpen(false)} />
      )}
    </div>
  );
}
