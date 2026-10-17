// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import { readGymSettings, writeGymSettings } from "./settings";
import type { Exercise, SetEntry, Workout } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));

// ---------------------------------------------------------------------------
// THE BRIEF'S RULES ON THE SCREEN (2026-10-17, Progressive Overload Design v2,
// sections 1, 3, 4, 5 and 7). Every test renders the real screen and failed on
// the code before the rule it names: the program week's Back-Off flag reaching
// the engine, the in-session adjustment on the Now card, the block-level set
// offer with its conditions, and the published rule behind Why.
// ---------------------------------------------------------------------------

const bench = (over: Partial<Exercise> = {}): Exercise => ({
  id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "k-bench", equipment: "barbell",
  sets: [{ id: "p1", w: 275, r: 8 }, { id: "p2", w: 275, r: 8 }, { id: "p3", w: 275, r: 8 }], ...over,
});

const session = (date: string, sets: SetEntry[], ex: Exercise = bench()): Workout => ({
  id: "w" + date,
  data: { programId: "p", dayId: "d1", dayName: "Push", date, startedAt: 1, endedAt: 2,
    exercises: [{ exerciseId: ex.id, name: ex.name, kind: ex.kind, unit: ex.unit, exerciseKey: ex.exerciseKey, sets }] },
});

const live = (logged: SetEntry[], exs: Exercise[] = [bench()], idx = 0): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Push", date: "2026-10-17", startedAt: 0, idx,
  exercises: exs.map((e, i) => ({ exerciseId: e.id, name: e.name, kind: e.kind, unit: e.unit, exerciseKey: e.exerciseKey, sets: i === idx ? logged : [], plan: e.sets })),
});

function renderScreen(over: Partial<Parameters<typeof SessionScreen>[0]> = {}, ex: Exercise = bench(), logged: SetEntry[] = []) {
  return render(
    <SessionScreen onAdopt={() => {}}
      live={live(logged, [ex])}
      exercise={ex}
      dayExercises={[ex]}
      programDay={{ id: "d1", name: "Push", exercises: [ex] }}
      history={[]}
      library={[]}
      onLog={() => {}}
      onSetLogged={() => {}}
      onSkip={() => {}}
      onMove={() => {}}
      onSwap={() => {}}
      onAddMidSession={() => {}}
      onFit={() => {}}
      onFinish={() => {}}
      onBack={() => {}}
      {...over}
    />,
  );
}

const cta = () => screen.getByRole("button", { name: /^Log/ });
const allTop = session("2026-10-10", [{ id: "h1", w: 275, r: 8 }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }]);

beforeEach(() => { localStorage.clear(); });

describe("the program week's Back-Off flag reaches the engine", () => {
  it("with backOffWeek the first set opens on a lighter week, and the reason says why", () => {
    renderScreen({ history: [allTop], backOffWeek: true });
    // Prefill (Dave, 2026-10-17): the fields hold it; the line says why.
    expect(cta()).toHaveTextContent("Log 245 Lb × 6");
    expect(screen.getByText("Back-Off Week", { selector: ".se-nowline .fact" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Why" }));
    expect(screen.getByText("Lighter Week 245 × 6, 2 Sets, Nothing to Failure", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("2 Sets", { selector: ".fact" })).toBeInTheDocument();
  });

  it("without it the same log steps", () => {
    renderScreen({ history: [allTop] });
    expect(cta()).toHaveTextContent("Log 280 Lb × 6");
  });
});

describe("rule 7: once set one is logged, the rest of the sets are read against it", () => {
  it("set one two reps short: set two opens on the drop, the line says why, and the program never moves on it", () => {
    const onAcceptSuggestion = vi.fn();
    const onLog = vi.fn();
    renderScreen({ onAcceptSuggestion, onLog }, bench(), [{ id: "l1", w: 275, r: 6 }]);
    expect(cta()).toHaveTextContent("Log 260 Lb × 8");
    expect(screen.getByText("2 Reps Short of 8", { selector: ".se-nowline .fact" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Why" }));
    expect(screen.getByText("Set 1 275 × 6", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("Drop to 260 × 8 for the Rest", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("Set 1 of Today")).toBeInTheDocument();
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 260, r: 8 });
    expect(onAcceptSuggestion, "an in-session adjustment is never an accept").not.toHaveBeenCalled();
  });

  it("set one on target: no line at all for set two", () => {
    renderScreen({}, bench(), [{ id: "l1", w: 275, r: 8 }]);
    expect(screen.queryByText(/^Suggested /, { selector: ".fact" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Why" })).toBeNull();
  });
});

describe("rule 5: the set offer carries its conditions", () => {
  it("one more set is offered with no misses last week, and the reason says recovery is his call", () => {
    const h = [
      session("2026-10-09", [{ id: "a1", w: 275, r: 8 }, { id: "a2", w: 275, r: 8 }, { id: "a3", w: 275, r: 7 }]),
      session("2026-10-16", [{ id: "h1", w: 275, r: 8 }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8, moved: "missed" }]),
    ];
    renderScreen({ history: h });
    fireEvent.click(screen.getByRole("button", { name: "Why" }));
    expect(screen.getByText("Room for One More Set This Week", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("No Misses Last Week", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("Only If You Feel Recovered", { selector: ".fact" })).toBeInTheDocument();
  });
});

describe("rule 2: Each Set on Its Own, from the gym store", () => {
  it("with the setting on and twelve sessions behind the lift, a top position steps on its own", () => {
    writeGymSettings({ ...readGymSettings(), overloadTargets: "perSet" });
    const h = [
      ...Array.from({ length: 12 }, (_, i) => session(`2026-07-${String(i + 1).padStart(2, "0")}`, [{ id: "x1", w: 255, r: 8 }, { id: "x2", w: 255, r: 8 }])),
      session("2026-10-03", [{ id: "y1", w: 225, r: 8 }, { id: "y2", w: 225, r: 8 }]),
      session("2026-10-10", [{ id: "h1", w: 275, r: 8 }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 6 }]),
    ];
    renderScreen({ history: h });
    expect(cta()).toHaveTextContent("Log 280 Lb × 6");
    expect(screen.getByText("Sets 1 and 2 at the Top of 6 to 8", { selector: ".se-nowline .fact" })).toBeInTheDocument();
  });
});

describe("the rule is published in the app (brief section 7)", () => {
  it("Why opens the door to How Suggestions Work; the sheet names every rule in plain words and Done closes it", () => {
    renderScreen({ history: [allTop] });
    fireEvent.click(screen.getByRole("button", { name: "Why" }));
    fireEvent.click(screen.getByRole("button", { name: "How Suggestions Work" }));
    const sheet = screen.getByRole("dialog", { name: "How Suggestions Work" });
    const heads = [...sheet.querySelectorAll(".legal-h")].map((h) => h.textContent);
    expect(heads).toEqual(["The Range", "The Step", "Each Set on Its Own", "Two Strikes", "A Lighter Week", "Sets", "Inside a Session", "Your Marks", "Trust"]);
    expect(within(sheet).getByText("Nothing Moves Until You Log It")).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/\bAI\b/);
    expect(sheet.textContent).not.toMatch(/deload/i);
    // Every line is Title Case and short: no sentence boundary anywhere on the sheet.
    for (const p of sheet.querySelectorAll("p")) expect(p.textContent, p.textContent ?? "").not.toMatch(/\. [A-Z]/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "How Suggestions Work" })).toBeNull();
  });
});
