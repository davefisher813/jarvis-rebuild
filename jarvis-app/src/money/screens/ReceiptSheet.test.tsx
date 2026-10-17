// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReceiptSheet, { type ReceiptDraft } from "./ReceiptSheet";

// THE LOGGING STANDARD (2026-10-17). Rule 1: a new receipt opens on its vendor
// with the keyboard up. Rule 4: Return on the amount saves. Rule 6: the amount
// has the decimal keypad.
const blank: ReceiptDraft = { vendor: "", amount: "", date: "2026-10-17", category: "", currency: "USD" };
const props = { attachment: null, categories: ["Groceries"], categoryFor: () => undefined, canAttach: false, canRead: false, onRead: async () => null, onCancel: () => {} };

describe("ReceiptSheet: opens on the vendor, and Return saves", () => {
  it("a new receipt opens focused on its vendor; Return moves to the amount; Return there saves", async () => {
    const onSave = vi.fn(async (_d: unknown) => true);
    render(<ReceiptSheet {...props} initial={blank} onSave={onSave} />);
    const vendor = screen.getByLabelText("Vendor");
    expect(document.activeElement).toBe(vendor);
    fireEvent.change(vendor, { target: { value: "Stop & Shop" } });
    fireEvent.keyDown(vendor, { key: "Enter" });
    const amount = screen.getByLabelText("Amount");
    expect(document.activeElement).toBe(amount);
    expect(amount).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(amount, { target: { value: "47.12" } });
    fireEvent.keyDown(amount, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ vendor: "Stop & Shop", amount: "47.12" });
  });

  it("a receipt that arrives with a vendor opens quiet", () => {
    render(<ReceiptSheet {...props} initial={{ ...blank, vendor: "Stop & Shop", amount: "47.12" }} onSave={async () => true} />);
    expect(document.activeElement).not.toBe(screen.getByLabelText("Vendor"));
  });
});

// A DRAFT THAT SURVIVES THE APP (the Logging Standard, rule 8, 2026-10-17): a
// new receipt's vendor is kept per keystroke, restored on the next open, spent
// by the save that used it and by an explicit Cancel, and kept on a scrim tap.
describe("ReceiptSheet: a new receipt's vendor survives a remount", () => {
  const vendor = () => screen.getByLabelText("Vendor") as HTMLInputElement;

  it("a half-typed vendor comes back after a remount, and the save spends it", async () => {
    localStorage.clear();
    const first = render(<ReceiptSheet {...props} initial={blank} onSave={async () => true} />);
    fireEvent.change(vendor(), { target: { value: "Costco" } });
    first.unmount();
    const second = render(<ReceiptSheet {...props} initial={blank} onSave={async () => true} />);
    expect(vendor().value).toBe("Costco");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "47.12" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(localStorage.getItem("jarvis.receipt.draft.v1")).toBeNull());
    second.unmount();
    const third = render(<ReceiptSheet {...props} initial={blank} onSave={async () => true} />);
    expect(vendor().value).toBe("");
    third.unmount();
  });

  it("Cancel is the discard, the scrim keeps it, and a scanned vendor loses only to a draft", () => {
    localStorage.clear();
    const onCancel = vi.fn();
    const first = render(<ReceiptSheet {...props} initial={blank} onSave={async () => true} onCancel={onCancel} />);
    fireEvent.change(vendor(), { target: { value: "Costco" } });
    first.unmount();
    const second = render(<ReceiptSheet {...props} initial={blank} onSave={async () => true} onCancel={onCancel} />);
    expect(vendor().value).toBe("Costco");
    fireEvent.click(document.querySelector(".sheet-scrim") as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("jarvis.receipt.draft.v1")).toBe("Costco");
    second.unmount();
    const scanned = { ...blank, vendor: "Stop & Shop" };
    const third = render(<ReceiptSheet {...props} initial={scanned} onSave={async () => true} onCancel={onCancel} />);
    expect(vendor().value).toBe("Costco");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    third.unmount();
    const fourth = render(<ReceiptSheet {...props} initial={scanned} onSave={async () => true} onCancel={onCancel} />);
    expect(vendor().value).toBe("Stop & Shop");
    fourth.unmount();
    localStorage.clear();
  });
});
