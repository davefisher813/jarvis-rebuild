// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BillDetailSheet from "./BillDetailSheet";
import type { Bill } from "../ledger/types";

// THE BILL'S SHEET WEARS ITS STATE AND HOLDS ITS PRIMARY (Dave 2026-10-05, the review of the Rent sheet: "Oct 7" and
// "Due in 2 Days" drawn in the neutral grey of the details around them, Mark Paid the weight of a detail row while
// Delete Bill was the loudest thing on the sheet). The Colour Key: a due date is amber, a late one red, a paid status
// green; the sheet's one filled button is the verb it exists for.

const TODAY = "2026-10-05";
const bill = (over: Partial<Bill["data"]> = {}): Bill => ({
  id: "b1",
  data: {
    vendor: "rent", amountCents: 220000, currency: "USD", dueDate: "2026-10-07", recurrence: "monthly",
    source: "manual", fingerprint: "fp", history: [{ at: "2026-10-05T09:00:00.000Z", by: "user", action: "Created" }],
    ...over,
  },
});

const mount = (b: Bill) => render(
  <BillDetailSheet bill={b} today={TODAY} onClose={vi.fn()} onEdit={vi.fn()} onMarkPaid={vi.fn()} onRemovePaid={vi.fn()} onDelete={vi.fn()} />,
);
const valueOf = (label: string) => screen.getByText(label).closest(".row")!.querySelector(".bill-val") as HTMLElement;

describe("BillDetailSheet: the state colours and the primary", () => {
  it("a bill due in two days draws its due date and its status amber, as facts, not as a ruled-list chip that does nothing in a sheet", () => {
    mount(bill());
    const due = valueOf("Due");
    expect(due.textContent).toBe("Oct 7");
    expect(due).toHaveClass("fact", "warn");
    const status = valueOf("Status");
    expect(status.textContent).toBe("Due in 2 Days");
    expect(status).toHaveClass("fact", "warn");
    expect(status).not.toHaveClass("uchip");
  });

  it("a late bill is red on both, and a bill far out is neither", () => {
    const { unmount } = mount(bill({ dueDate: "2026-10-02" }));
    expect(valueOf("Due")).toHaveClass("fact", "red");
    expect(valueOf("Status")).toHaveClass("fact", "red");
    expect(valueOf("Status").textContent).toBe("3 Days Late");
    unmount();
    mount(bill({ dueDate: "2026-12-20" }));
    expect(valueOf("Due")).not.toHaveClass("warn");
    expect(valueOf("Due")).not.toHaveClass("red");
  });

  it("a paid bill's status is green and its due date is neutral", () => {
    mount(bill({ paidAt: "2026-10-04", paidEvidence: { type: "user_confirmed" } }));
    expect(valueOf("Status")).toHaveClass("fact", "good");
    expect(valueOf("Due")).not.toHaveClass("warn");
    expect(valueOf("Due")).not.toHaveClass("red");
  });

  it("Mark Paid is the sheet's one filled button and runs the verb; Delete Bill stays a plain row", () => {
    const onMarkPaid = vi.fn();
    render(<BillDetailSheet bill={bill()} today={TODAY} onClose={vi.fn()} onEdit={vi.fn()} onMarkPaid={onMarkPaid} onRemovePaid={vi.fn()} onDelete={vi.fn()} />);
    const primary = screen.getByRole("button", { name: "Mark Paid" });
    expect(primary).toHaveClass("btn", "btn-primary");
    expect(document.querySelectorAll(".btn-primary").length).toBe(1);
    fireEvent.click(primary);
    expect(onMarkPaid).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Delete Bill")).not.toHaveClass("btn-primary");
  });
});
