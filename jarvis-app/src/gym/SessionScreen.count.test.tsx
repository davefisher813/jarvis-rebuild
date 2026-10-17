// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));

// ---------------------------------------------------------------------------
// PASS-OFF ITEM 9 (Dave 2026-10-09): "UP NEXT · SET 3" showing while the
// counter says "0 of 3 Sets" is confusing. The head, the header, the Now row's
// number and every planned row read one count now (stateWord.setCount); these
// are the cases a gym floor reaches. And ITEM 8: the Now row is brought into
// view above the Log button whenever a new set becomes Now.
// ---------------------------------------------------------------------------

const exercise: Exercise = {
  id: "e1", name: "Lateral Raise", kind: "weight_reps", unit: "lb", exerciseKey: "k-lat",
  sets: [{ id: "p1", w: 20, r: 10 }, { id: "p2", w: 20, r: 10 }, { id: "p3", w: 20, r: 10 }],
};

const live = (logged: SetEntry[]): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Arm Day", date: "2026-10-10", startedAt: 0, idx: 0,
  exercises: [{ exerciseId: "e1", name: "Lateral Raise", kind: "weight_reps", unit: "lb", exerciseKey: "k-lat", sets: logged }],
});

function renderScreen(logged: SetEntry[]) {
  return render(
    <SessionScreen onAdopt={() => {}} live={live(logged)} exercise={exercise} dayExercises={[exercise]}
      programDay={{ id: "d1", name: "Arm Day", exercises: [exercise] }} history={[]} library={[]}
      onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
      onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />,
  );
}
const kickers = (c: HTMLElement) => [...c.querySelectorAll(".set-chip-ghost .se-kick")].map((k) => k.firstChild?.textContent ?? "");

describe("one count on the logging screen", () => {
  beforeEach(() => { localStorage.clear(); });

  it("nothing logged: 0 of 3 Sets, Now is Set 1, the plan reads Set 2 and Set 3, and nothing says Up Next", () => {
    const { container } = renderScreen([]);
    expect(screen.getAllByText("0 of 3 Sets")).toHaveLength(2);
    expect(kickers(container)).toEqual(["Now · Set 1", "Set 2", "Set 3"]);
    expect(screen.queryByText(/Up Next/)).toBeNull();
  });

  it("one set logged: 1 of 3, Now is Set 2", () => {
    const { container } = renderScreen([{ id: "a", w: 20, r: 10 }]);
    expect(screen.getAllByText("1 of 3 Sets")).toHaveLength(2);
    expect(kickers(container)).toEqual(["Now · Set 2", "Set 3"]);
  });

  it("warm-ups logged move nothing: still 0 of 3, Now is Set 1", () => {
    const { container } = renderScreen([{ id: "w1", w: 10, r: 10, warmup: true }]);
    expect(screen.getAllByText("0 of 3 Sets")).toHaveLength(2);
    expect(kickers(container)[0]).toBe("Now · Set 1");
  });

  it("a skipped set comes off the target in both counts, and the Now row is the next set to lift", () => {
    const { container } = renderScreen([{ id: "s", w: 20, r: 10, skipped: true }]);
    expect(screen.getAllByText("0 of 2 Sets")).toHaveLength(2);
    expect(kickers(container)).toEqual(["Now · Set 1", "Set 2"]);
  });
});

describe("the Now row clears the Log button", () => {
  const original = Element.prototype.scrollIntoView;
  afterEach(() => { Element.prototype.scrollIntoView = original; });

  it("is scrolled the least amount into view when the screen opens on it", () => {
    const calls: { el: Element; arg: unknown }[] = [];
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) { calls.push({ el: this, arg }); } as typeof original;
    renderScreen([]);
    const now = calls.find((c) => c.el.classList.contains("setrow-now"));
    expect(now, "the Now row asked to be in view").toBeDefined();
    expect(now!.arg).toEqual({ block: "nearest" });
  });
});
