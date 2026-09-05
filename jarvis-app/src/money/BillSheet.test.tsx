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
