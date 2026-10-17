// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

// THE LOGGING STANDARD (2026-10-17). Rule 1: a new bill opens on its name with
// the keyboard up. Rule 4: Return on the amount saves. Rule 6: the amount has
// the decimal keypad.
describe("BillSheet: opens on the name, and Return saves", () => {
  it("a new bill opens focused on its name; Return moves to the amount; Return there saves", () => {
    const onSave = vi.fn();
    render(<BillSheet mode="new" onSave={onSave} onCancel={() => undefined} />);
    const name = screen.getByLabelText("Bill name");
    expect(document.activeElement).toBe(name);
    expect(name).toHaveAttribute("data-autofocus");
    fireEvent.change(name, { target: { value: "Rent" } });
    fireEvent.keyDown(name, { key: "Enter" });
    const amount = screen.getByLabelText("Amount in dollars");
    expect(document.activeElement).toBe(amount);
    expect(amount).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(amount, { target: { value: "1200" } });
    fireEvent.keyDown(amount, { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ text: "Rent", bill: { amount: 1200 } });
  });

  it("an edit opens quiet", () => {
    render(<BillSheet mode="edit" initial={{ text: "Car Registration", due: "2026-10-01", recurrence: null, bill: { amount: 85 } }} onSave={() => undefined} onCancel={() => undefined} />);
    expect(document.activeElement).not.toBe(screen.getByLabelText("Bill name"));
  });
});

// A DRAFT THAT SURVIVES THE APP (the Logging Standard, rule 8, 2026-10-17): a
// new bill's name is kept per keystroke, restored on the next open, spent by
// the save that used it and by an explicit Cancel, and kept on a scrim tap.
describe("BillSheet: a new bill's name survives a remount", () => {
  const name = () => screen.getByLabelText("Bill name") as HTMLInputElement;

  it("a half-typed name comes back after a remount, and the save spends it", async () => {
    localStorage.clear();
    const first = render(<BillSheet mode="new" onSave={() => undefined} onCancel={() => undefined} />);
    fireEvent.change(name(), { target: { value: "Rent" } });
    first.unmount();
    const second = render(<BillSheet mode="new" onSave={() => undefined} onCancel={() => undefined} />);
    expect(name().value).toBe("Rent");
    fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "1200" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(localStorage.getItem("jarvis.bill.draft.v1")).toBeNull());
    second.unmount();
    const third = render(<BillSheet mode="new" onSave={() => undefined} onCancel={() => undefined} />);
    expect(name().value).toBe("");
    third.unmount();
  });

  it("Cancel is the discard, the scrim keeps it, and a caller's name loses only to a draft", () => {
    localStorage.clear();
    const onCancel = vi.fn();
    const first = render(<BillSheet mode="new" onSave={() => undefined} onCancel={onCancel} />);
    fireEvent.change(name(), { target: { value: "Rent" } });
    first.unmount();
    const second = render(<BillSheet mode="new" onSave={() => undefined} onCancel={onCancel} />);
    expect(name().value).toBe("Rent");
    fireEvent.click(document.querySelector(".sheet-scrim") as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("jarvis.bill.draft.v1")).toBe("Rent");
    second.unmount();
    const prefilled = { text: "Car Registration", due: "2026-10-01", recurrence: null, bill: { amount: 85 } };
    const third = render(<BillSheet mode="new" initial={prefilled} onSave={() => undefined} onCancel={onCancel} />);
    expect(name().value).toBe("Rent");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    third.unmount();
    const fourth = render(<BillSheet mode="new" initial={prefilled} onSave={() => undefined} onCancel={onCancel} />);
    expect(name().value).toBe("Car Registration");
    fourth.unmount();
  });

  it("an edit neither reads nor writes the draft", () => {
    localStorage.clear();
    localStorage.setItem("jarvis.bill.draft.v1", "Rent");
    const r = render(<BillSheet mode="edit" initial={{ text: "Car Registration", due: "2026-10-01", recurrence: null, bill: { amount: 85 } }} onSave={() => undefined} onCancel={() => undefined} />);
    expect(name().value).toBe("Car Registration");
    fireEvent.change(name(), { target: { value: "Car Tags" } });
    expect(localStorage.getItem("jarvis.bill.draft.v1")).toBe("Rent");
    r.unmount();
    localStorage.clear();
  });
});
