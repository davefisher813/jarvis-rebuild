// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Quiet } from "../today/quiet";
import { deriveCompletionWindow, deriveSlipCategory, deriveTrainingWindow } from "./derive";
import { setCategoryRegistry } from "../shared/categories";
import type { WindowRow } from "./window";

// ROUND 2 REVIEW (2026-10-05), What JARVIS Knows' suggestion cards. "Pushed 6 Times in 30 Days" lit the 30 amber because the
// Quiet line reads "in N days" as a count running forward, and 30 is only the window's length; and "42 Finishes There, Out of
// Your Last 42" said one number twice. The card's evidence now says each thing once, with no stateless number heated.

const row = (over: Partial<WindowRow>): WindowRow => ({
  type: "task.completed", day: "2026-08-20", h: 10, category: null, n: null, flag: null, kind: null, ...over,
});
const done = (n: number, h: number): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ h, day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));

describe("moment evidence copy", () => {
  it("a slip card's sub carries no heated day count", () => {
    setCategoryRegistry([{ id: "cat-money", name: "Money", color: "green" }]);
    const pushes = Array.from({ length: 6 }, (_, i) => row({ type: "task.pushed", category: "cat-money", day: `2026-08-${String(i + 1).padStart(2, "0")}` }));
    const d = deriveSlipCategory(pushes)!;
    expect(d.sub).toBe("Pushed 6 Times This Month, the Most of Any Category");
    const { container } = render(<span><Quiet s={d.sub} /></span>);
    expect(container.querySelectorAll(".qd-soon, .qd-hot").length).toBe(0);
    expect(container.textContent).not.toMatch(/30/);
  });

  it("says the one figure when the band holds every finish, and both when it does not", () => {
    expect(deriveCompletionWindow(done(42, 10))!.sub).toBe("42 Finishes in That Window");
    const mixed = deriveCompletionWindow([...done(12, 10), ...done(4, 20)])!;
    expect(mixed.sub).toBe("12 Finishes There, Out of Your Last 16");
    const gym = Array.from({ length: 14 }, (_, i) => row({ h: 11, kind: "workout", day: `2026-08-${String(i + 1).padStart(2, "0")}` }));
    expect(deriveTrainingWindow(gym)!.sub).toBe("14 Sessions in That Window");
  });
});
