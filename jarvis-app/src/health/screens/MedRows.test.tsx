// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MedRows from "./MedRows";
import type { MedDefEntry } from "../types";
import type { DoseRow } from "../meds";

// Health Push D, H-38 (2026-09-12): one Took It per med, and the ten-minute
// guard asks before logging the same med twice.
const MEDS: MedDefEntry[] = [
  { id: "m1", data: { category: "medication", name: "Vitamin D", amount: "2000 IU", order: 0, at: 1 } },
  { id: "m2", data: { category: "medication", name: "Iron", order: 1, at: 2 } },
];
const NOW = new Date("2026-09-13T09:00:00").getTime();
const dose = (id: string, at: number, medId: string): DoseRow => ({ id, at, medId, name: medId === "m1" ? "Vitamin D" : "Iron" });

describe("MedRows", () => {
  it("draws the amount in the row's grey, the last time in small caps, and one Took It per med", () => {
    render(<MedRows meds={MEDS} doses={[dose("d1", NOW - 3 * 3_600_000, "m1")]} now={NOW} onTook={() => {}} />);
    // §AM: the amount has no state, so it is the row's one grey, never the
    // medication area's blue on words; the last time is a neutral time (F5).
    expect(screen.getByText("2000 IU")).toHaveClass("fact");
    expect(screen.getByText("2000 IU")).not.toHaveClass("hblue");
    expect(screen.getByText(/^Last 6:00/)).toHaveClass("fact", "date");
    // CLEAN ROWS (Dave 2026-10-05): no capsule on a row. Took It is each row's swipe-left (the tray), and opens from the row.
    expect(document.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Took It" })).toHaveLength(2);
    expect(document.querySelectorAll(".row-ctx")).toHaveLength(0);
  });

  it("logs straight through when the last dose of that med is older than ten minutes", () => {
    const onTook = vi.fn();
    vi.useFakeTimers({ now: NOW });
    render(<MedRows meds={MEDS} doses={[dose("d1", NOW - 11 * 60_000, "m1")]} now={NOW} onTook={onTook} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Took It" })[0]!);
    expect(onTook).toHaveBeenCalledWith(MEDS[0]);
    expect(screen.queryByText(/Log Another/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("asks first inside ten minutes, and Never Mind logs nothing", () => {
    const onTook = vi.fn();
    vi.useFakeTimers({ now: NOW });
    render(<MedRows meds={MEDS} doses={[dose("d1", NOW - 4 * 60_000, "m1")]} now={NOW} onTook={onTook} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Took It" })[0]!);
    expect(onTook).not.toHaveBeenCalled();
    expect(screen.getByText("Log Another? · Vitamin D")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Never Mind" }));
    expect(onTook).not.toHaveBeenCalled();
    expect(screen.queryByText("Log Another? · Vitamin D")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("Log Another logs it, and another med is never guarded by this one's dose", () => {
    const onTook = vi.fn();
    vi.useFakeTimers({ now: NOW });
    render(<MedRows meds={MEDS} doses={[dose("d1", NOW - 4 * 60_000, "m1")]} now={NOW} onTook={onTook} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Took It" })[1]!);
    expect(onTook).toHaveBeenLastCalledWith(MEDS[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "Took It" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Log Another" }));
    expect(onTook).toHaveBeenLastCalledWith(MEDS[0]);
    expect(onTook).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

// The row is a door: tap it and its sheet holds Took It (filled), Edit and Remove.
describe("MedRows: the row's sheet", () => {
  it("opens from a tap with Took It first and filled, then Edit and Remove beneath it", () => {
    const onTook = vi.fn(); const onEdit = vi.fn(); const onRemove = vi.fn();
    vi.useFakeTimers({ now: NOW });
    const { container } = render(<MedRows meds={MEDS} doses={[]} now={NOW} onTook={onTook} onEdit={onEdit} onRemove={onRemove} />);
    fireEvent.click(screen.getByText("Iron").closest(".row")!);
    const sheet = container.querySelector(".sheet-scrim")!;
    expect(sheet.querySelector(".btn-primary")!.textContent).toBe("Took It");
    expect([...sheet.querySelectorAll(".btn-secondary")].map((b) => b.textContent)).toEqual(["Edit", "Remove", "Cancel"]);
    fireEvent.click(sheet.querySelector(".btn-danger-text")!);
    expect(onRemove).toHaveBeenCalledWith(MEDS[1]);
    vi.useRealTimers();
  });
});
