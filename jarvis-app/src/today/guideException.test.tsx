// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import YourDay from "./YourDay";
import type { EventItem } from "../schedule/types";

// THE TV GUIDE SHOWS THE RESOLVED TIME AND NOTHING ELSE (2026-10-01, on Dave's
// 2026-09-27 freeze). A day's exception to a protected block is already in the
// row's time. Its "Just Today" note and Back to Normal live on the Schedule
// tab and in the sheet; the strip for a skipped block sits above the card,
// outside it.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 0 });
});

const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-10-01", start, category: "orgB" } });
const moved = { s: 11 * 60, e: 12 * 60, label: "Lunch", id: "lunch", kind: "meal", justToday: true };

describe("an exception inside the guide", () => {
  it("the moving loop shows the day's time and no note", () => {
    const { container } = render(
      <YourDay events={[ev("a", "09:00")]} locked={[moved]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} onBackToNormal={() => {}} />,
    );
    const rows = container.querySelectorAll(".sched-ticker .sched-locked");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.querySelector(".sched-time")!.textContent).toBe("11:00AM");
      expect(r.textContent).not.toContain("Just Today");
      expect(r.textContent).not.toContain("Back to Normal");
    }
  });

  it("the held card, with every handler live, shows no note and no Back to Normal either", () => {
    const { container } = render(
      <YourDay events={[ev("a", "09:00")]} locked={[moved]} now="08:00" nowLabel="8:00" onSeeAll={() => {}}
        onOpenBlock={() => {}} onShiftBlock={() => {}} onBackToNormal={() => {}} />,
    );
    fireEvent.click(container.querySelector(".ticker-toggle") as HTMLElement);
    const row = container.querySelector(".sched-ticker .sched-locked")!;
    expect(row.querySelector(".sched-time")!.textContent).toBe("11:00AM");
    expect(row.textContent).not.toContain("Just Today");
    expect(screen.queryByText("Back to Normal")).toBeNull();
  });

  it("a skipped block is only the strip above the card, never a row in it", () => {
    const onBack = vi.fn();
    const { container } = render(
      <YourDay events={[ev("a", "09:00")]} locked={[]} skippedBlocks={[{ s: 720, e: 780, label: "Lunch", id: "lunch" }]}
        now="08:00" nowLabel="8:00" onSeeAll={() => {}} onBackToNormal={onBack} />,
    );
    expect(container.querySelector(".sched-ticker .skipped-blocks")).toBeNull();
    expect(container.querySelector(".sched-ticker .sched-locked")).toBeNull();
    fireEvent.click(screen.getByText("Back to Normal"));
    expect(onBack).toHaveBeenCalledWith("lunch");
  });
});
