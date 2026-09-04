import { useCallback, useEffect, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { useMoney, useTasks, useProfile, useCategories, useOptionalGoals, useOptionalFiles, useFileStore } from "../data/NotesProvider";
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
import { goalTone } from "../shared/categories";
import { RepeatGlyph, WalletGlyph, TargetGlyph, DollarGlyph } from "../shared/glyphs";
import { TaskRow } from "../tasks/screens/TasksPage";
import { daysBetween } from "../upnext/upnext";
import { attemptWrite } from "../shared/guard";
import { capAfterNumber } from "../shared/casing";
import type { Goal } from "../life/types";
import { savingsLine, savingsPct, savedTotal } from "../bigger/savings";
import { usePickFile } from "../shared/usePickFile";
import { sizeLabel, type UserFile } from "../files/types";
import { Paperclip, Image as ImageGlyph, FileText, Calendar, FolderKanban } from "../shared/icons";
import { FormSheet, Group, FieldRow, MenuRow, DeleteRow, ErrorLine } from "../shared/FormSheet";

const CHEV = <div className="chev" />;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const WALLET = <WalletGlyph />;
const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
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
  if (over > 0) return { cls: "u-late", text: capAfterNumber(over === 1 ? "1 day late" : `${over} days late`) };
  const gap = daysBetween(today, due);
  if (gap === 0) return { cls: "u-today", text: "Today" };
  if (gap === 1) return { cls: "u-today", text: "Tomorrow" };
  if (gap <= 6) return { cls: "u-today", text: `In ${gap} days` };
  return null;
}

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
  // Every save re-stamps asOf: the dated-balance line depends on it.
  // B12: Save creates an account, so two taps created two.
  const save = () => { if (!valid) { setTouched(true); return; } if (saving) return; setSaving(true); onSave({ name: name.trim(), balance: Number(balance), kind, asOf: todayISO() }); };
  // THE ACCOUNT SHEET ON THE SHEET BAR (2026-09-02): the name as the row,
  // the balance typed at the right, the type as a value that opens the
  // dropdown, Delete as the last group.
  return (
    <FormSheet title={mode === "new" ? "New Account" : "Edit Account"} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Account">
        <FieldRow tone="blue" glyph={<WalletGlyph />} value={name} onChange={setName} placeholder="e.g. Checking" ariaLabel="Account name"
          error={touched && !name.trim()} right={false} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Balance" value={balance} onChange={setBalance} placeholder="0" inputMode="numeric"
          ariaLabel="Balance in dollars" error={touched && !valid && !!name.trim()} />
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
  initial?: PaydayInfo; onSave: (p: PaydayInfo) => void; onRemove?: () => void; onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [next, setNext] = useState(initial?.next ?? "");
  const [freq, setFreq] = useState<PaydayFreq>(initial?.freq ?? "biweekly");
  const [touched, setTouched] = useState(false);
  const valid = amount.trim() !== "" && Number(amount) > 0 && !!next;
  const save = () => { if (!valid) { setTouched(true); return; } if (saving) return; setSaving(true); onSave({ amount: Number(amount), next, freq }); };
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

  // RECEIPTS (Dave 2026-09-02: "both pages need to have a pic/file upload
  // button (that's fully wired)"; picked "A Receipts card on the page").
  // The clip in the bar opens the phone's own sheet (camera, library,
  // files); the file goes to the user's private storage and lands in the
  // Receipts card, newest first: name, date, size. Tap opens it; the trash
  // removes it with Undo. The row is made first because the storage path
  // carries its id; a failed upload takes the row back with it.
  const filesSvc = useOptionalFiles();
  const fileStore = useFileStore();
  const [receipts, setReceipts] = useState<UserFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const loadReceipts = useCallback(async () => {
    if (!filesSvc) return;
    setReceipts(await filesSvc.list("money"));
  }, [filesSvc]);
  useEffect(() => { void loadReceipts(); }, [loadReceipts]);
  const addReceipt = async (f: File) => {
    if (!filesSvc || !fileStore || uploading) return;
    setUploading(true);
    let id: string | null = null;
    try {
      id = await filesSvc.create({ name: f.name, path: "", mime: f.type, bytes: f.size, scope: "money", addedAt: today });
      const stored = await fileStore.upload(id, f);
      await filesSvc.update(id, { path: stored.path, name: stored.name, mime: stored.mime, bytes: stored.bytes });
      await loadReceipts();
      showToast({ message: "Receipt added" });
    } catch (e) {
      if (id) await filesSvc.remove(id).catch(() => undefined);
      showToast({ message: e instanceof Error && e.message ? e.message : "Couldn't upload that file." });
    } finally {
      setUploading(false);
    }
  };
  const picker = usePickFile((f) => void addReceipt(f));
  // B3-10 (2026-09-04): opening a receipt used to await fileStore.url()
  // (a real network round trip for the signed URL) before calling
  // window.open. Any await between a tap and window.open breaks the user-
  // gesture chain iOS requires, so Safari silently treats it as a popup and
  // blocks it: no error, no file, nothing. NoteEditor's Attachment avoids
  // this by resolving each file's URL ahead of time (useFileUrl) so its own
  // open() is a synchronous handler; this resolves the whole receipts list
  // the same way, once, whenever it changes.
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let live = true;
    if (!fileStore || receipts.length === 0) { setReceiptUrls({}); return; }
    void Promise.all(receipts.map(async (r) => [r.id, await fileStore.url(r.data.path)] as const))
      .then((pairs) => { if (live) setReceiptUrls(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [fileStore, receipts]);
  const openReceipt = (r: UserFile) => {
    const url = receiptUrls[r.id];
    if (!url) { showToast({ message: "Couldn't open that file." }); return; }
    window.open(url, "_blank", "noopener");
  };
  const removeReceipt = async (r: UserFile) => {
    if (!filesSvc) return;
    const ok = await attemptWrite(() => filesSvc.remove(r.id));
    if (!ok) return;
    await loadReceipts();
    // The bytes go a beat after the row, so Undo can bring the row back
    // whole. Undo re-creates the row on the same path and cancels the sweep.
    let undone = false;
    const sweep = setTimeout(() => { if (!undone) void fileStore?.remove([r.data.path]); }, 6000);
    showToast({
      message: "Receipt removed", actionLabel: "Undo",
      onAction: async () => { undone = true; clearTimeout(sweep); await attemptWrite(() => filesSvc.create(r.data)); await loadReceipts(); },
    });
  };

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
        message: "Task deleted",
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(() => tasksSvc.recreateFrom(t));
          await reload();
        },
      });
    }
  };

  // THE BILL ROW (ruled 2026-09-01: amount right, urgency chip; built with the
  // Notes and Money port 2026-09-02). The task row's own anatomy: the
  // rounded-square check (autopay wears the repeat glyph in that column,
  // because there is nothing to tick), the name, one grey line with the
  // chip and the date words, the amount in the trailing column. The caps
  // eyebrow that used to carry the date is gone with the rest of them.
  const billRows = (
    <>
      {anchor && (
        <div className="task-row p2" role="button" tabIndex={0} onClick={() => setPaydayOpen(true)}>
          <div className="task-title">
            <span className="task-name">{anchor.title}</span>
            <div className="r-k"><span className="r-goal r-cat">{anchor.sub}</span></div>
          </div>
          {CHEV}
        </div>
      )}
      {bills.map((b) => {
        const sub = billSubline(b, today);
        const info = b.data.bill!;
        const paid = sub.state === "paid";
        const chip = paid ? null : billChip(b, today);
        // The chip says how close; the words say when. "IN 2 DAYS" over
        // "Due in 2 days" said one thing twice (caught on the port).
        const subText = chip && b.data.due ? "Due " + monthDay(b.data.due) : sub.text;
        return (
          <div className="task-row p2" key={b.id}>
            {info.autopay ? (
              <div className="task-check-tap"><span className="gm-slot cat-fg-blue">{REPEAT}</span></div>
            ) : (
              <div className="task-check-tap" role="checkbox" aria-checked={paid} aria-label={paid ? "Paid" : "Mark paid"}
                onClick={(e) => { e.stopPropagation(); void markPaid(b); }}>
                <div className={"task-check" + (paid ? " done" : "")} />
              </div>
            )}
            <div className="task-title" role="button" tabIndex={0} onClick={() => setBillSheet({ kind: "edit", id: b.id })}>
              <span className="task-name">{b.data.text}</span>
              <div className="r-k">
                {chip && <span className={"uchip " + chip.cls}>{chip.text}</span>}
                {/* The words are the money laws' own (bills.ts) and stay. */}
                <span className="r-goal r-cat">{subText}</span>
              </div>
            </div>
            <span className={"money-amt" + (paid ? " paid" : "")}>{formatMoney(info.amount)}</span>
            {!info.autopay && !paid && info.payUrl && (
              <a className="bill-pay" href={info.payUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Pay</a>
            )}
          </div>
        );
      })}
      {isPersonal && !payday && bills.length > 0 && (
        <div className="task-row p2" role="button" tabIndex={0} onClick={() => setPaydayOpen(true)}>
          <div className="task-title"><span className="task-name">Set Up Payday</span></div>
          {CHEV}
        </div>
      )}
      <button className="row row-act" onClick={() => setBillSheet({ kind: "new" })}>Add Bill</button>
    </>
  );

  // A bare account row, shared by the balance card and the Accounts card.
  const accountRow = (a: Account) => {
    const m = ACCOUNT_META[a.data.kind];
    return (
      <div className="task-row p2" role="button" tabIndex={0} key={a.id} onClick={() => setSheet({ kind: "edit", id: a.id })}>
        <div className="task-title">
          <span className="task-name">{a.data.name}</span>
          <div className="r-k"><span className="r-goal r-cat">{m.label}</span></div>
        </div>
        {/* A negative balance is a fact, not an alarm: it reads in the
            quiet ink with its sign, never in red (L1, red is a verb). */}
        <span className={"money-amt" + (a.data.balance < 0 ? " money-neg" : "")}>{formatMoney(a.data.balance)}</span>
      </div>
    );
  };

  // THE TOP OF MONEY (Notes and Money catalog, 2026-09-02). Which shape
  // leads the page is the catalog's third pick; the constant is the switch.
  //   "hero-accts": the balance card holds its accounts (recommended)
  //   "bills-lead": bills first, the balance as one line under the title
  //   "before":     the old order on the ruled cards, accounts last
  const MONEY_TOP = "hero-accts" as "hero-accts" | "bills-lead" | "before";
  const balanceLine = `As you last entered it${balanceAsOf ? ` \u00b7 ${monthDay(balanceAsOf)}` : ""}`;

  return (
    <div className="screen ruled">
      <PageHeader title="Money" actions={<>
        {filesSvc && fileStore && <BarAction label={uploading ? "Uploading" : "Add a Receipt"} onClick={() => !uploading && picker.open()}><Paperclip className="ic" /></BarAction>}
        <BarAction label="Add Account" onClick={() => setSheet({ kind: "new" })}>{PLUS}</BarAction>
      </>} />
      {picker.input}
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
              <div className="pad-x"><div className="card list-card-ruled money-hero" role="button" tabIndex={0} onClick={() => setMathOpen(!mathOpen)}>
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

              <div className="sh2 sh2-quiet"><span className="t">Set Aside</span>{envelopes.length > 0 && <span className="n">{envelopes.length}</span>}</div>
              <div className="pad-x"><div className="card list-card-ruled">
                {envelopes.map((e) => (
                  <div className="task-row p2" key={e.id}>
                    <div className="task-title"><span className="task-name">{e.name}</span></div>
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
              </div></div>
              {envelopes.length === 0 && (
                <div className="pad-x"><div className="input-help">
                  Reserved · Not spendable · A plan
                </div></div>
              )}
            </>
          )}

          {/* THE BALANCE AND ITS PARTS, ONE CARD (the recommended shape): the
              total big, then the accounts it is made of as rows under it. */}
          {MONEY_TOP === "hero-accts" && accounts.length > 0 && (
            <div className="pad-x"><div className="card list-card-ruled money-hero-card">
              <div className="money-hero">
                <div className="money-hero-label">Total balance</div>
                <div className="money-hero-total">{formatMoney(totalBalance(accounts))}</div>
                {/* Self-reported and it says so: the app has no live feed. */}
                <div className="money-hero-label">{balanceLine} · {accounts.length} {accounts.length === 1 ? "account" : "accounts"}</div>
              </div>
              {accounts.map(accountRow)}
              <button className="row row-act" onClick={() => setSheet({ kind: "new" })}>Add Account</button>
            </div></div>
          )}
          {MONEY_TOP === "bills-lead" && accounts.length > 0 && (
            <div className="money-line"><b>{formatMoney(totalBalance(accounts))}</b> across {accounts.length} {accounts.length === 1 ? "account" : "accounts"} · {balanceLine.charAt(0).toLowerCase() + balanceLine.slice(1)}</div>
          )}
          {MONEY_TOP === "before" && accounts.length > 0 && (
            <div className="pad-x"><div className="card list-card-ruled money-hero">
              <div className="money-hero-label">Total balance</div>
              <div className="money-hero-total">{formatMoney(totalBalance(accounts))}</div>
              <div className="money-hero-label">{balanceLine}</div>
            </div></div>
          )}

          <div className="sh2 sh2-quiet"><span className="t">Bills</span>{bills.length > 0 && <span className="n">{bills.length}</span>}</div>
          <div className="pad-x"><div className="card list-card-ruled">{billRows}</div></div>

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
                {savingsGoals.map((g) => (
                  <div className="task-row p2 goal-row-ruled" key={g.id}>
                    {/* Area color, brand red when unhomed -- the same
                        goalTone every goal glyph wears (2026-08-31). */}
                    <div className="task-check-tap"><span className={"gm-slot " + goalTone(g.data.tags)}><TargetGlyph /></span></div>
                    <div className="task-title">
                      <span className="task-name">{g.data.title}</span>
                      <div className="r-k"><span className="r-goal r-cat">{savingsLine(g.data.moneyTarget!, g.data.saved)}</span></div>
                      {savedTotal(g.data.saved) > 0 && (
                        <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, savingsPct(g.data.moneyTarget!, g.data.saved)) + "%" }} /></div>
                      )}
                    </div>
                    {saveInto === g.id ? (
                      <div className="budget-add">
                        <input className="input budget-amt" inputMode="numeric" placeholder="0" value={saveAmt}
                          onChange={(ev) => setSaveAmt(ev.target.value)} />
                        <button className="btn btn-primary btn-sm" onClick={() => void addSavings(g)}>Add</button>
                      </div>
                    ) : (
                      <button className="pill-act" onClick={() => { setSaveInto(g.id); setSaveAmt(""); }}>Add</button>
                    )}
                  </div>
                ))}
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
                    onToggle={(id) => void (async () => { await tasksSvc.toggleDone(id); await reload(); })()}
                    onOpen={onOpenTask}
                    onDelete={(id) => void deleteTagged(id)}
                  />
                ))}
              </div></div>
            </>
          )}

          {receipts.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Receipts</span><span className="n">{receipts.length}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {receipts.map((r) => (
                  <div className="task-row p2 file-row" role="button" tabIndex={0} key={r.id} onClick={() => openReceipt(r)}>
                    {/* The type is the glyph's colour: a picture in blue, a
                        document in the brand red, the editor's own pairing. */}
                    <div className="task-check-tap"><span className={"gm-slot " + (r.data.mime.startsWith("image/") ? "cat-fg-blue" : "cat-fg-brand")}>
                      {r.data.mime.startsWith("image/") ? <ImageGlyph className="ic" /> : <FileText className="ic" />}
                    </span></div>
                    <div className="task-title">
                      <span className="task-name">{r.data.name}</span>
                      <div className="r-k"><span className="r-goal r-cat">{monthDay(r.data.addedAt)}{r.data.bytes > 0 ? ` \u00b7 ${sizeLabel(r.data.bytes)}` : ""}</span></div>
                    </div>
                    <button className="conn-remove" aria-label={"Remove " + r.data.name}
                      onClick={(e) => { e.stopPropagation(); void removeReceipt(r); }}>{TRASH}</button>
                  </div>
                ))}
              </div></div>
            </>
          )}

          {MONEY_TOP !== "hero-accts" && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Accounts</span><span className="n">{accounts.length}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {accounts.map(accountRow)}
                <button className="row row-act" onClick={() => setSheet({ kind: "new" })}>Add Account</button>
              </div></div>
            </>
          )}
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
