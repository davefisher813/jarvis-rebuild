// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import DayRow from "./DayRow";
import type { EventItem } from "../types";

// THE REMEMBER STAR ON AN EVENT ROW (2026-10-05, the perfect bar, as on a task row and a note row): an empty outline star on every fixed
// block was a control nobody asked for. The row wears it only while the event is remembered, and Remember is a line in the long press.
// The strand store is replaced by a double so the test owns both states.
const run = vi.fn(async () => {});
let on = false;
vi.mock("../../shared/EntityStar", () => ({
  default: ({ quiet }: { quiet?: boolean }) => (quiet && !on ? null : <button type="button" className={"row-star" + (on ? " on" : "")} aria-label="Forget this" />),
  useRemember: () => ({ on, run }),
}));

const ev = (): EventItem => ({ id: "e1", data: { title: "Client Call", start: "10:00", end: "11:00", date: "2026-05-26", category: "c1" } } as EventItem);
const row = () => render(<DayRow e={ev()} conflict={false} isNext={false} isPast={false} now={null} onOpen={() => {}} onShift={() => {}} onPushTomorrow={() => {}} onDelete={() => {}} />);

describe("DayRow: the Remember star", () => {
  it("draws no star on an event that is not remembered, and offers Remember on the long press", () => {
    on = false; run.mockClear();
    const { container } = row();
    expect(container.querySelector(".sched-row .row-star"), "an empty star on every row is gone").toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Client Call/ }));
    const sheet = document.querySelector(".action-sheet") as HTMLElement;
    fireEvent.click(within(sheet).getByText("Remember"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a remembered event wears the filled star, and its long press offers Forget", () => {
    on = true; run.mockClear();
    const { container } = row();
    expect(container.querySelector(".sched-row > .row-star.on")).not.toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Client Call/ }));
    expect(within(document.querySelector(".action-sheet") as HTMLElement).getByText("Forget")).toBeInTheDocument();
  });
});
