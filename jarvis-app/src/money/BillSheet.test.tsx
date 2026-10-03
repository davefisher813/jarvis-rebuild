// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BillSheet, { type BillDraft } from "./BillSheet";

// HMN-F-04 (2026-09-05): editing a once bill used to show Repeats: Monthly,
// because `initial?.recurrence ?? "monthly"` treats the stored null as
// unset. Tapping Save then turned the bill recurring and it never finished.
describe("BillSheet: an edit shows the stored recurrence, including Once", () => {
  const once: BillDraft = { text: "Car Registration", due: "2026-10-01", recurrence: null, bill: { amount: 85 } };

  it("a new bill defaults to Monthly", () => {
    render(<BillSheet mode="new" onSave={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByLabelText("Repeats")).toHaveTextContent("Monthly");
  });

  it("an edit of a once bill reads Once and saves recurrence null", () => {
    const onSave = vi.fn();
    render(<BillSheet mode="edit" initial={once} onSave={onSave} onCancel={() => undefined} />);
    expect(screen.getByLabelText("Repeats")).toHaveTextContent("Once");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0].recurrence).toBeNull();
  });

  it("an edit of a weekly bill reads Weekly", () => {
    render(<BillSheet mode="edit" initial={{ ...once, recurrence: "weekly" }} onSave={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByLabelText("Repeats")).toHaveTextContent("Weekly");
  });
});

// THE LEDGER BILL SHEET (lane B). A new bill is a ledger bill: the same three
// taps (name, amount, Save), a strict amount, a real currency code, notes, and
// no schedule unless the person picks one.
describe("BillSheet: a ledger bill", () => {
  it("starts as Once, offers Yearly, and keeps a blank due date blank", () => {
    const onSave = vi.fn();
    render(<BillSheet mode="new" ledger onSave={onSave} onCancel={() => undefined} />);
    expect(screen.getByLabelText("Repeats")).toHaveTextContent("Once");
    fireEvent.change(screen.getByLabelText("Bill name"), { target: { value: "ConEdison" } });
    fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "84.12" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toEqual({
      text: "ConEdison", due: "", recurrence: null, notes: "", currency: "USD", bill: { amount: 84.12 },
    });
  });

  it("offers Yearly only on a ledger bill", () => {
    render(<BillSheet mode="new" ledger onSave={() => undefined} onCancel={() => undefined} />);
    fireEvent.click(screen.getByLabelText("Repeats"));
    expect(screen.getByText("Yearly")).toBeInTheDocument();
  });

  it("a legacy edit has no Notes or Currency, and no Yearly", () => {
    render(<BillSheet mode="edit" initial={{ text: "Rent", due: "", recurrence: null, bill: { amount: 5 } }} onSave={() => undefined} onCancel={() => undefined} />);
    expect(screen.queryByLabelText("Notes")).toBeNull();
    expect(screen.queryByLabelText("Currency")).toBeNull();
    fireEvent.click(screen.getByLabelText("Repeats"));
    expect(screen.queryByText("Yearly")).toBeNull();
  });

  it("refuses an amount that is not a plain amount of money, and says what is missing", () => {
    const onSave = vi.fn();
    render(<BillSheet mode="new" ledger onSave={onSave} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Bill name"), { target: { value: "X" } });
    for (const bad of ["12.5x", "1e3", "-5", "0", "1.234"]) {
      fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: bad } });
      fireEvent.click(screen.getByText("Save"));
    }
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a name and an amount.")).toBeInTheDocument();
  });

  it("refuses a made-up currency code before writing anything, and uppercases a good one", () => {
    const onSave = vi.fn();
    render(<BillSheet mode="new" ledger onSave={onSave} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Bill name"), { target: { value: "Hotel" } });
    fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "xyz" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Use a three letter currency code like USD")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "gbp" } });
    expect((screen.getByLabelText("Currency") as HTMLInputElement).value).toBe("GBP");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ currency: "GBP" });
  });

  it("an edit shows the stored notes, currency and yearly repeat", () => {
    render(<BillSheet mode="edit" ledger initial={{ text: "Gym", due: "2026-12-01", recurrence: "yearly", notes: "annual", currency: "EUR", bill: { amount: 30 } }}
      onSave={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByLabelText("Repeats")).toHaveTextContent("Yearly");
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("annual");
    expect((screen.getByLabelText("Currency") as HTMLInputElement).value).toBe("EUR");
  });
});
