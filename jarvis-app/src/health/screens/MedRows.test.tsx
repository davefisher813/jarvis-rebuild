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
  it("draws the amount in medication blue, the last time, and one Took It per med", () => {
    render(<MedRows meds={MEDS} doses={[dose("d1", NOW - 3 * 3_600_000, "m1")]} now={NOW} onTook={() => {}} />);
    expect(screen.getByText("2000 IU")).toHaveClass("fact", "hblue");
    expect(screen.getByText(/^Last 6:00/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Took It/ })).toHaveLength(2);
  });

  it("logs straight through when the last dose of that med is older than ten minutes", () => {
    const onTook = vi.fn();
    vi.useFakeTimers({ now: NOW });
    render(<MedRows meds={MEDS} doses={[dose("d1", NOW - 11 * 60_000, "m1")]} now={NOW} onTook={onTook} />);
    fireEvent.click(screen.getByRole("button", { name: "Took It, Vitamin D" }));
    expect(onTook).toHaveBeenCalledWith(MEDS[0]);
    expect(screen.queryByText(/Log Another/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("asks first inside ten minutes, and Never Mind logs nothing", () => {
    const onTook = vi.fn();
    vi.useFakeTimers({ now: NOW });
    render(<MedRows meds={MEDS} doses={[dose("d1", NOW - 4 * 60_000, "m1")]} now={NOW} onTook={onTook} />);
    fireEvent.click(screen.getByRole("button", { name: "Took It, Vitamin D" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Took It, Iron" }));
    expect(onTook).toHaveBeenLastCalledWith(MEDS[1]);
    fireEvent.click(screen.getByRole("button", { name: "Took It, Vitamin D" }));
    fireEvent.click(screen.getByRole("button", { name: "Log Another" }));
    expect(onTook).toHaveBeenLastCalledWith(MEDS[0]);
    expect(onTook).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
