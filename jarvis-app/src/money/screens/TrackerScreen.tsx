import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../../shared/PageHeader";
import { useTracker } from "../../data/NotesProvider";
import { FormSheet, Group, FieldRow, MenuRow, SwitchRow, DeleteRow, ErrorLine, tapField } from "../../shared/FormSheet";
import { Calendar, FolderKanban, Tag } from "../../shared/icons";
import { DollarGlyph, WalletGlyph, RepeatGlyph } from "../../shared/glyphs";
import { pressable } from "../../shared/pressable";
import { showToast } from "../../shared/toast";
import { attemptWrite } from "../../shared/guard";
import {
  EMPTY_TRACKER, byCategory, categoryColor, dollarsToCents, fmtCents, fmtDay, inMonth,
  incomeCents, knownCategories, monthLabel, monthlySubTotal, monthOf, shiftMonth, spentCents,
  thisMonth, topMerchants,
  type SubFrequency, type TrackerAccount, type TrackerAccountData, type TrackerAccountType, type TrackerBudgetData, type TrackerData, type TrackerSub, type TrackerSubData, type TrackerTx, type TrackerTxData,
} from "../tracker";

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
// written against. Spent reads in the ordinary ink; the only red here is a
// category actually over its limit, which appears only once it happens.

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

  const reload = useCallback(async () => {
    setData(await svc.load());
    setLoaded(true);
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);

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
    showToast({ message: "September imported" });
  };

  return (
    <div className="screen ruled">
      <PageHeader title="Tracker" back="Money" onBack={onBack} />
      {canSeed && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row" {...pressable(() => void runSeed())}>
            <div className="row-grow">
              <div className="conn-name">Import September Data</div>
              <div className="conn-meta">Your accounts, subscriptions and 31 transactions</div>
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
        <Dashboard month={month} onMonth={setMonth} txs={monthTxs} data={data} onSaved={reload} />
      )}
      {tab === "transactions" && (
        <Transactions data={data} month={month} onSaved={reload} />
      )}
      {tab === "budgets" && (
        <Budgets month={month} onMonth={setMonth} txs={monthTxs} data={data} onSaved={reload} />
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

function Dashboard({ month, onMonth, txs, data, onSaved }: {
  month: string; onMonth: (m: string) => void; txs: TrackerTx[]; data: TrackerData;
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
      message: "Account deleted",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => svc.saveAccount(null, a.data)); await onSaved(); },
    });
  };
  const spent = spentCents(txs);
  const income = incomeCents(txs);
  const net = income - spent;
  const cats = useMemo(() => byCategory(txs), [txs]);
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
              {a.data.type === "credit card" && (
                <div className="mt-acct-sub">Available credit {fmtCents(a.data.availableBalanceCents)}</div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row" {...pressable(() => setAcct("new"))}>
          <div className="row-grow">
            <div className="conn-name">Add an Account</div>
            {data.accounts.length === 0 && (
              <div className="conn-meta">Nothing here yet</div>
            )}
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
          <div className="mt-sum-value good">{fmtCents(income)}</div>
        </div>
        <div className="card mt-sum">
          <div className="mt-sum-label">Out</div>
          <div className="mt-sum-value">{fmtCents(spent)}</div>
        </div>
        <div className="card mt-sum">
          <div className="mt-sum-label">Net</div>
          <div className={"mt-sum-value" + (net >= 0 ? " good" : " warn")}>{fmtCents(net)}</div>
        </div>
      </div>
      {budget && (
        <div className="pad-x mt-note">
          {"Target " + fmtCents(budget.data.savingsTargetCents) + " · Expected " + fmtCents(budget.data.expectedIncomeCents)}
        </div>
      )}

      <SectionHead label="Spending by Category" count={cats.length} />
      {cats.length === 0 ? (
        <div className="pad-x mt-note">Nothing spent this month</div>
      ) : (
        <div className="pad-x">
          {cats.map(([name, cents], i) => (
            <div className="mt-cat" key={name}>
              <div className="mt-cat-head">
                <span className="mt-cat-name">
                  <i className="mt-dot" style={{ "--cat": categoryColor(name, i) } as React.CSSProperties} />
                  {name}
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
                <div className="row-grow"><div className="conn-name">{name}</div></div>
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

function Transactions({ data, month, onSaved }: {
  data: TrackerData; month: string; onSaved: () => Promise<void>;
}) {
  const svc = useTracker();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [acct, setAcct] = useState("all");
  const [editing, setEditing] = useState<Editing>(null);

  const cats = useMemo(() => knownCategories(data.txs), [data.txs]);
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
  const remove = async (tx: TrackerTx) => {
    if (!(await attemptWrite(() => svc.removeTx(tx.id)))) return;
    setEditing(null);
    await onSaved();
    showToast({
      message: "Transaction deleted",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => svc.saveTx(null, tx.data)); await onSaved(); },
    });
  };

  return (
    <>
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
              <div className="conn-name">{t.data.merchant}</div>
              <div className="conn-meta">{fmtDay(t.data.date) + " · " + t.data.category}</div>
            </div>
            <div className={"mt-amt" + (t.data.amountCents < 0 ? " good" : "")}>{fmtCents(t.data.amountCents)}</div>
          </div>
        ))}
        {shown.length === 0 && (
          <div className="row"><div className="row-grow"><div className="conn-meta">Nothing matches</div></div></div>
        )}
        <button className="row row-act" onClick={() => setEditing({ kind: "new" })}>Add a Transaction</button>
      </div></div>

      {editing && (
        <TxSheet
          initial={editing.kind === "edit" ? editing.tx.data : {
            date: month + "-15", month, merchant: "", name: "", amountCents: 0,
            category: "Other", account: data.accounts[0]?.data.name ?? "",
          }}
          accounts={data.accounts.map((a) => a.data.name)}
          categories={cats}
          onSave={(d) => void save(editing.kind === "edit" ? editing.tx.id : null, d)}
          onDelete={editing.kind === "edit" ? () => void remove(editing.tx) : undefined}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}

function TxSheet({ initial, accounts, categories, onSave, onDelete, onCancel }: {
  initial: TrackerTxData;
  accounts: string[];
  categories: string[];
  onSave: (d: TrackerTxData) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [merchant, setMerchant] = useState(initial.merchant);
  const [amount, setAmount] = useState(initial.amountCents ? (Math.abs(initial.amountCents) / 100).toFixed(2) : "");
  const [date, setDate] = useState(initial.date);
  const [category, setCategory] = useState(initial.category);
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
            options={categories.filter((c) => c !== "Income").map((c) => ({ value: c, label: c }))}
            onPick={setCategory} />
        )}
        {accounts.length > 0 && (
          <MenuRow tone="blue" glyph={<WalletGlyph />} label="Account"
            ariaLabel="Account" value={account} word={account}
            options={accounts.map((a) => ({ value: a, label: a }))} onPick={setAccount} />
        )}
      </Group>
      {onDelete && <DeleteRow label="Delete Transaction" onClick={onDelete} />}
    </FormSheet>
  );
}

/* --------------------------------- Budgets -------------------------------- */

function Budgets({ month, onMonth, txs, data, onSaved }: {
  month: string; onMonth: (m: string) => void; txs: TrackerTx[]; data: TrackerData; onSaved: () => Promise<void>;
}) {
  const svc = useTracker();
  const existing = data.budgets.find((b) => b.data.month === month);
  const [income, setIncome] = useState("");
  const [target, setTarget] = useState("");
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  // The month is the record. Changing months loads that month's numbers
  // rather than carrying the last one's into a form that would save them.
  useEffect(() => {
    const b = existing?.data;
    setIncome(b ? (b.expectedIncomeCents / 100).toFixed(2) : "");
    setTarget(b ? (b.savingsTargetCents / 100).toFixed(2) : "");
    setLimits(b ? Object.fromEntries(Object.entries(b.allocations).map(([k, v]) => [k, (v / 100).toFixed(2)])) : {});
  }, [month, existing]);

  const spentBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const [name, cents] of byCategory(txs)) m.set(name, cents);
    return m;
  }, [txs]);

  const save = async () => {
    const allocations: Record<string, number> = {};
    for (const [k, v] of Object.entries(limits)) {
      const c = dollarsToCents(v);
      if (c > 0) allocations[k] = c;
    }
    const d: TrackerBudgetData = {
      month,
      expectedIncomeCents: dollarsToCents(income),
      savingsTargetCents: dollarsToCents(target),
      allocations,
    };
    if (!(await attemptWrite(() => svc.saveBudget(d)))) return;
    await onSaved();
    showToast({ message: "Budget saved" });
  };

  const rows = Object.entries(limits);
  const spare = knownCategories(data.txs).filter((c) => c !== "Income" && !(c in limits));

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

      <SectionHead label="Category Limits" count={rows.length} />
      {rows.length === 0 && <div className="pad-x mt-note">No limits set for this month</div>}
      <div className="pad-x">
        {rows.map(([name, value]) => {
          const limit = dollarsToCents(value);
          const spent = spentBy.get(name) ?? 0;
          const over = limit > 0 && spent > limit;
          const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
          return (
            <div className="mt-cat" key={name}>
              <div className="mt-cat-head">
                <span className="mt-cat-name">
                  <i className="mt-dot" style={{ "--cat": categoryColor(name) } as React.CSSProperties} />
                  {name}
                </span>
                <span className={"mt-cat-amt" + (over ? " mt-over" : "")}>
                  {fmtCents(spent) + " of " + fmtCents(limit)}
                </span>
              </div>
              <div className="mt-bar">
                <div className={"mt-bar-fill" + (over ? " mt-bar-over" : "")}
                  style={{ "--cat": categoryColor(name), width: pct + "%" } as React.CSSProperties} />
              </div>
              <div className="mt-limit-edit">
                <input className="input mt-inline" inputMode="decimal" aria-label={name + " limit"}
                  value={value} onChange={(e) => setLimits((s) => ({ ...s, [name]: e.target.value }))} />
                <button className="quiet-action" onClick={() => setLimits((s) => {
                  const n = { ...s };
                  delete n[name];
                  return n;
                })}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pad-x"><div className="card list-card-ruled">
        {adding && spare.length > 0 && (
          <div className="row" onClick={tapField}>
            <div className="row-grow"><div className="conn-name">Pick a Category</div></div>
            <select className="input mt-inline" aria-label="New limit category" defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                setLimits((s) => ({ ...s, [e.target.value]: "" }));
                setAdding(false);
              }}>
              <option value="">Choose</option>
              {spare.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        {spare.length > 0 && !adding && (
          <button className="row row-act" onClick={() => setAdding(true)}>Add a Limit</button>
        )}
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
  const add = async () => {
    const cents = dollarsToCents(amount);
    if (busyRef.current || !name.trim() || cents <= 0) return;
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
      message: "Subscription deleted",
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
      <div className="pad-x"><div className="card list-card-ruled">
        {data.subs.map((s) => (
          // The row is a door to the editor now; Cancel stays on its own
          // button beside it, because stopping a real charge should not need
          // a trip through a sheet.
          <div className="row" key={s.id} {...pressable(() => setEditing(s))}>
            <div className="row-grow">
              <div className="conn-name">{s.data.merchantName}</div>
              <div className="conn-meta">
                {s.data.frequency + (s.data.status === "active" ? "" : " · Cancelled")}
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
        {data.subs.length === 0 && (
          <div className="row"><div className="row-grow"><div className="conn-meta">Nothing tracked yet</div></div></div>
        )}
      </div></div>

      <SectionHead label="Add One" />
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row" onClick={tapField}>
          <div className="row-grow"><div className="conn-name">Name</div></div>
          <input className="input mt-inline" aria-label="New subscription name" placeholder="Netflix"
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row" onClick={tapField}>
          <div className="row-grow"><div className="conn-name">Amount</div></div>
          <input className="input mt-inline" inputMode="decimal" aria-label="New subscription amount"
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
          meta={active ? "Counts toward the monthly total" : "Kept, but not counted"}
          on={active} onToggle={() => setActive((v) => !v)} />
      </Group>
      <DeleteRow label="Delete Subscription" onClick={onDelete} />
    </FormSheet>
  );
}
