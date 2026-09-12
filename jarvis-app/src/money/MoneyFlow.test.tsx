// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useProfile } from "../data/NotesProvider";
import MoneyFlow from "./MoneyFlow";
import { todayISO } from "../tasks/grouping";
import type { TemplateKey } from "../categories/defaults";

// 2026-09-11: AI is off for every test here except the receipt read, which
// flips it on for itself. The encoder needs a real canvas, so it is stubbed.
const aiState = vi.hoisted(() => ({ available: false, reply: "" }));
vi.mock("../ai/useAI", () => ({
  useAI: () => ({ available: aiState.available, complete: async () => aiState.reply }),
}));
vi.mock("../shared/imageEncode", async (orig) => ({
  ...(await orig<typeof import("../shared/imageEncode")>()),
  encodeImageForVision: async () => ({ data: "x", mediaType: "image/png" }),
}));

describe("MoneyFlow", () => {
  it("empty -> add account -> shows total, dated as self-reported", async () => {
    render(<NotesProvider userId="u1"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add an Account"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Checking"), { target: { value: "Savings" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Total balance")).toBeInTheDocument());
    expect(screen.getAllByText("$5,000").length).toBeGreaterThanOrEqual(2);
    // The balance is self-reported and the page says so, with a date.
    expect(screen.getByText(/As you last entered it ·/)).toBeInTheDocument();
  });

  it("adds a bill and marks it paid with a dated receipt; autopay copy never says paid", async () => {
    render(<NotesProvider userId="u2"><MoneyFlow /></NotesProvider>);
    // From empty: the bill path exists without an account
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Electric" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Electric")).toBeInTheDocument());
    expect(screen.getByText("$120")).toBeInTheDocument();
    // mark paid -> dated receipt appears
    fireEvent.click(screen.getByLabelText("Mark paid"));
    // UP-CORE-13 (2026-09-05): scoped to the ROW's own line. The page grew a
    // "Paid This Month" head, which is a different claim about the same word
    // and used to make this query ambiguous.
    await waitFor(() => expect(screen.getByText(/^Paid \w{3} \d/)).toBeInTheDocument());

    // autopay bill: only ever "set to autopay" language
    fireEvent.click(screen.getByText("Add Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Rent" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1850" } });
    // Autopay is a switch on the bill sheet (the form sheets, 2026-09-02).
    fireEvent.click(screen.getByLabelText("Autopay"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText(/Set to autopay/)).toBeInTheDocument();
    expect(screen.queryByText(/Rent.*paid/i)).not.toBeInTheDocument();
  });
});

// One Money (2026-08-10): Dave, "there should only be one money category with
// all of its features". The old Money category opened a dead-end page with
// no financial data; that page is gone, but a task tagged to it (not a bill)
// must not become invisible now that the category no longer has its own
// screen. It surfaces here instead, and opening it hands off through
// onOpenTask exactly like any other deep link.
function SeededTagged({ onOpenTask }: { onOpenTask?: (id: string) => void }) {
  const tasks = useTasks();
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const id = await cats.create("Money", "yellow");
      await tasks.createTask("Budget Review", { category: id! });
      // A done task and a bill-flavored task must NOT show up here: done
      // items are finished, and bills already have their own section.
      const doneId = await tasks.createTask("Old Money Thing", { category: id! });
      await tasks.toggleDone(doneId!);
      await tasks.createTask("Rent", { category: id!, bill: { amount: 100 } });
      // A non-money category's task must never leak into this list either.
      const other = await cats.create("Home", "blue");
      await tasks.createTask("Fix Sink", { category: other! });
      setReady(true);
    })();
  }, [tasks, cats]);
  return ready ? <MoneyFlow onOpenTask={onOpenTask} /> : null;
}

describe("MoneyFlow: tagged Money tasks (2026-08-10)", () => {
  it("surfaces a non-bill task tagged Money, excludes done and other-category tasks", async () => {
    render(<NotesProvider userId="u3"><SeededTagged /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Also Tagged Money")).toBeInTheDocument());
    expect(screen.getByText("Budget Review")).toBeInTheDocument();
    expect(screen.queryByText("Old Money Thing")).not.toBeInTheDocument();
    expect(screen.queryByText("Fix Sink")).not.toBeInTheDocument();
    // Rent is a bill: it shows once, in Bills, never duplicated into this section.
    expect(screen.getAllByText("Rent")).toHaveLength(1);
  });

  it("tapping a tagged task hands off through onOpenTask", async () => {
    const onOpenTask = vi.fn();
    render(<NotesProvider userId="u4"><SeededTagged onOpenTask={onOpenTask} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Budget Review"));
    expect(onOpenTask).toHaveBeenCalledWith(expect.any(String));
  });

  it("a Money-tagged task alone (no accounts, no bills) is not swallowed by the empty state", async () => {
    render(<NotesProvider userId="u5"><SeededTagged /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Budget Review")).toBeInTheDocument());
    expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
  });
});

// S5-Q33 (2026-09-04): "the budget half is off for Student and Business."
// The arithmetic (budget.ts/bills.ts) takes no template at all -- the gate
// was ONE boolean in this file, and it used to admit only "personal,"
// catching Student in the same net as Business. Student gets a real,
// recurring inflow and is the template this product leads with; Business
// stays excluded because irregular revenue makes "a paycheck" the wrong
// shape (the honest-money rule forbids faking a regular one).
function SeededTemplate({ template, withPayday }: { template: TemplateKey; withPayday?: boolean }) {
  const profile = useProfile();
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await profile.save({
        template,
        ...(withPayday ? { payday: { amount: 500, next: todayISO(), freq: "biweekly" as const } } : {}),
      });
      await tasks.createTask("Rent", { bill: { amount: 100 } });
      setReady(true);
    })();
  }, [profile, tasks, template, withPayday]);
  return ready ? <MoneyFlow /> : null;
}

describe("MoneyFlow: the budget half by template (S5-Q33)", () => {
  it("Personal offers Set Up Payday", async () => {
    render(<NotesProvider userId="t-personal"><SeededTemplate template="personal" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText("Set Up Payday")).toBeInTheDocument();
  });

  it("Student offers Set Up Payday too -- it is not caught in Business's gate", async () => {
    render(<NotesProvider userId="t-student"><SeededTemplate template="student" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText("Set Up Payday")).toBeInTheDocument();
  });

  it("Business gets no Set Up Payday row: irregular revenue is not a paycheck", async () => {
    render(<NotesProvider userId="t-business"><SeededTemplate template="business" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.queryByText("Set Up Payday")).not.toBeInTheDocument();
  });

  it("Student with a payday already set sees the real hero and Set Aside, same as Personal", async () => {
    render(<NotesProvider userId="t-student-pay"><SeededTemplate template="student" withPayday /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Set Aside")).toBeInTheDocument());
    expect(screen.getByText(/^Yours/)).toBeInTheDocument();
  });

  it("Business with a payday already set on the profile still shows no hero or Set Aside", async () => {
    render(<NotesProvider userId="t-business-pay"><SeededTemplate template="business" withPayday /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.queryByText("Set Aside")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Yours/)).not.toBeInTheDocument();
  });
});

// SHELL-F-21 (2026-09-05): search "Chase", tap the account row (which wears a
// chevron), and the Money tab opened on its normal first screen with the
// account neither opened nor highlighted. This tab had no deep-link prop at
// all; now it has the same one-shot every other tab has.
import { useMoney } from "../data/NotesProvider";

function AccountLink() {
  const money = useMoney();
  const [id, setId] = useState<string | undefined>(undefined);
  const [intent, setIntent] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  useEffect(() => {
    void (async () => { setId((await money.create({ name: "Chase Checking", balance: 1200, kind: "cash" })) ?? undefined); })();
  }, [money]);
  return id ? (
    <>
      <button onClick={() => setIntent((i) => ({ value: id, nonce: i.nonce + 1 }))}>Search Hit</button>
      <MoneyFlow
        openAccountId={intent.value}
        openNonce={intent.nonce}
        onOpenConsumed={() => setIntent((i) => ({ nonce: i.nonce }))}
      />
    </>
  ) : null;
}

// HMN-F-09 (2026-09-05): ten Money writes ran outside attemptWrite. A save on
// a bad connection latched the button on "Saving" with no toast and nothing
// stored, and Cancel (which throws the typing away) was the only way out.
import { MoneyService } from "./MoneyService";
import { TasksService } from "../tasks/TasksService";
import { subscribeToast, resetToasts } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

describe("Money writes that fail say so and give the button back (HMN-F-09)", () => {
  afterEach(() => { vi.restoreAllMocks(); resetToasts(); });

  it("a failed account save toasts, unlatches Save, and keeps what was typed", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    vi.spyOn(MoneyService.prototype, "create").mockRejectedValue(new Error("offline"));
    render(<NotesProvider userId="fail-acct"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add an Account"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Checking"), { target: { value: "Savings" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    // The sheet is still here, the typing is still in it, and Save is a
    // button again rather than a permanent "Saving".
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Savings");
    stop();
  });

  it("a failed bill save toasts and unlatches Save", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    vi.spyOn(TasksService.prototype, "createTask").mockRejectedValue(new Error("offline"));
    render(<NotesProvider userId="fail-bill"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Electric" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Bill name") as HTMLInputElement).value).toBe("Electric");
    stop();
  });

  it("a failed mark paid says so instead of nothing", async () => {
    const seen: string[] = [];
    render(<NotesProvider userId="fail-paid"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Electric" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Electric")).toBeInTheDocument());

    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    vi.spyOn(TasksService.prototype, "toggleDone").mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByLabelText("Mark paid"));
    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    stop();
  });
});

describe("a Money search hit opens the account (SHELL-F-21)", () => {
  it("opens that account, and a later visit to the tab does not", async () => {
    render(<NotesProvider userId="acct-f21"><AccountLink /></NotesProvider>);
    await screen.findByText("Chase Checking");
    expect(screen.queryByText("Edit Account")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Search Hit"));
    await waitFor(() => expect(screen.getByText("Edit Account")).toBeInTheDocument());
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Chase Checking");

    // Closed by hand, the link is spent: nothing reopens it.
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Edit Account")).not.toBeInTheDocument());
  });
});

// HMN-F-12 (2026-09-05), option A: Set Aside envelopes lived in this phone's
// localStorage, so the iPad showed a different Yours, Chat on a second device
// did not know they existed, and a new phone lost every one of them. They sit
// on the profile record now, beside the payday the same screen already reads.
let profRef: ReturnType<typeof useProfile> | null = null;
function SeededForEnvelopes() {
  const profile = useProfile();
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      profRef = profile;
      await profile.save({ template: "personal", payday: { amount: 500, next: todayISO(), freq: "biweekly" as const } });
      // One bill, so the page is past its empty state and the budget half
      // (which is what Set Aside lives in) renders at all.
      await tasks.createTask("Rent", { bill: { amount: 100 } });
      setReady(true);
    })();
  }, [profile, tasks]);
  return ready ? <MoneyFlow /> : null;
}

describe("Set Aside envelopes live on the profile (HMN-F-12)", () => {
  afterEach(() => { localStorage.clear(); resetToasts(); });

  it("a new envelope is written to the profile, not to this device", async () => {
    profRef = null;
    render(<NotesProvider userId="env-1"><SeededForEnvelopes /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Set Money Aside")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Set Money Aside"));
    fireEvent.change(screen.getByPlaceholderText("What For"), { target: { value: "Groceries" } });
    fireEvent.change(screen.getAllByPlaceholderText("0")[0]!, { target: { value: "300" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(async () => {
      expect((await profRef!.get())!.envelopes).toEqual([{ id: expect.any(String), name: "Groceries", amount: 300 }]);
    });
    expect(localStorage.getItem("jarvis.money.envelopes.v1")).toBeNull();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("envelopes this phone already had are lifted onto the profile once, then forgotten here", async () => {
    profRef = null;
    localStorage.setItem("jarvis.money.envelopes.v1", JSON.stringify([{ id: "a", name: "Gas", amount: 120 }]));
    render(<NotesProvider userId="env-2"><SeededForEnvelopes /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Gas")).toBeInTheDocument());
    await waitFor(async () => {
      expect((await profRef!.get())!.envelopes).toEqual([{ id: "a", name: "Gas", amount: 120 }]);
    });
    expect(localStorage.getItem("jarvis.money.envelopes.v1")).toBeNull();
  });

  it("removing one offers Undo, and Undo puts it back on the profile", async () => {
    profRef = null;
    const seen: string[] = [];
    let undo: (() => void) | undefined;
    const stop = subscribeToast((t) => { if (t) { seen.push(t.message); undo = t.onAction; } });
    localStorage.setItem("jarvis.money.envelopes.v1", JSON.stringify([{ id: "a", name: "Gas", amount: 120 }]));
    render(<NotesProvider userId="env-3"><SeededForEnvelopes /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Gas")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Remove Gas"));
    await waitFor(() => expect(seen).toContain("Set aside removed"));
    await waitFor(async () => expect((await profRef!.get())!.envelopes).toEqual([]));

    undo?.();
    await waitFor(() => expect(screen.getByText("Gas")).toBeInTheDocument());
    await waitFor(async () => {
      expect((await profRef!.get())!.envelopes).toEqual([{ id: "a", name: "Gas", amount: 120 }]);
    });
    stop();
  });
});

// HMN-F-13 (2026-09-05), option A: a Credit account is money owed. The field
// asked for a "Balance" behind inputMode="numeric", and that keypad has no
// minus, so $2,000 owed went in as 2,000 and Total balance went UP by the
// size of the debt.
describe("a Credit account is a debt, typed as a plain number (HMN-F-13)", () => {
  it("asks what is Owed and takes it off the total", async () => {
    render(<NotesProvider userId="credit-1"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add an Account"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Checking"), { target: { value: "Visa" } });
    // The field is Balance until the kind says otherwise.
    expect(screen.getByLabelText("Balance in dollars")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Account type"));
    fireEvent.click(await screen.findByText("Credit"));
    const owed = await screen.findByLabelText("Amount owed in dollars");
    fireEvent.change(owed, { target: { value: "2000" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("Total balance")).toBeInTheDocument());
    // No minus was typed anywhere, and the total went down by the debt.
    expect(screen.getAllByText("-$2,000").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("$2,000")).not.toBeInTheDocument();
  });
});

// 2026-09-11: Read It filled the "paid" sheet's own initial, but the sheet was
// only ever handed the edit bill's, so From a Receipt opened empty.
import { useOptionalFiles } from "../data/NotesProvider";
import { MemoryFileStore } from "../files/FileStore";

function SeededReceipt() {
  const files = useOptionalFiles();
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      // One bill, so the page is past its empty state and Receipts shows.
      await tasks.createTask("Rent", { bill: { amount: 100 } });
      await files!.create({ name: "corner-store.png", path: "p/corner-store.png", mime: "image/png", bytes: 10, scope: "money", addedAt: "2026-09-01" });
      setReady(true);
    })();
  }, [files, tasks]);
  return ready ? <MoneyFlow /> : null;
}

describe("Read It prefills From a Receipt", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); aiState.available = false; aiState.reply = ""; });

  it("opens the sheet with the vendor and total the receipt read", async () => {
    aiState.available = true;
    aiState.reply = '{"vendor":"Corner Store","total":42.75,"date":"2026-09-03","currency":"USD"}';
    vi.spyOn(MemoryFileStore.prototype, "url").mockResolvedValue("blob:receipt");
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"], { type: "image/png" }) })));
    render(<NotesProvider userId="receipt-read"><SeededReceipt /></NotesProvider>);

    const readIt = await screen.findByLabelText("Read corner-store.png");
    // The URL resolves a beat after the row; Read It waits for it.
    await waitFor(() => {
      if (!screen.queryByText("From a Receipt")) fireEvent.click(readIt);
      expect(screen.getByText("From a Receipt")).toBeInTheDocument();
    });
    expect((screen.getByLabelText("Bill name") as HTMLInputElement).value).toBe("Corner Store");
    expect((screen.getByLabelText("Amount in dollars") as HTMLInputElement).value).toBe("42.75");
  });
});
