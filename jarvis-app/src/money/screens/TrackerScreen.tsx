import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../../shared/PageHeader";
import { useOptionalLedger, useTracker } from "../../data/NotesProvider";
import { FormSheet, Group, FieldRow, MenuRow, SwitchRow, DeleteRow, ErrorLine, Row, tapField } from "../../shared/FormSheet";
import { Calendar, FolderKanban, Link2, Tag } from "../../shared/icons";
import { DollarGlyph, WalletGlyph, RepeatGlyph } from "../../shared/glyphs";
import { pressable } from "../../shared/pressable";
import { lineCase, titleCase } from "../../shared/casing";
import { showToast } from "../../shared/toast";
import { attemptWrite } from "../../shared/guard";
import {
  EMPTY_TRACKER, categoryColor, dollarsToCents, fmtCents, fmtDay, inMonth,
  incomeCents, knownCategories, monthLabel, monthlySubTotal, monthOf, shiftMonth,
  thisMonth, topMerchants,
  type SubFrequency, type TrackerAccount, type TrackerAccountData, type TrackerAccountType, type TrackerBudgetData, type TrackerData, type TrackerSub, type TrackerSubData, type TrackerTx, type TrackerTxData,
} from "../tracker";
import MatchesCard from "./MatchesCard";
import HistoryList from "./HistoryList";
import { LinkedFacts } from "../MoneyFacts";
import { categoryChoices, lastCategoryFor } from "../categoryDefault";
import { allocationsFromRows, discrepancyLines, displayRows, isUncategorized, monthActuals, monthSpend, newRow, rowsForNewMonth, rowsFromAllocations, type BudgetRow } from "../budgetView";
import { overLine } from "../ledger/actuals";
import { ENTITY_MONEY_BILL, ENTITY_MONEY_RECEIPT, type Bill, type Receipt } from "../ledger/types";
import { removeTxWithLinks, unmatchTx, type LinkChange } from "../txLinks";
import { useLedgerEvents } from "../useLedgerEvents";

// THE TRACKER (PASSOFF 2026-09-19, built by Alfred, integrated here).
//
// The Money page says what is left. This says where it went: four tabs over
// one month at a time, on records this screen owns outright.
//
// WHAT CHANGED FROM THE HANDOFF, AND WHY. The build arrived as standalone
// React with its own section headers, its own tab pills, its own modal and
// its own palette of hard-coded greys. Every one of those already exists in
// this app, so the port uses the app's:
//   - `.sh2.sh2-quiet` is the dotted-leader section head the handoff drew by
//     hand as `SectionHead`. Same shape, one implementation.
//   - `.segmented` is the app's tab row. The handoff specified dark pills
//     with the active one in red text, which is not a shape this app has;
//     the catalog owns this control and Life and Tasks already wear it.
//   - `FormSheet` is the app's editor. The handoff's own modal was never on
//     screen for approval, and a second sheet vocabulary on one page is the
//     thing the catalog exists to stop.
//   - Greys come from tokens, so the screen follows the theme. The CATEGORY
//     colours stay exactly as delivered: vibrant and saturated, his explicit
//     preference, and they are hues telling bars apart, never verdicts.
//
// RED STAYS A VERB (law L1). The handoff painted the month's Spent figure
// red. Spending money is not a failure and that number is red every day of
// the month, which is the exact permanent-red-status mechanic the law was
// written against. Spent reads in the ordinary ink; the reds here are the
// Colour Key's "over the limit" (§AM, the system red, never the brand red):
// a category actually over its limit, and a month that has spent more than
// came in. Each appears only once it happens.

type Tab = "dashboard" | "transactions" | "budgets" | "subs";
const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "transactions", label: "Transactions" },
  { key: "budgets", label: "Budgets" },
  { key: "subs", label: "Subscriptions" },
];

export default function TrackerScreen({ onBack }: { onBack: () => void }) {
  const svc = useTracker();
  const [data, setData] = useState<TrackerData>(EMPTY_TRACKER);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [month, setMonth] = useState(() => thisMonth());
  const [seeding, setSeeding] = useState(false);

  // The receipts and bills the ledger holds, read beside the tracker's own
  // rows: the budget counts a receipt linked to a payment once, and a payment
  // shows what it is matched to.
  const ledger = useOptionalLedger();
  const [recs, setRecs] = useState<{ receipts: Receipt[]; bills: Bill[] }>({ receipts: [], bills: [] });
  const reload = useCallback(async () => {
    const [d, receipts, bills] = await Promise.all([
      svc.load(),
      ledger ? ledger.listReceipts() : Promise.resolve([] as Receipt[]),
      ledger ? ledger.listBills() : Promise.resolve([] as Bill[]),
    ]);
    setData(d);
    setRecs({ receipts, bills });
    setLoaded(true);
  }, [svc, ledger]);
  useEffect(() => { void reload(); }, [reload]);
  useLedgerEvents([ENTITY_MONEY_RECEIPT, ENTITY_MONEY_BILL], reload);

  const monthTxs = useMemo(() => inMonth(data.txs, month), [data.txs, month]);

  // THE IMPORT SHOWS ITSELF ONCE. It is gone the moment a transaction
  // exists, so there is no second tap that doubles the ledger, and the
  // receipt counts the rows that actually landed.
  const canSeed = loaded && data.txs.length === 0;
  const runSeed = async () => {
    if (seeding) return;
    setSeeding(true);
    const wrote = await attemptWrite(() => svc.seedIfEmpty());
    setSeeding(false);
    if (!wrote) return;
    await reload();
    showToast({ message: "September Imported" });
  };

  return (
    <div className="screen ruled">
      <PageHeader title="Tracker" back="Money" onBack={onBack} />
      {canSeed && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row" {...pressable(() => void runSeed())}>
            <div className="row-grow">
              {/* .truncate is this app's two-lines-not-a-clip class (see the
                  task-name note in components.css). At --type-scale 1.4 this
                  title lost "Data" to the Import pill beside it; it is copy
                  this app wrote, so it takes the second line. */}
              <div className="conn-name truncate">Import September Data</div>
              <div className="conn-meta">Your Accounts, Subscriptions and 31 Transactions</div>
            </div>
            <button className="pill-act" disabled={seeding}
              onClick={(e) => { e.stopPropagation(); void runSeed(); }}>
              {seeding ? "Importing" : "Import"}
            </button>
          </div>
        </div></div>
      )}
      <div className="pad-x mt-tabrow">
        <div className="segmented" role="tablist" aria-label="Tracker">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === tab}
              className={"seg" + (t.key === tab ? " active" : "")}
              onClick={() => { if (t.key !== tab) setTab(t.key); }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "dashboard" && (
        <Dashboard month={month} onMonth={setMonth} txs={monthTxs} receipts={recs.receipts} data={data} onSaved={reload} />
      )}
      {tab === "transactions" && (
        <Transactions data={data} month={month} receipts={recs.receipts} bills={recs.bills} onSaved={reload} />
      )}
      {tab === "budgets" && (
        <Budgets month={month} onMonth={setMonth} data={data} receipts={recs.receipts} onSaved={reload} />
      )}
      {tab === "subs" && <Subscriptions data={data} onSaved={reload} />}
      <div className="screen-foot" />
    </div>
  );
}

/** The month this screen is reading, with a step either way. */
function MonthNav({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  return (
    <div className="pad-x mt-monthnav">
      {/* Quiet on purpose: stepping months is navigation, and a red pill
          either side of the month would read as the two loudest things on a
          screen whose content is the point. */}
      <button className="quiet-action" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}>Back</button>
      <div className="mt-monthname">{monthLabel(month)}</div>
      <button className="quiet-action" aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}>Next</button>
    </div>
  );
}

function SectionHead({ label, count }: { label: string; count?: number }) {
  return (
    <div className="sh2 sh2-quiet">
      <span className="t">{label}</span>
      {count !== undefined && <span className="n">{count}</span>}
    </div>
  );
}

/* -------------------------------- Dashboard ------------------------------- */

function Dashboard({ month, onMonth, txs, receipts, data, onSaved }: {
  month: string; onMonth: (m: string) => void; txs: TrackerTx[]; receipts: Receipt[]; data: TrackerData;
  onSaved: () => Promise<void>;
}) {
  const svc = useTracker();
  // ACCOUNTS COULD NOT BE MADE AT ALL (Dave 2026-09-20). saveAccount shipped
  // with the service and was wired to nothing, so the only accounts that
  // could ever exist were the four the September import writes. Anyone who
  // did not import had an account list they could look at and never fill.
  const [acct, setAcct] = useState<TrackerAccount | "new" | null>(null);
  const saveAcct = async (d: TrackerAccountData) => {
    const id = acct === "new" || !acct ? null : acct.id;
    if (!(await attemptWrite(() => svc.saveAccount(id, d)))) return;
    setAcct(null);
    await onSaved();
  };
  const removeAcct = async (a: TrackerAccount) => {
    if (!(await attemptWrite(() => svc.removeAccount(a.id)))) return;
    setAcct(null);
    await onSaved();
    showToast({
      message: "Account Deleted",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => svc.saveAccount(null, a.data)); await onSaved(); },
    });
  };
  // Out and the categories are the budget's own sum: payments plus standalone
  // receipts, a linked pair once (budgetView.monthSpend).
  const { spent, cats } = useMemo(() => monthSpend(month, data.txs, receipts), [month, data.txs, receipts]);
  const income = incomeCents(txs);
  const net = income - spent;
  const merchants = useMemo(() => topMerchants(txs), [txs]);
  const biggest = cats.length > 0 ? cats[0]![1] : 1;
  const budget = data.budgets.find((b) => b.data.month === month);

  return (
    <>
      <MonthNav month={month} onMonth={onMonth} />

      <SectionHead label="Accounts" count={data.accounts.length} />
      {data.accounts.length > 0 && (
        <div className="pad-x mt-accts">
          {data.accounts.map((a) => (
            // A card is a door to its own editor, the way a row is elsewhere.
            <div className="card mt-acct" key={a.id} {...pressable(() => setAcct(a))}>
              <div className="mt-acct-name">{a.data.name}</div>
              <div className="mt-acct-bal">{fmtCents(a.data.currentBalanceCents)}</div>
              {/* The amount inside the tile's one grey line steps up to
                  white (§AM F1), the words stay the grey. */}
              {a.data.type === "credit card" && (
                <div className="mt-acct-sub"><span className="fact">Available Credit <b>{fmtCents(a.data.availableBalanceCents)}</b></span></div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row" {...pressable(() => setAcct("new"))}>
          {/* No "No accounts yet" under it (§AK): the head's count already
              says none, and a row with nothing to say shows nothing. */}
          <div className="row-grow">
            <div className="conn-name">Add an Account</div>
          </div>
          <button className="pill-act" onClick={(e) => { e.stopPropagation(); setAcct("new"); }}>Add</button>
        </div>
      </div></div>
      {acct && (
        <AccountEditor
          initial={acct === "new" ? null : acct.data}
          onSave={saveAcct}
          onDelete={acct === "new" ? undefined : () => void removeAcct(acct)}
          onCancel={() => setAcct(null)}
        />
      )}

      <SectionHead label="This Month" />
      <div className="pad-x mt-sums">
        <div className="card mt-sum">
          <div className="mt-sum-label">In</div>
          {/* Green only once something came in (the lead, 2026-09-26): at
              $0.00 nothing is paid or in, so it is a number with no state,
              white (§AM). */}
          <div className={"mt-sum-value" + (income > 0 ? " good" : "")}>{fmtCents(income)}</div>
        </div>
        <div className="card mt-sum">
          <div className="mt-sum-label">Out</div>
          <div className="mt-sum-value">{fmtCents(spent)}</div>
        </div>
        <div className="card mt-sum">
          <div className="mt-sum-label">Net</div>
          {/* Spent more than came in is over the limit, the key's red
              (§AM), not amber, which means only near it. */}
          <div className={"mt-sum-value" + (net >= 0 ? " good" : " fact red")}>{fmtCents(net)}</div>
        </div>
      </div>
      {/* One statement in the line's one grey, its two amounts stepping up
          to white (§AM F1), with no dot baked between two facts (F2, F3). */}
      {budget && (
        <div className="pad-x mt-note">
          <span className="fact">Aiming to Save <b>{fmtCents(budget.data.savingsTargetCents)}</b> of an Expected <b>{fmtCents(budget.data.expectedIncomeCents)}</b></span>
        </div>
      )}

      {/* No "Nothing Spent This Month" under an empty head (2026-10-05, the
          visual catalog gate, R1: a placeholder that states nothing, which
          the head's own 0 already said). With nothing spent the section is
          not drawn, as Top Merchants below it is not. */}
      {cats.length > 0 && <SectionHead label="Spending by Category" count={cats.length} />}
      {cats.length > 0 && (
        <div className="pad-x">
          {cats.map(([name, cents], i) => (
            <div className="mt-cat" key={name}>
              <div className="mt-cat-head">
                <span className="mt-cat-name">
                  <i className="mt-dot" style={{ "--cat": categoryColor(name, i) } as React.CSSProperties} />
                  {lineCase(name)}
                </span>
                <span className="mt-cat-amt">{fmtCents(cents)}</span>
              </div>
              <div className="mt-bar">
                <div className="mt-bar-fill"
                  style={{ "--cat": categoryColor(name, i), width: Math.round((cents / biggest) * 100) + "%" } as React.CSSProperties} />
              </div>
            </div>
          ))}
        </div>
      )}

      {merchants.length > 0 && (
        <>
          <SectionHead label="Top Merchants" count={merchants.length} />
          <div className="pad-x"><div className="card list-card-ruled">
            {merchants.map(([name, cents]) => (
              <div className="row" key={name}>
                <div className="row-grow"><div className="conn-name">{titleCase(name)}</div></div>
                <div className="mt-amt">{fmtCents(cents)}</div>
              </div>
            ))}
          </div></div>
        </>
      )}
    </>
  );
}

/* ------------------------------ Transactions ------------------------------ */

type Editing = { kind: "new" } | { kind: "edit"; tx: TrackerTx } | null;

function Transactions({ data, month, receipts, bills, onSaved }: {
  data: TrackerData; month: string; receipts: Receipt[]; bills: Bill[]; onSaved: () => Promise<void>;
}) {
  const svc = useTracker();
  const ledger = useOptionalLedger();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [acct, setAcct] = useState("all");
  const [editing, setEditing] = useState<Editing>(null);

  const cats = useMemo(() => knownCategories(data.txs), [data.txs]);
  // What the sheet's category picker offers: what the ledger has seen (rows,
  // receipts, any budget), then the proposed names. Free to pick, nothing to
  // set up first.
  const pickable = useMemo(() => [...new Set([
    ...cats,
    ...categoryChoices({ txs: data.txs, receipts, budgetNames: data.budgets.flatMap((b) => Object.keys(b.data.allocations)) }),
  ])], [cats, data.txs, data.budgets, receipts]);
  const categoryFor = useCallback((merchant: string) => lastCategoryFor(merchant, data.txs, receipts), [data.txs, receipts]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.txs
      .filter((t) => (!needle || (t.data.merchant + " " + t.data.name).toLowerCase().includes(needle))
        && (cat === "all" || t.data.category === cat)
        && (acct === "all" || t.data.account === acct))
      .sort((a, b) => b.data.date.localeCompare(a.data.date) || a.data.merchant.localeCompare(b.data.merchant));
  }, [data.txs, q, cat, acct]);

  // The same latch the subscription add carries, for the same reason: with a
  // null id this CREATES, so a second Save landing before the first returns
  // writes a second transaction. A ref, because state has not re-rendered
  // yet when the second tap arrives.
  const savingRef = useRef(false);
  const save = async (id: string | null, d: TrackerTxData) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      if (!(await attemptWrite(() => svc.saveTx(id, d)))) return;
      setEditing(null);
      await onSaved();
    } finally {
      savingRef.current = false;
    }
  };
  // Deleting a payment first frees what it was linked to (a receipt becomes
  // unmatched, a bill it paid goes back to unpaid), and Undo links them again.
  const remove = async (tx: TrackerTx) => {
    let undo: (() => Promise<void>) | undefined;
    if (!(await attemptWrite(async () => { undo = await removeTxWithLinks(svc, ledger, tx); }))) return;
    setEditing(null);
    await onSaved();
    let used = false;
    showToast({
      message: "Transaction Deleted",
      actionLabel: "Undo",
      onAction: async () => {
        if (used || !undo) return;
        used = true;
        await attemptWrite(undo);
        await onSaved();
      },
    });
  };
  const unmatch = async (tx: TrackerTx, which: "receipt" | "bill") => {
    if (!ledger) return;
    const got: { change: LinkChange | null } = { change: null };
    if (!(await attemptWrite(async () => { got.change = await unmatchTx(ledger, tx, which); }))) return;
    const done = got.change;
    if (!done) return;
    setEditing(null);
    await onSaved();
    showToast({ message: done.said, actionLabel: "Undo", onAction: () => void (async () => { await attemptWrite(done.undo); await onSaved(); })() });
  };

  const sheetFor = (e: NonNullable<Editing>) => {
    const tx = e.kind === "edit" ? e.tx : undefined;
    const receipt = tx?.data.matchedReceiptId ? receipts.find((r) => r.id === tx.data.matchedReceiptId) : undefined;
    const bill = tx?.data.paysBillId ? bills.find((b) => b.id === tx.data.paysBillId) : undefined;
    const ev = bill?.data.paidEvidence;
    return { tx, receipt, bill, billPaidByThis: !!tx && ev?.type === "transaction" && ev.transactionId === tx.id };
  };

  return (
    <>
      {/* Proposals sit above the rows they are about, never applied on their own. */}
      <MatchesCard onChanged={() => void onSaved()} />
      <div className="pad-x mt-tools">
        <input className="input" placeholder="Search" aria-label="Search transactions"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-filters">
          <select className="input" aria-label="Spending Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All Categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" aria-label="Account" value={acct} onChange={(e) => setAcct(e.target.value)}>
            <option value="all">All Accounts</option>
            {data.accounts.map((a) => <option key={a.id} value={a.data.name}>{a.data.name}</option>)}
          </select>
        </div>
      </div>

      <SectionHead label="Transactions" count={shown.length} />
      <div className="pad-x"><div className="card list-card-ruled">
        {shown.map((t) => (
          <div className="row" key={t.id} {...pressable(() => setEditing({ kind: "edit", tx: t }))}>
            <i className="mt-dot" style={{ "--cat": categoryColor(t.data.category) } as React.CSSProperties} />
            <div className="row-grow">
              {/* His own typed words are SHOWN in Title Case and stored as
                  typed (the whole casing rule, 2026-09-26). */}
              <div className="conn-name">{titleCase(t.data.merchant)}</div>
              {/* The day is a date, small caps (F5); the category keeps the
                  row's one grey, its mark the dot at the row's head. The dot
                  between them is drawn by .facts, never baked in (F3). A
                  payment that is matched says so (Money ledger, 2026-10-03). */}
              {/* Matched is the key's green and leads the free-text category
                  (2026-10-05, visual catalog gate, R1 and R3): it was a second
                  grey beside the category. */}
              <div className="facts">
                <span className="fact date">{fmtDay(t.data.date)}</span>
                {(t.data.matchedReceiptId || t.data.paysBillId) && <span className="fact good">Matched</span>}
                <span className="fact">{lineCase(t.data.category)}</span>
              </div>
            </div>
            <div className={"mt-amt" + (t.data.amountCents < 0 ? " good" : "")}>{fmtCents(t.data.amountCents)}</div>
          </div>
        ))}
        {/* "Nothing Tracked Yet" is gone (2026-10-05, visual catalog gate, R1):
            the head's 0 says it and Add Manually is the next thing. Only a
            filter that hides every row says so, because the 0 does not say why. */}
        {shown.length === 0 && data.txs.length > 0 && (
          <div className="row"><div className="row-grow"><div className="conn-meta">Nothing Matches</div></div></div>
        )}
        {/* There is no bank connection in this version: every transaction is
            one the person adds, or one they approve from a bill or a receipt. */}
        <button className="row row-act" onClick={() => setEditing({ kind: "new" })}>Add Manually</button>
      </div></div>

      {editing && (() => {
        const { tx, receipt, bill, billPaidByThis } = sheetFor(editing);
        return (
          <TxSheet
            initial={tx ? tx.data : {
              date: month + "-15", month, merchant: "", name: "", amountCents: 0,
              category: "Other", account: data.accounts[0]?.data.name ?? "",
            }}
            accounts={data.accounts.map((a) => a.data.name)}
            categories={pickable}
            categoryFor={categoryFor}
            links={tx ? { receipt, bill, billPaidByThis } : undefined}
            onUnmatch={tx ? (which) => void unmatch(tx, which) : undefined}
            onSave={(d) => void save(tx ? tx.id : null, d)}
            onDelete={tx ? () => void remove(tx) : undefined}
            onCancel={() => setEditing(null)}
          />
        );
      })()}
    </>
  );
}

function TxSheet({ initial, accounts, categories, categoryFor, links, onUnmatch, onSave, onDelete, onCancel }: {
  initial: TrackerTxData;
  accounts: string[];
  categories: string[];
  /** The category this merchant was last filed under, for a new row. */
  categoryFor: (merchant: string) => string | undefined;
  /** What the row is matched to, for an existing row. */
  links?: { receipt?: Receipt; bill?: Bill; billPaidByThis: boolean };
  onUnmatch?: (which: "receipt" | "bill") => void;
  onSave: (d: TrackerTxData) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const isNew = !initial.merchant;
  const [merchant, setMerchant] = useState(initial.merchant);
  const [amount, setAmount] = useState(initial.amountCents ? (Math.abs(initial.amountCents) / 100).toFixed(2) : "");
  const [date, setDate] = useState(initial.date);
  // A new row opens on the category this merchant usually gets, until the
  // person picks one. An existing row keeps the one it has.
  const [picked, setPicked] = useState<string | null>(null);
  const category = picked ?? (isNew ? categoryFor(merchant) ?? initial.category : initial.category);
  const [account, setAccount] = useState(initial.account);
  // IN OR OUT IS THE SIGN, NOT A MINUS THE KEYPAD CANNOT TYPE. The iPhone
  // decimal pad has no minus, which is the same trap the account sheet hit
  // (types.ts, HMN-F-13), so the direction is a choice and the field stays
  // a plain positive number.
  const [incoming, setIncoming] = useState(initial.amountCents < 0);
  const [touched, setTouched] = useState(false);

  const cents = dollarsToCents(amount);
  const valid = merchant.trim().length > 0 && cents > 0 && !!date;
  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onSave({
      date,
      month: monthOf(date),
      merchant: merchant.trim(),
      name: initial.name.trim() || merchant.trim(),
      amountCents: incoming ? -Math.abs(cents) : Math.abs(cents),
      category: incoming ? "Income" : category,
      account,
    });
  };

  return (
    <FormSheet title={initial.merchant ? "Edit Transaction" : "New Transaction"}
      onCancel={onCancel} onSave={submit} saveDisabled={!valid}>
      <Group label="Direction">
        <MenuRow tone="green" glyph={<RepeatGlyph />} label="Direction"
          ariaLabel="Direction" value={incoming ? "in" : "out"}
          word={incoming ? "Money In" : "Money Out"}
          options={[{ value: "out", label: "Money Out" }, { value: "in", label: "Money In" }]}
          onPick={(v) => setIncoming(v === "in")} />
      </Group>
      <Group label="Transaction">
        <FieldRow tone="red" glyph={<Tag className="ic" />} label="Merchant" ariaLabel="Merchant"
          value={merchant} onChange={setMerchant} placeholder="Who Was Paid"
          error={touched && !merchant.trim()} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" ariaLabel="Amount"
          value={amount} onChange={setAmount} placeholder="0.00" inputMode="decimal"
          error={touched && cents <= 0} />
        <FieldRow tone="orange" glyph={<Calendar className="ic" />} label="Date" ariaLabel="Date"
          value={date} onChange={setDate} type="date" error={touched && !date} />
      </Group>
      <ErrorLine text={touched && !valid ? "A merchant, an amount and a date" : null} />
      <Group label="Where">
        {!incoming && (
          <MenuRow tone="purple" glyph={<FolderKanban className="ic" />} label="Category"
            ariaLabel="Category" value={category} word={category}
            options={(categories.includes(category) ? categories : [category, ...categories]).filter((c) => c !== "Income").map((c) => ({ value: c, label: c }))}
            onPick={setPicked} />
        )}
        {accounts.length > 0 && (
          <MenuRow tone="blue" glyph={<WalletGlyph />} label="Account"
            ariaLabel="Account" value={account} word={account}
            options={accounts.map((a) => ({ value: a, label: a }))} onPick={setAccount} />
        )}
      </Group>
      {links && (links.receipt || links.bill || initial.matchedReceiptId || initial.paysBillId) && (
        <Group label="Match">
          {(links.receipt || initial.matchedReceiptId) && (
            <Row tone="green" glyph={<Link2 className="ic" />} label="Matched to a Receipt"
              meta={links.receipt
                ? <LinkedFacts name={links.receipt.data.vendor} sameAs={initial.merchant} cents={links.receipt.data.amountCents} day={links.receipt.data.transactionDate} />
                : "Counted Once"}
              onClick={() => onUnmatch?.("receipt")}>
              <button type="button" className="pill-act" onClick={(e) => { e.stopPropagation(); onUnmatch?.("receipt"); }}>Unmatch</button>
            </Row>
          )}
          {(links.bill || initial.paysBillId) && (
            <Row tone="green" glyph={<Link2 className="ic" />} label="Pays a Bill"
              meta={links.bill ? <LinkedFacts name={links.bill.data.vendor} sameAs={initial.merchant} cents={links.bill.data.amountCents} /> : undefined}
              onClick={links.billPaidByThis ? () => onUnmatch?.("bill") : undefined}>
              {links.billPaidByThis && (
                <button type="button" className="pill-act" onClick={(e) => { e.stopPropagation(); onUnmatch?.("bill"); }}>Unmatch</button>
              )}
            </Row>
          )}
        </Group>
      )}
      <HistoryList history={initial.history} />
      {onDelete && <DeleteRow label="Delete Transaction" onClick={onDelete} />}
    </FormSheet>
  );
}

/* --------------------------------- Budgets -------------------------------- */

// MONTHLY ONLY, AND PLAIN (Money ledger, 2026-10-03; Dave's open question 1
// ruled out a weekly or custom period). The first time a month has no budget
// the nine proposed names appear with blank limits to fill in; rename, add or
// remove them as free text. What each has taken is computed, never typed:
// budgetActuals over the month's payments and receipts, a receipt linked to a
// payment counted once. Nothing on this tab predicts the rest of the month.
function Budgets({ month, onMonth, data, receipts, onSaved }: {
  month: string; onMonth: (m: string) => void; data: TrackerData; receipts: Receipt[]; onSaved: () => Promise<void>;
}) {
  const svc = useTracker();
  const existing = data.budgets.find((b) => b.data.month === month);
  const [income, setIncome] = useState("");
  const [target, setTarget] = useState("");
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const nameRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // The month is the record. Changing months loads that month's numbers
  // rather than carrying the last one's into a form that would save them; a
  // month with no budget starts from the proposed names. Keyed on the stored
  // content, so an unrelated reload does not wipe what is being typed.
  const stored = existing ? JSON.stringify(existing.data) : "";
  // A month with no budget opens with the last budget's categories and limits
  // (Dave 2026-10-03), and says where they came from. The key is the earlier
  // budgets' content, so saving this month does not re-copy over what was typed.
  const [copiedFrom, setCopiedFrom] = useState<string | undefined>(undefined);
  useEffect(() => {
    const b = existing?.data;
    setIncome(b ? (b.expectedIncomeCents / 100).toFixed(2) : "");
    setTarget(b ? (b.savingsTargetCents / 100).toFixed(2) : "");
    if (b) { setRows(rowsFromAllocations(b.allocations)); setCopiedFrom(undefined); }
    else { const n = rowsForNewMonth(data.budgets, month); setRows(n.rows); setCopiedFrom(n.from); }
    setFocusKey(null);
  }, [month, stored]);

  const actuals = useMemo(() => monthActuals(month, rows, data.txs, receipts), [month, rows, data.txs, receipts]);
  const shown = useMemo(() => displayRows(rows, actuals), [rows, actuals]);
  const discrepancies = useMemo(() => discrepancyLines(actuals, receipts), [actuals, receipts]);

  const save = async () => {
    // A LIMIT WITH NO NAME IS NOT DROPPED IN SILENCE (2026-10-04). A blank row
    // and a name with no limit are left out on purpose (the proposed names are
    // only suggestions), but a limit he typed against no name used to vanish
    // under "Budget Saved". Say so, and put the cursor on the name.
    // The same goes for a limit on a row named Uncategorized (2026-10-05):
    // allocationsFromRows leaves that name out on purpose (it has no limit to
    // set), so the typed number would vanish under "Budget Saved" just the same.
    const bad = rows.find((r) => (!r.name.trim() || isUncategorized(r.name)) && dollarsToCents(r.limit) > 0);
    if (bad) {
      showToast({ message: bad.name.trim() ? "Uncategorized Has No Limit" : "Name That Category First" });
      nameRefs.current[bad.key]?.focus();
      return;
    }
    const d: TrackerBudgetData = {
      month,
      // The name is the month's own unless one was set.
      name: existing?.data.name ?? monthLabel(month),
      expectedIncomeCents: dollarsToCents(income),
      savingsTargetCents: dollarsToCents(target),
      allocations: allocationsFromRows(rows),
    };
    if (!(await attemptWrite(() => svc.saveBudget(d)))) return;
    await onSaved();
    showToast({ message: "Budget Saved" });
  };
  const edit = (key: string, patch: Partial<BudgetRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const r = newRow();
    setRows((all) => [...all, r]);
    setFocusKey(r.key);
  };

  return (
    <>
      <MonthNav month={month} onMonth={onMonth} />
      <SectionHead label="The Month" />
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row" onClick={tapField}>
          <div className="row-grow"><div className="conn-name">Expected Income</div></div>
          <input className="input mt-inline" inputMode="decimal" aria-label="Expected income"
            placeholder="0.00" value={income} onChange={(e) => setIncome(e.target.value)} />
        </div>
        <div className="row" onClick={tapField}>
          <div className="row-grow"><div className="conn-name">Savings Target</div></div>
          <input className="input mt-inline" inputMode="decimal" aria-label="Savings target"
            placeholder="0.00" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
      </div></div>
      {/* The note under the card is the group-footer pattern (2026-10-05,
          visual catalog gate, R9): it was a second grey .fact line stacked on
          the Spent line below it. */}
      {copiedFrom && !existing && (
        <div className="pad-x"><div className="input-hint">Limits Copied From {monthLabel(copiedFrom)}</div></div>
      )}
      {/* What has gone out so far, a fact. A payment and the receipt linked
          to it are one amount here. */}
      <div className="pad-x mt-note">
        <span className="fact">Spent <b>{fmtCents(actuals.totalSpent)}</b>{actuals.totalLimit > 0 && <> of <b>{fmtCents(actuals.totalLimit)}</b></>}</span>
      </div>

      {discrepancies.map((d) => (
        <div className="pad-x mt-note" key={d.key}>
          {/* ONE GREY, AND NOTHING CLIPPED (2026-10-05, visual catalog gate,
              R1, R3 and the facts-never-clip ruling). The vendor, what each
              side says and which one counted were three greys on a nowrap
              .facts line that cut the last. The short toned facts lead on one
              line (the vendor, the white fact, and the payment being the one
              counted, the key's green) and what the two say, the row's one
              grey, goes under it whole, so no separator hangs at a wrap. */}
          <div className="conn-meta">
            {d.vendor && <span className="fact"><b>{titleCase(d.vendor)}</b></span>}
            <span className="fact good">{lineCase(d.counted)}</span>
          </div>
          <div className="conn-meta"><span className="fact">{lineCase(d.says)}</span></div>
        </div>
      ))}

      <SectionHead label="Categories" count={rows.length} />
      <div className="pad-x">
        {shown.map((row) => {
          const over = overLine(row, fmtCents);
          const limit = row.limit;
          const pct = limit && limit > 0 ? Math.min(100, Math.round((row.spent / limit) * 100)) : 0;
          const form = row.key ? rows.find((r) => r.key === row.key) : undefined;
          return (
            <div className="mt-cat" key={row.key ?? "spend:" + row.name}>
              <div className="mt-cat-head">
                <span className="mt-cat-name">
                  <i className="mt-dot" style={{ "--cat": categoryColor(row.name || "New") } as React.CSSProperties} />
                  {form
                    ? <input ref={(el) => { nameRefs.current[form.key] = el; }} className="input mt-inline" aria-label={(row.name || "New category") + " name"} placeholder="Name"
                        autoFocus={form.key === focusKey} value={form.name} onChange={(e) => edit(form.key, { name: e.target.value })} />
                    : lineCase(row.name)}
                </span>
                <span className={"mt-cat-amt" + (over ? " mt-over" : "")}>
                  {limit !== null ? fmtCents(row.spent) + " of " + fmtCents(limit) : fmtCents(row.spent)}
                </span>
              </div>
              {limit !== null && (
                <div className="mt-bar">
                  <div className={"mt-bar-fill" + (over ? " mt-bar-over" : "")}
                    style={{ "--cat": categoryColor(row.name), width: pct + "%" } as React.CSSProperties} />
                </div>
              )}
              {limit !== null && (
                <div className="facts">
                  {over
                    ? <span className="fact red">{lineCase(over)}</span>
                    : <span className="fact">Remaining <b>{fmtCents(row.remaining ?? 0)}</b></span>}
                </div>
              )}
              {form && (
                <div className="mt-limit-edit">
                  <input className="input mt-inline" inputMode="decimal" aria-label={(row.name || "New category") + " limit"}
                    placeholder="Limit" value={form.limit} onChange={(e) => edit(form.key, { limit: e.target.value })} />
                  <button className="quiet-action" aria-label={"Remove " + (row.name || "New category")}
                    onClick={() => setRows((all) => all.filter((r) => r.key !== form.key))}>Remove</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pad-x"><div className="card list-card-ruled">
        <button className="row row-act" onClick={addRow}>Add a Category</button>
        <div className="row" {...pressable(() => void save())}>
          <div className="row-grow"><div className="conn-name">Save This Month</div></div>
          <button className="pill-act" onClick={(e) => { e.stopPropagation(); void save(); }}>Save</button>
        </div>
      </div></div>
    </>
  );
}

/* ------------------------------ Subscriptions ----------------------------- */

function Subscriptions({ data, onSaved }: { data: TrackerData; onSaved: () => Promise<void> }) {
  const svc = useTracker();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [freq, setFreq] = useState<SubFrequency>("Monthly");

  const active = data.subs.filter((s) => s.data.status === "active");
  const monthly = monthlySubTotal(data.subs);

  // ONE TAP, ONE SUBSCRIPTION (Dave's live data, 2026-09-20: Apple Bill three
  // times, seven seconds apart). This validated, awaited the write, and only
  // cleared the fields once the write came back -- so against a real backend
  // on a phone the values sat there looking untouched, the button never
  // disabled and never changed its word, and a second tap wrote a second row.
  // Same guard the Import button above has carried since it shipped.
  //
  // The latch is a REF, not the state below it. State is what the button
  // reads to grey itself out and say "Adding", but it does not change until
  // React re-renders, so two taps inside one tick both still see false. The
  // ref flips on the first line of the first call and stops the second dead.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // WHAT IS MISSING, SAID (2026-10-04). A tap on Add with no name or no amount
  // returned without a word, so the row looked dead; it now names what is
  // missing and puts the cursor there.
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const add = async () => {
    if (busyRef.current) return;
    const cents = dollarsToCents(amount);
    if (!name.trim() || cents <= 0) {
      showToast({ message: !name.trim() && cents <= 0 ? "Add a Name and an Amount" : !name.trim() ? "Add a Name First" : "Add an Amount First" });
      (!name.trim() ? nameRef : amountRef).current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      if (!(await attemptWrite(() => svc.saveSub(null, {
        merchantName: name.trim(), amountCents: cents, frequency: freq, status: "active",
      })))) return;
      setName(""); setAmount(""); setFreq("Monthly");
      await onSaved();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const flip = async (s: TrackerSub) => {
    const next = s.data.status === "active" ? "cancelled" : "active";
    if (!(await attemptWrite(() => svc.saveSub(s.id, { ...s.data, status: next })))) return;
    await onSaved();
  };

  // EDITING AND DELETING, WHICH THIS TAB HAD NEITHER OF (Dave 2026-09-20:
  // "just put the proper buttons in for users to manage stuff like this").
  // Cancel was the only thing a subscription could ever be told, so a typo in
  // the name or a wrong amount was permanent, and a duplicate could only be
  // hidden, never removed. removeSub existed in the service from day one and
  // was wired to nothing.
  const [editing, setEditing] = useState<TrackerSub | null>(null);
  const saveEdit = async (d: TrackerSubData) => {
    if (!editing) return;
    if (!(await attemptWrite(() => svc.saveSub(editing.id, d)))) return;
    setEditing(null);
    await onSaved();
  };
  const removeOne = async (sub: TrackerSub) => {
    if (!(await attemptWrite(() => svc.removeSub(sub.id)))) return;
    setEditing(null);
    await onSaved();
    // The way back, the same shape every other delete in the app offers.
    showToast({
      message: "Subscription Deleted",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => svc.saveSub(null, sub.data)); await onSaved(); },
    });
  };

  return (
    <>
      <SectionHead label="Every Month" />
      <div className="pad-x mt-sums">
        <div className="card mt-sum">
          <div className="mt-sum-label">Active</div>
          <div className="mt-sum-value">{active.length}</div>
        </div>
        <div className="card mt-sum">
          <div className="mt-sum-label">Monthly</div>
          <div className="mt-sum-value">{fmtCents(monthly)}</div>
        </div>
      </div>

      <SectionHead label="Subscriptions" count={data.subs.length} />
      {/* No "Nothing Tracked Yet" row, and no empty card (2026-10-05, visual
          catalog gate, R1): the head's 0 says it, and Add One is the next
          section. */}
      {data.subs.length > 0 && <div className="pad-x"><div className="card list-card-ruled">
        {data.subs.map((s) => (
          // The row is a door to the editor now; Cancel stays on its own
          // button beside it, because stopping a real charge should not need
          // a trip through a sheet.
          <div className="row" key={s.id} {...pressable(() => setEditing(s))}>
            <div className="row-grow">
              <div className="conn-name">{titleCase(s.data.merchantName)}</div>
              {/* A cancelled one says so in the quiet grey chip, a fill and
                  caps, so the frequency keeps the row's one grey (§AK). */}
              <div className="r-k">
                {s.data.status !== "active" && <span className="uchip u-proposed">Cancelled</span>}
                <span className="r-goal r-cat">{s.data.frequency}</span>
              </div>
            </div>
            <div className="mt-amt">{fmtCents(s.data.amountCents)}</div>
            {/* Quiet: a list of subscriptions is a list of these, and three
                red pills down one card reads as three alarms. */}
            <button className="quiet-action" onClick={(e) => { e.stopPropagation(); void flip(s); }}>
              {s.data.status === "active" ? "Cancel" : "Restart"}
            </button>
          </div>
        ))}
      </div></div>}

      <SectionHead label="Add One" />
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row" onClick={tapField}>
          <div className="row-grow"><div className="conn-name">Name</div></div>
          <input ref={nameRef} className="input mt-inline" aria-label="New subscription name" placeholder="Netflix"
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row" onClick={tapField}>
          <div className="row-grow"><div className="conn-name">Amount</div></div>
          <input ref={amountRef} className="input mt-inline" inputMode="decimal" aria-label="New subscription amount"
            placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="row" onClick={tapField}>
          <div className="row-grow"><div className="conn-name">Every</div></div>
          <select className="input mt-inline" aria-label="Frequency" value={freq}
            onChange={(e) => setFreq(e.target.value as SubFrequency)}>
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
            <option value="Yearly">Yearly</option>
          </select>
        </div>
        <div className="row" {...pressable(() => void add())}>
          <div className="row-grow"><div className="conn-name">Add It</div></div>
          <button className="pill-act" disabled={busy}
            onClick={(e) => { e.stopPropagation(); void add(); }}>{busy ? "Adding" : "Add"}</button>
        </div>
      </div></div>

      {editing && (
        <SubEditor
          initial={editing.data}
          onSave={saveEdit}
          onDelete={() => void removeOne(editing)}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}

/** One account: what it is called, what kind it is, and what is in it. */
function AccountEditor({ initial, onSave, onDelete, onCancel }: {
  initial: TrackerAccountData | null;
  onSave: (d: TrackerAccountData) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<TrackerAccountType>(initial?.type ?? "checking");
  const [balance, setBalance] = useState(initial ? (initial.currentBalanceCents / 100).toFixed(2) : "");
  const [avail, setAvail] = useState(initial ? (initial.availableBalanceCents / 100).toFixed(2) : "");
  const [touched, setTouched] = useState(false);
  const valid = !!name.trim();
  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onSave({
      name: name.trim(), type,
      currentBalanceCents: dollarsToCents(balance),
      // Only a card carries this, and it is the credit still available rather
      // than a second balance (tracker.ts says so on the field itself).
      availableBalanceCents: type === "credit card" ? dollarsToCents(avail) : 0,
    });
  };
  return (
    <FormSheet title={initial ? "Edit Account" : "New Account"} onCancel={onCancel} onSave={submit} saveDisabled={!valid}>
      <Group label="Account">
        <FieldRow tone="red" glyph={<Tag className="ic" />} label="Name" ariaLabel="Account name"
          value={name} onChange={setName} placeholder="Checking" error={touched && !name.trim()} />
        <MenuRow tone="blue" glyph={<WalletGlyph />} label="Kind" ariaLabel="Account kind"
          value={type} word={type === "credit card" ? "Credit Card" : type === "savings" ? "Savings" : "Checking"}
          options={[
            { value: "checking", label: "Checking" },
            { value: "savings", label: "Savings" },
            { value: "credit card", label: "Credit Card" },
          ]}
          onPick={(v) => setType(v as TrackerAccountType)} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Balance" ariaLabel="Account balance"
          value={balance} onChange={setBalance} placeholder="0.00" inputMode="decimal" />
        {type === "credit card" && (
          <FieldRow tone="orange" glyph={<DollarGlyph />} label="Available Credit" ariaLabel="Available credit"
            value={avail} onChange={setAvail} placeholder="0.00" inputMode="decimal" />
        )}
      </Group>
      <ErrorLine text={touched && !valid ? "A name" : null} />
      {onDelete && <DeleteRow label="Delete Account" onClick={onDelete} />}
    </FormSheet>
  );
}

/** One subscription, editable down to the last character, and removable. */
function SubEditor({ initial, onSave, onDelete, onCancel }: {
  initial: TrackerSubData;
  onSave: (d: TrackerSubData) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.merchantName);
  const [amount, setAmount] = useState((initial.amountCents / 100).toFixed(2));
  const [freq, setFreq] = useState<SubFrequency>(initial.frequency);
  const [active, setActive] = useState(initial.status === "active");
  const [touched, setTouched] = useState(false);
  const cents = dollarsToCents(amount);
  const valid = !!name.trim() && cents > 0;
  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onSave({ merchantName: name.trim(), amountCents: cents, frequency: freq, status: active ? "active" : "cancelled" });
  };
  return (
    <FormSheet title="Edit Subscription" onCancel={onCancel} onSave={submit} saveDisabled={!valid}>
      <Group label="Subscription">
        <FieldRow tone="red" glyph={<Tag className="ic" />} label="Name" ariaLabel="Subscription name"
          value={name} onChange={setName} placeholder="Netflix" error={touched && !name.trim()} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" ariaLabel="Subscription amount"
          value={amount} onChange={setAmount} placeholder="0.00" inputMode="decimal"
          error={touched && cents <= 0} />
        <MenuRow tone="orange" glyph={<RepeatGlyph />} label="Every" ariaLabel="Frequency"
          value={freq} word={freq}
          options={[{ value: "Weekly", label: "Weekly" }, { value: "Monthly", label: "Monthly" }, { value: "Yearly", label: "Yearly" }]}
          onPick={(v) => setFreq(v as SubFrequency)} />
      </Group>
      <ErrorLine text={touched && !valid ? "A name and an amount" : null} />
      <Group label="Status">
        {/* Cancelled keeps the row and its history; it just stops counting
            toward the monthly total. Deleting is the other thing, below. */}
        <SwitchRow tone="blue" glyph={<WalletGlyph />} label="Still Paying" ariaLabel="Still paying"
          meta={active ? "Counts Toward the Monthly Total" : "Kept, Not Counted"}
          on={active} onToggle={() => setActive((v) => !v)} />
      </Group>
      <DeleteRow label="Delete Subscription" onClick={onDelete} />
    </FormSheet>
  );
}
