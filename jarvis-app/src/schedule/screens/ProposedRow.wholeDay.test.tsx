// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProposedRow, { HeldProposalRow } from "./ProposedRow";
import { RowChipWordsContext } from "./rowChip";
import type { PlanBlock } from "../planDay";

// THE WHOLE DAY SHOWS WHERE A ROW LIVES (Dave 2026-10-18, "Unfreeze"): a proposed task on Home's day card, and one held in a block, wear the
// same chip under the title as an event row, with the task's project after it; no area marked, no chip.
const block = (category: string): PlanBlock => ({ taskId: "t1", text: "Create Calder Invoice", category, start: "11:55", end: "12:40" });
const words = { event: () => null, task: (id: string) => (id === "t1" ? "Rebuild Calder App" : null) };

describe("proposed and held rows on the Whole Day", () => {
  it("a proposed task: chip then project, directly under the title", () => {
    const { container } = render(
      <RowChipWordsContext.Provider value={words}>
        <ProposedRow plain block={block("work")} open={false} onToggle={() => {}} onDuration={() => {}} onDrop={() => {}} />
      </RowChipWordsContext.Provider>,
    );
    expect(container.querySelector(".sched-body > .r-k .cat-chip")).toHaveTextContent("Work");
    expect(container.querySelector(".sched-body > .r-k .r-goal-t")).toHaveTextContent("Rebuild Calder App");
    expect(container.querySelector(".sched-cat")).toBeNull();
  });
  it("a task held in a block: the same line under its title", () => {
    const { container } = render(
      <RowChipWordsContext.Provider value={words}>
        <HeldProposalRow plain block={block("work")} onOpen={() => {}} />
      </RowChipWordsContext.Provider>,
    );
    expect(container.querySelector(".block-held-col .r-k .cat-chip")).toHaveTextContent("Work");
  });
  it("no area marked: no chip and no second line", () => {
    const { container } = render(<ProposedRow plain block={block("")} open={false} onToggle={() => {}} onDuration={() => {}} onDrop={() => {}} />);
    expect(container.querySelector(".r-k")).toBeNull();
  });
});
