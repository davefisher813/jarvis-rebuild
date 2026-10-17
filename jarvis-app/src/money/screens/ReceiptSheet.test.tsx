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
