import React, { useCallback, useEffect, useRef, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { useMoney, useTasks, useProfile, useCategories, useOptionalGoals, useOptionalFiles, useFileStore, useTracker, useOptionalLedger } from "../data/NotesProvider";
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
import { billAmount, ledgerBillsOut, ledgerChip, ledgerLine, ledgerPaidThisMonth, mergedBills } from "./billView";
import { suggestMonthly } from "./ledger/recurring";
import { isPaid } from "./ledger/status";
import { ENTITY_MONEY_BILL, type Bill, type BillRecurrence } from "./ledger/types";
import { dismissSuggestion, isSuggestionDismissed, suggestionKey } from "./suggestionMemory";
import TrackerScreen from "./screens/TrackerScreen";
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
import { usePickFile } from "../shared/usePickFile";
import RowActionSheet from "../shared/RowActionSheet";
import { sizeLabel, fileStem, type UserFile } from "../files/types";
import { useAI } from "../ai/useAI";
import { buildVisionMessage } from "../ai/AIService";
import { JARVIS_VOICE } from "../ai/voice";
import { encodeImageForVision } from "../shared/imageEncode";
import { madeBy } from "../shared/provenance";
import { RECEIPT_EXTRACT_PROMPT, parseReceiptExtract } from "./receiptExtract";
import { Paperclip, Image as ImageGlyph, FileText, Calendar, FolderKanban, Check as CheckGlyph, Trash2 } from "../shared/icons";
import { useSwipe } from "../shared/useSwipe";
import { FormSheet, Group, FieldRow, MenuRow, DeleteRow, ErrorLine } from "../shared/FormSheet";
import { pressable, onPressKey } from "../shared/pressable";

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
  if (over > 0) return { cls: "u-late", text: lineCase(over === 1 ? "1 day late" : `${over} days late`) };
  const gap = daysBetween(today, due);
  if (gap === 0) return { cls: "u-today", text: "Today" };
  if (gap === 1) return { cls: "u-today", text: "Tomorrow" };
  if (gap <= 6) return { cls: "u-today", text: `In ${gap} Days` };
  return null;
}

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

// The amounts in a quiet money line step up to white (§AM F1: a number with
// no state inside a grey line is a white <b>); the words keep the line's one
// grey. The dollar sign goes with its number, so the split is on the amount.
function Amounts({ text }: { text: string }) {
  return <>{text.split(/(\$\d{1,3}(?:,\d{3})*(?:\.\d+)?)/).map((s, i) => (i % 2 === 1 ? <b key={i}>{s}</b> : s))}</>;
}

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
// UP-CORE-15 (2026-09-05): SWIPE RIGHT MARKS IT PAID. The same gesture the
// task rows answer to, on the row that most deserves a whole-row target.
// Autopay is exempt by the money law: the app cannot know a payment cleared,
// so there is nothing here for a gesture to claim. A bill already paid has
// nothing to mark.
function BillRow({ paid, autopay, label, onPay, onDelete, children }: {
  paid: boolean;
  autopay: boolean;
  /** The bill's name, for the delete button's accessible name. */
  label: string;
  onPay: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  const completable = !paid && !autopay;
  // DELETE IS ON THE SWIPE (Dave 2026-09-20: "should be able to delete
  // always"). This row had revealW 0 and a right-swipe only, so the single
  // gesture it answered to was Paid: getting rid of a bill meant opening its
  // sheet, and a bill added by mistake had no quick way out at all. Left is
  // the app's delete side on every other list; this row was the odd one.
  const swipe = useSwipe({ revealW: onDelete ? 88 : 0, rightW: completable ? 88 : 0, ...(completable ? { onRightCommit: onPay } : {}) });
  return (
    <div className="task-swipe">
      {completable && (
        <div className="task-done-rail" aria-hidden="true">
          <CheckGlyph className="ic" />
          <span className="swipe-label">Paid</span>
        </div>
      )}
      {onDelete && (
        <button className="task-del" onClick={() => swipe.closeThen(onDelete)} aria-label={"Delete " + label}>
          <Trash2 className="ic" />
          <span className="swipe-label">Delete</span>
        </button>
      )}
      <div
        className={"task-row p2" + (swipe.dragging ? " swiping" : "")}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        {...swipe.handlers}
      >
        {children}
      </div>
    </div>
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
    if (!isFinite(amt) || amt <= 0) { showToast({ message: "Needs an Amount Over Zero" }); return; }
    if (!goalsSvc) return;
    const d = todayISO();
    // HMN-F-09: the receipt below is a claim that the money landed, so it
    // fires only after the write resolved.
    if (!(await attemptWrite(() => goalsSvc.update(g.id, { saved: [...(g.data.saved ?? []), { d, amount: amt }] })))) return;
    setSaveInto(null); setSaveAmt("");
    await loadGoals();
    showToast({ message: formatMoney(amt) + " toward " + g.data.title });
  };
  const [envName, setEnvName] = useState("");
  const [envAmt, setEnvAmt] = useState("");
  // THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows
  // clickable"). A set-aside row opens itself in the adder it was made in,
  // filled, and Save replaces it in place. Remove stays button-only.
  const [envEditing, setEnvEditing] = useState<string | null>(null);
  const envNameRef = useRef<HTMLInputElement>(null);
  const editEnvelope = (e: Envelope) => { setEnvEditing(e.id); setEnvName(e.name); setEnvAmt(String(e.amount)); setEnvOpen(true); };
  // Keys answer the row itself only, so Enter on an inner button stays its own.
  const rowKey = (fn: () => void) => (ev: React.KeyboardEvent) => { if (ev.target === ev.currentTarget) onPressKey(fn)(ev); };
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

  // RECEIPTS (Dave 2026-09-02: "both pages need to have a pic/file upload
  // button (that's fully wired)"; picked "A Receipts card on the page").
  // The clip in the bar opens the phone's own sheet (camera, library,
  // files); the file goes to the user's private storage and lands in the
  // Receipts card, newest first: name, date, size. Tap opens it; the trash
  // removes it with Undo. The row is made first because the storage path
  // carries its id; a failed upload takes the row back with it.
  const ai = useAI();
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
      showToast({ message: "Receipt Added" });
    } catch (e) {
      if (id) await filesSvc.remove(id).catch(() => undefined);
      showToast({ message: e instanceof Error && e.message ? e.message : "Couldn't upload that file." });
    } finally {
      setUploading(false);
    }
  };
  const picker = usePickFile((f) => void addReceipt(f));
  // CLICK-THROUGH AUDIT 2026-09-29: the paperclip opened the phone's own file
  // sheet the instant it was tapped, which a driver (or a slow WebView) cannot
  // see, so it read as a dead button. The tap now opens a sheet of our own, and
  // its one row opens the picker inside THAT tap (a picker opened after an
  // await is blocked by iOS). The input stays mounted on the screen, so the
  // sheet closing never takes the picker with it.
  const [receiptSheet, setReceiptSheet] = useState(false);
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
    if (!url) { showToast({ message: "Couldn't Open That File \u00b7 Try Again in a Moment" }); return; }
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
      message: "Receipt Removed", actionLabel: "Undo",
      onAction: async () => { undone = true; clearTimeout(sweep); await attemptWrite(() => filesSvc.create(r.data)); await loadReceipts(); },
    });
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // UP-CORE-13 (2026-09-05): READ IT. The Privacy Policy already promises
  // this ("documents you upload for extraction are processed to create the
  // records you review"), and a receipt has been a picture and nothing else
  // since the clip shipped. One vision call, then the same review every
  // other extractor in this app insists on: the bill sheet opens prefilled
  // and Save is still a tap.
  const [reading, setReading] = useState<string | null>(null);
  const readReceipt = async (r: UserFile) => {
    const url = receiptUrls[r.id];
    if (!ai.available || !url || reading) return;
    setReading(r.id);
    try {
      // The same signed URL the row already resolved for opening it, fetched
      // back as bytes so the vision encoder can do its downscale and its
      // budget check (shared/imageEncode).
      const blob = await (await fetch(url)).blob();
      const img = await encodeImageForVision(new File([blob], r.data.name, { type: r.data.mime || blob.type }));
      const out = await ai.complete(
        [buildVisionMessage(RECEIPT_EXTRACT_PROMPT, img.data, img.mediaType)],
        JARVIS_VOICE,
        { kind: "receipt", pin: "pasteFallback" },
      );
      const read = parseReceiptExtract(out);
      if (!read) { showToast({ message: "Couldn't Read That \u00b7 Try a Clearer Photo" }); return; }
      setBillSheet({
        kind: "paid",
        // The date it was paid: the receipt's own, or the day the file was
        // added, which is a date he can check rather than one JARVIS made up.
        paidOn: read.date ?? r.data.addedAt,
        fileId: r.id,
        initial: {
          text: read.vendor || fileStem(r.data.name),
          due: read.date ?? r.data.addedAt,
          // A receipt is one purchase. Nothing here claims it repeats.
          recurrence: null,
          bill: { amount: read.total ?? 0 },
        },
      });
    } catch {
      showToast({ message: "Couldn't Read That Receipt \u00b7 Try Again" });
    } finally {
      setReading(null);
    }
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
        return (
          <BillRow key={b.id} paid={paid} autopay={!!info.autopay} label={b.data.text}
            onPay={() => void markPaid(b)} onDelete={() => void deleteBill(b)}>
            {info.autopay ? (
              <div className="task-check-tap"><span className="gm-slot cat-fg-blue">{REPEAT}</span></div>
            ) : (
              <div className="task-check-tap" role="checkbox" aria-checked={paid} aria-label={paid ? "Paid" : "Mark paid"}
                onClick={(e) => { e.stopPropagation(); void markPaid(b); }}>
                <div className={"task-check" + (paid ? " done" : "")} />
              </div>
            )}
            <div className="task-title" {...pressable(() => setBillSheet({ kind: "edit", id: b.id }))}>
              <span className="task-name">{b.data.text}</span>
              {(chip || line) && (
                <div className="r-k">
                  {chip && <span className={"uchip " + chip.cls}>{chip.text}</span>}
                  {/* The words are the money laws' own (bills.ts) and stay. */}
                  {line}
                </div>
              )}
            </div>
            <span className={"money-amt" + (paid ? " paid" : "")}>{formatMoney(info.amount)}</span>
            {!info.autopay && !paid && info.payUrl && (
              <a className="bill-pay" href={info.payUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Pay</a>
            )}
          </BillRow>
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
        ? <span className="r-goal r-cat">{line.text}</span>
        : line.state === "autopay"
          ? <><span className="r-goal r-cat">{line.text}</span>{line.when && <span className="fact date">{line.when}</span>}</>
          : line.state === "due"
            ? <span className="fact date">{chip && d.dueDate ? monthDay(d.dueDate) : line.text}</span>
            : null;
    return (
      <BillRow key={bill.id} paid={paid} autopay={!!d.autopay} label={d.vendor}
        onPay={() => ledgerPay.request(bill)} onDelete={() => void deleteLedgerBill(bill)}>
        {d.autopay ? (
          <div className="task-check-tap"><span className="gm-slot cat-fg-blue">{REPEAT}</span></div>
        ) : (
          <div className="task-check-tap" role="checkbox" aria-checked={paid} aria-label={paid ? "Paid" : "Mark paid"}
            onClick={(e) => { e.stopPropagation(); if (paid) setDetailId(bill.id); else ledgerPay.request(bill); }}>
            <div className={"task-check" + (paid ? " done" : "")} />
          </div>
        )}
        <div className="task-title" {...pressable(() => setDetailId(bill.id))}>
          <span className="task-name">{d.vendor}</span>
          {(chip || lineEl) && (
            <div className="r-k">
              {chip && <span className={"uchip " + chip.cls}>{chip.text}</span>}
              {lineEl}
            </div>
          )}
        </div>
        <span className={"money-amt" + (paid ? " paid" : "")}>{billAmount(d)}</span>
        {!d.autopay && !paid && d.payUrl && (
          <a className="bill-pay" href={d.payUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Pay</a>
        )}
      </BillRow>
    );
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
      <button className="row row-act" onClick={() => setBillSheet({ kind: "new" })}>Add Bill</button>
    </>
  );

  // A bare account row, shared by the balance card and the Accounts card.
  const accountRow = (a: Account) => {
    const m = ACCOUNT_META[a.data.kind];
    return (
      <div className="task-row p2" {...pressable(() => setSheet({ kind: "edit", id: a.id }))} key={a.id}>
        <div className="task-title">
          <span className="task-name">{a.data.name}</span>
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
      </div>
    );
  };

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
      <PageHeader title="Money" actions={<>
        {filesSvc && fileStore && <BarAction label={uploading ? "Uploading" : "Add a Receipt"} onClick={() => !uploading && setReceiptSheet(true)}><Paperclip className="ic" /></BarAction>}
        <BarAction label="Add Account" onClick={() => setSheet({ kind: "new" })}>{PLUS}</BarAction>
      </>} />
      {picker.input}
      {receiptSheet && (
        <RowActionSheet
          title="Add a Receipt"
          actions={[{ label: "Take a Photo or Choose a File", onPick: () => picker.open() }]}
          onCancel={() => setReceiptSheet(false)}
        />
      )}
      {accounts.length === 0 && entries.length === 0 && tagged.length === 0 ? (
        <>
        <div className="empty-state"><div className="empty-icon">{WALLET}</div><div className="empty-title">No Accounts Yet</div>
          <button className="btn btn-primary" onClick={() => setSheet({ kind: "new" })}>Add an Account</button>
          <button className="btn btn-secondary" onClick={() => setBillSheet({ kind: "new" })}>Add a Bill</button></div>
          {trackerRow}
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

              <div className="sh2 sh2-quiet"><span className="t">Set Aside</span>{envelopes.length > 0 && <span className="n">{envelopes.length}</span>}</div>
              <div className="pad-x"><div className="card list-card-ruled">
                {envelopes.map((e) => (
                  <div className="task-row p2" key={e.id} role="button" tabIndex={0} aria-label={"Edit " + e.name}
                    onClick={() => editEnvelope(e)} onKeyDown={rowKey(() => editEnvelope(e))}>
                    <div className="task-title"><span className="task-name">{e.name}</span></div>
                    <span className="money-amt">{formatMoney(e.amount)}</span>
                    <button className="conn-remove" aria-label={"Remove " + e.name}
                      onClick={(ev) => { ev.stopPropagation(); void removeEnvelope(e); }}>{TRASH}</button>
                  </div>
                ))}
                {envOpen ? (
                  <div className="row" onClick={(ev) => { if (ev.target === ev.currentTarget) envNameRef.current?.focus(); }}>
                    <div className="row-grow budget-add">
                      <input ref={envNameRef} className="input" placeholder="What For" value={envName} onChange={(ev) => setEnvName(ev.target.value)} />
                      <input className="input budget-amt" inputMode="numeric" placeholder="0" value={envAmt}
                        onChange={(ev) => setEnvAmt(ev.target.value)} />
                      <button className="btn btn-primary btn-sm" onClick={() => {
                        const amt = Number(envAmt);
                        // Say WHY nothing happened (2026-08-09): this button
                        // used to eat the tap in silence on a blank name or
                        // zero amount, unlike every sheet in this module.
                        if (!envName.trim() || !isFinite(amt) || amt <= 0) {
                          showToast({ message: !envName.trim() ? "Needs a Name" : "Needs an Amount Over Zero" });
                          return;
                        }
                        void (async () => {
                          const next = envEditing
                            ? envelopes.map((x) => (x.id === envEditing ? { ...x, name: envName, amount: amt } : x))
                            : [...envelopes, { id: envelopeId(), name: envName, amount: amt }];
                          const ok = await writeEnvelopes(next);
                          if (ok) { setEnvName(""); setEnvAmt(""); setEnvOpen(false); setEnvEditing(null); }
                        })();
                      }}>{envEditing ? "Save" : "Add"}</button>
                    </div>
                  </div>
                ) : (
                  <button className="row row-act" onClick={() => { setEnvEditing(null); setEnvName(""); setEnvAmt(""); setEnvOpen(true); }}>Set Money Aside</button>
                )}
              </div></div>
              {envelopes.length === 0 && (
                <div className="pad-x"><div className="input-help">
                  Reserved · Not Spendable · A Plan
                </div></div>
              )}
            </>
          )}

          {/* THE BALANCE AND ITS PARTS, ONE CARD (the recommended shape): the
              total big, then the accounts it is made of as rows under it. */}
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
              <button className="row row-act" onClick={() => setSheet({ kind: "new" })}>Add Account</button>
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

          <div className="sh2 sh2-quiet"><span className="t">Bills</span>{entries.length > 0 && <span className="n">{entries.length}</span>}</div>
          <div className="pad-x"><div className="card list-card-ruled">{billRows}</div></div>
          {suggestion && (
            // A QUIET OFFER, NEVER A SCHEDULE (the ledger's rule): the pattern
            // the bills already show, and two answers. Nothing is scheduled
            // until Yes.
            <div className="pad-x"><div className="card list-card-ruled bill-suggest">
              {/* The row opens the latest bill (its history is the evidence for
                  the offer); Yes and Not Now are the two answers. */}
              <div className="task-row p2" {...pressable(() => setDetailId(suggestion.billId))}>
                <div className="task-title">
                  <span className="task-name">{suggestion.vendor + ", " + billAmount({ amountCents: suggestion.amountCents, currency: suggestionCurrency })}</span>
                  <div className="r-k"><div className="facts">
                    <span className="fact">{lineCase(`${suggestion.count} months in a row`)}</span>
                    <span className="fact">Make It Monthly?</span>
                  </div></div>
                </div>
                <button className="pill-act" onClick={(e) => { e.stopPropagation(); void acceptSuggestion(suggestion); }}>Yes</button>
                <button className="pill-act pill-quiet" onClick={(e) => { e.stopPropagation(); dismissSuggestion(suggestionKey(suggestion)); setSuggestTick((n) => n + 1); }}>Not Now</button>
              </div>
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
                {savingsGoals.map((g) => (
                  // The row's one verb is Add, so the row opens the amount
                  // (Dave 2026-09-15: "I want all rows clickable"); taps inside
                  // the open amount stay there.
                  <div className="task-row p2 goal-row-ruled" key={g.id} role="button" tabIndex={0} aria-label={"Add to " + titleCase(g.data.title)}
                    onClick={() => { if (saveInto !== g.id) { setSaveInto(g.id); setSaveAmt(""); } }}
                    onKeyDown={rowKey(() => { if (saveInto !== g.id) { setSaveInto(g.id); setSaveAmt(""); } })}>
                    {/* Area color, brand red when unhomed -- the same
                        goalTone every goal glyph wears (2026-08-31). */}
                    <div className="task-check-tap"><span className={"gm-slot " + goalTone(g.data.tags)}><TargetGlyph /></span></div>
                    <div className="task-title">
                      {/* His own goal title is SHOWN in Title Case and stored
                          as typed (the whole casing rule, 2026-09-26). */}
                      <span className="task-name">{titleCase(g.data.title)}</span>
                      <div className="r-k"><span className="r-goal r-cat">{lineCase(savingsLine(g.data.moneyTarget!, g.data.saved))}</span></div>
                      {savedTotal(g.data.saved) > 0 && (
                        <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, savingsPct(g.data.moneyTarget!, g.data.saved)) + "%" }} /></div>
                      )}
                    </div>
                    {saveInto === g.id ? (
                      <div className="budget-add" onClick={(ev) => ev.stopPropagation()}>
                        <input className="input budget-amt" inputMode="numeric" placeholder="0" value={saveAmt} autoFocus
                          onChange={(ev) => setSaveAmt(ev.target.value)} />
                        <button className="btn btn-primary btn-sm" onClick={() => void addSavings(g)}>Add</button>
                      </div>
                    ) : (
                      <button className="pill-act" onClick={(ev) => { ev.stopPropagation(); setSaveInto(g.id); setSaveAmt(""); }}>Add</button>
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

          {receipts.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Receipts</span><span className="n">{receipts.length}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {receipts.map((r) => (
                  <div className="task-row p2 file-row" {...pressable(() => openReceipt(r))} key={r.id}>
                    {/* The type is the glyph's colour: a picture in blue, a
                        document in the brand red, the editor's own pairing. */}
                    <div className="task-check-tap"><span className={"gm-slot " + (r.data.mime.startsWith("image/") ? "cat-fg-blue" : "cat-fg-brand")}>
                      {r.data.mime.startsWith("image/") ? <ImageGlyph className="ic" /> : <FileText className="ic" />}
                    </span></div>
                    <div className="task-title">
                      <span className="task-name">{r.data.name}</span>
                      {/* The day it came in is a date, small caps (§AM F5);
                          the size keeps the row's one grey, with no dot baked
                          between them (F3). */}
                      <div className="r-k"><span className="fact date">{monthDay(r.data.addedAt)}</span>{r.data.bytes > 0 && <span className="r-goal r-cat">{sizeLabel(r.data.bytes)}</span>}</div>
                    </div>
                    {/* UP-CORE-13 (2026-09-05): Read It, on a picture the
                        app can actually read. A PDF or a text file is left
                        alone rather than offered a button that fails. */}
                    {ai.available && r.data.mime.startsWith("image/") && (
                      <button className="pill-act" aria-label={"Read " + r.data.name}
                        onClick={(e) => { e.stopPropagation(); void readReceipt(r); }}>
                        {reading === r.id ? "Reading" : "Read It"}
                      </button>
                    )}
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
            // HMN-F-09: "Account deleted" is a claim, so it waits for the write.
            if (!(await attemptWrite(() => svc.remove(sheet.id)))) return;
            setSheet({ kind: "closed" });
            await reload();
            showToast({
              message: "Account Deleted",
              actionLabel: "Undo",
              onAction: async () => { if (gone) await attemptWrite(() => svc.create(gone)); await reload(); },
            });
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })} />
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
