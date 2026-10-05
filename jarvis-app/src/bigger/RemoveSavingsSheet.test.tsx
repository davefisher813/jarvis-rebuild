// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RemoveSavingsSheet, { removeSavingsLines } from "./RemoveSavingsSheet";

const all = [{ d: "2026-07-01", amount: 500 }, { d: "2026-06-01", amount: 100 }];

describe("removeSavingsLines", () => {
  it("says the entry and what the total becomes, from the entries", () => {
    const { what, lead, before, after } = removeSavingsLines(all[0]!, all);
    expect(what).toBe("Saved $500 on Jul 1");
    expect([lead, before, after]).toEqual(["Saved Goes from", "$600", "$100"]);
  });
});

// THE CATALOG HARD GATE (Dave 2026-10-05): this sheet drew two stacked thin
// grey lines under "What Goes", the first only repeating the amount the card
// above already names, the second in sentence case with both amounts grey.
// One grey run under a title (§AK, R1), a fact that is one `.fact` span with
// its numbers in white `<b>` (R4), Title Case (H2), and nothing that repeats.
describe("RemoveSavingsSheet: the catalog", () => {
  const draw = () => render(<RemoveSavingsSheet entry={all[0]!} all={all} onRemove={() => {}} onCancel={() => {}} />);

  it("says what goes as ONE grey fact, not two stacked conn-meta lines", () => {
    draw();
    expect(document.querySelectorAll(".conn-meta")).toHaveLength(0);
    const facts = document.querySelectorAll(".facts");
    expect(facts).toHaveLength(1);
    const fact = facts[0]!.querySelectorAll(":scope > .fact");
    expect(fact).toHaveLength(1);
    expect(fact[0]!.textContent).toBe("Saved Goes from $600 to $100");
  });

  it("the two amounts are white numbers (<b>), never the grey made heavier", () => {
    draw();
    const bs = [...document.querySelectorAll(".facts .fact b")].map((b) => b.textContent);
    expect(bs).toEqual(["$600", "$100"]);
  });

  it("never repeats the amount the card above already names", () => {
    draw();
    // "$500" is the entry's own amount: it is said once (the card as "Saved $500 on Jul 1"), not again as "The $500 entry".
    expect(document.body.textContent!.match(/\$500/g)).toHaveLength(1);
  });

  it("is Title Case and carries no middle dot", () => {
    draw();
    const line = document.querySelector(".facts")!.textContent!;
    expect(line).not.toContain("\u00b7");
    for (const [i, w] of line.split(" ").entries()) {
      if (i > 0 && ["to", "from"].includes(w)) continue;
      expect(w[0], w).toBe(w[0]!.toUpperCase());
    }
  });
});

describe("RemoveSavingsSheet", () => {
  it("removes only on the destructive button; Cancel only cancels", () => {
    const onRemove = vi.fn();
    const onCancel = vi.fn();
    render(<RemoveSavingsSheet entry={all[0]!} all={all} onRemove={onRemove} onCancel={onCancel} />);
    expect(screen.getByRole("dialog", { name: "Remove $500 on Jul 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove Entry" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("locks both buttons while pending", () => {
    render(<RemoveSavingsSheet entry={all[0]!} all={all} pending onRemove={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Removing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
