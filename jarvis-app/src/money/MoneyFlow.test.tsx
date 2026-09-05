// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useProfile } from "../data/NotesProvider";
import MoneyFlow from "./MoneyFlow";
import { todayISO } from "../tasks/grouping";
import type { TemplateKey } from "../categories/defaults";

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
    await waitFor(() => expect(screen.getByText(/^Paid /)).toBeInTheDocument());

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
