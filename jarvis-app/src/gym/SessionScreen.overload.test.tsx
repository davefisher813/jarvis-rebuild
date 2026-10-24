// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import SessionScreen from "./SessionScreen";
import { readGymSettings, writeGymSettings } from "./settings";
import type { Exercise, SetEntry, Workout } from "./types";
import type { LiveSession } from "./liveSession";
import type { LibraryEntry } from "./library";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));
import { showToast } from "../shared/toast";

// ---------------------------------------------------------------------------
// THE ACTIVE WORKOUT PASS, 2026-10-17 (defects A to O and section 10,
// PROGRESSIVE OVERLOAD). Every test here renders the real screen and failed on
// the code before the fix it names.
// ---------------------------------------------------------------------------

const bench = (over: Partial<Exercise> = {}): Exercise => ({
  id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "k-bench",
  sets: [{ id: "p1", w: 275, r: 8 }, { id: "p2", w: 275, r: 8 }, { id: "p3", w: 275, r: 8 }], ...over,
});
const plank: Exercise = { id: "e2", name: "Plank", kind: "time_longer", unit: "sec", exerciseKey: "k-plank", sets: [{ id: "q1", v: 60 }, { id: "q2", v: 60 }] };
const pullups: Exercise = { id: "e3", name: "Pull-Ups", kind: "reps", exerciseKey: "k-pull", sets: [{ id: "u1", r: 10 }, { id: "u2", r: 10 }] };

const session = (date: string, sets: SetEntry[], ex: Exercise = bench()): Workout => ({
  id: "w" + date,
  data: { programId: "p", dayId: "d1", dayName: "Push", date, startedAt: 1, endedAt: 2,
    exercises: [{ exerciseId: ex.id, name: ex.name, kind: ex.kind, unit: ex.unit, exerciseKey: ex.exerciseKey, sets }] },
});

const live = (logged: SetEntry[], exs: Exercise[] = [bench()], idx = 0): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Push", date: "2026-10-17", startedAt: 0, idx,
  exercises: exs.map((e, i) => ({ exerciseId: e.id, name: e.name, kind: e.kind, unit: e.unit, exerciseKey: e.exerciseKey, sets: i === idx ? logged : [], plan: e.sets })),
});

function renderScreen(over: Partial<Parameters<typeof SessionScreen>[0]> = {}, ex: Exercise = bench()) {
  return render(
    <SessionScreen onAdopt={() => {}}
      live={live([], [ex])}
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
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

beforeEach(() => { localStorage.clear(); vi.mocked(showToast).mockClear(); });

describe("A and B: every kind's Now card has its fields", () => {
  it("a reps-only lift's Now card is an editable reps field, selected on focus, with a numeric keypad", () => {
    renderScreen({}, pullups);
    const reps = screen.getByLabelText("Set 1 Reps") as HTMLInputElement;
    expect(reps).toHaveValue(10);
    expect(reps).toHaveAttribute("inputmode", "numeric");
    const select = vi.spyOn(reps, "select");
    fireEvent.focus(reps);
    expect(select, "tap selects the value").toHaveBeenCalled();
    fireEvent.change(reps, { target: { value: "12" } });
    expect(cta()).toHaveTextContent("Log 12 Reps");
    expect(screen.queryByLabelText("Set 1 Weight"), "no weight field on a reps lift").toBeNull();
  });

  it("a timed lift's Now card is a time field in the lift's unit, and the button names it", () => {
    renderScreen({}, plank);
    const time = screen.getByLabelText("Set 1 Time") as HTMLInputElement;
    expect(time).toHaveValue(60);
    expect(screen.getByText("Sec", { selector: ".se-grid-u" })).toBeInTheDocument();
    expect(cta()).toHaveTextContent("Log 60 Sec");
    fireEvent.change(time, { target: { value: "75" } });
    expect(cta()).toHaveTextContent("Log 75 Sec");
    expect(screen.queryByText("Empty"), "no Empty on a card with a field").toBeNull();
  });

  it("writes the time it names", () => {
    const onLog = vi.fn();
    renderScreen({ onLog }, plank);
    fireEvent.change(screen.getByLabelText("Set 1 Time"), { target: { value: "75" } });
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ v: 75 });
  });
});

describe("B and H: an empty set cannot be logged and earns nothing", () => {
  it("Log is disabled over empty fields and the click writes nothing", () => {
    const onLog = vi.fn();
    renderScreen({ onLog }, { ...plank, sets: [{ id: "q1" }] });
    expect(cta()).toBeDisabled();
    expect(cta()).toHaveTextContent("Log Set");
    fireEvent.click(cta());
    expect(onLog).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Set 1 Time"), { target: { value: "45" } });
    expect(cta()).toBeEnabled();
  });

  it("weight is never required (Dave 2026-10-24: Hanging Leg Raise, reps 12, would not log); reps are the set, and a dim button says why", () => {
    const onLog = vi.fn();
    renderScreen({ onLog }, bench({ sets: [{ id: "p1", r: 12 }] }));
    expect(cta(), "reps alone logs on any lift, one tap, from the prefilled values").toBeEnabled();
    expect(cta()).toHaveTextContent("Log Bodyweight × 12");
    expect(document.querySelector(".logbar-why"), "nothing to say when it can log").toBeNull();
    fireEvent.click(cta());
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0]![0]).toMatchObject({ r: 12, state: "reported" });
    expect(onLog.mock.calls[0]![0].w).toBeUndefined();
  });

  it("an emptied reps field disables it, and the card says what is missing in words", () => {
    renderScreen({}, bench({ sets: [{ id: "p1", r: 8, w: 135 }] }));
    expect(cta()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Set 1 Reps"), { target: { value: "" } });
    expect(cta()).toBeDisabled();
    expect(document.querySelector(".logbar-why")?.textContent).toBe("Add the Reps to Log");
    fireEvent.change(screen.getByLabelText("Set 1 Reps"), { target: { value: "5" } });
    expect(document.querySelector(".logbar-why")).toBeNull();
  });

  it("reps alone logs on bodyweight, and one rep is 1 Rep", () => {
    const onLog = vi.fn();
    renderScreen({ onLog }, bench({ equipment: "bodyweight", sets: [{ id: "p1", r: 1 }] }));
    expect(cta()).toBeEnabled();
    expect(cta()).toHaveTextContent("Log Bodyweight × 1");
    fireEvent.click(cta());
    expect(onLog).toHaveBeenCalledTimes(1);
  });
});

describe("E: the fields are named for the set he is on", () => {
  it("Set 2 after one logged set, Warm-Up on the warm-up side", () => {
    renderScreen({ live: live([{ id: "s1", w: 275, r: 8 }]) });
    expect(screen.getByLabelText("Set 2 Weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 2 Reps")).toBeInTheDocument();
    expect(screen.queryByLabelText("Set 1 Weight")).toBeNull();
  });
  it("Warm-Up Weight and Warm-Up Reps on the warm-up side", () => {
    renderScreen({}, bench({ ramp: true }));
    expect(screen.getByLabelText("Warm-Up Weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Warm-Up Reps")).toBeInTheDocument();
  });
});

describe("C: a planned row opens its editor and edits this session's plan", () => {
  it("tapping Set 2 opens the Set sheet on the planned numbers; Save writes the live plan, never the program", () => {
    const onFit = vi.fn();
    const l = live([]);
    renderScreen({ live: l, onFit });
    const row = screen.getByRole("button", { name: /^Set 2, 275 lb × 8, tap to edit$/ });
    expect(row.className).toContain("set-chip-ghost");
    fireEvent.click(row);
    // The sheet is named for the set, so its fields are "Set 2 weight" and "Set 2 reps".
    const w = screen.getByLabelText("Set 2 weight");
    expect(w).toHaveValue("275");
    fireEvent.change(w, { target: { value: "265" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onFit).toHaveBeenCalledTimes(1);
    const patch = onFit.mock.calls[0]![0] as { exercises: LiveSession["exercises"] };
    expect(patch.exercises[0]!.plan!.map((s) => s.w)).toEqual([275, 265, 275]);
    expect(patch.exercises[0]!.sets, "nothing is logged by editing the plan").toEqual([]);
  });

  it("the Now row is still the fields, not a door", () => {
    const onFit = vi.fn();
    renderScreen({ onFit });
    fireEvent.click(screen.getByText("Now · Set 1"));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("I: the warm-up opens on his own last warm-ups", () => {
  const withWarmups = session("2026-10-10", [
    { id: "h0", w: 135, r: 10, warmup: true }, { id: "h1", w: 185, r: 5, warmup: true },
    { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }, { id: "h4", w: 275, r: 8 },
  ]);

  it("prefills the first warm-up from last session, then the second, then goes to Work", () => {
    const { rerender } = renderScreen({ history: [withWarmups] });
    expect(cta()).toHaveTextContent("Log Warm-Up 135 Lb × 10");
    expect(screen.getByLabelText("Warm-Up Weight")).toHaveValue(135);
    expect(screen.queryByText(/^Suggested/), "his own history is not a suggestion").toBeNull();
    const ex = bench();
    const again = (sets: SetEntry[]) => rerender(
      <SessionScreen onAdopt={() => {}} live={live(sets)} exercise={ex} dayExercises={[ex]} programDay={{ id: "d1", name: "Push", exercises: [ex] }}
        history={[withWarmups]} library={[]} onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
        onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />,
    );
    again([{ id: "a", w: 135, r: 10, warmup: true }]);
    expect(cta()).toHaveTextContent("Log Warm-Up 185 Lb × 5");
    again([{ id: "a", w: 135, r: 10, warmup: true }, { id: "b", w: 185, r: 5, warmup: true }]);
    expect(cta(), "past his own warm-ups the card is on Work").toHaveTextContent(/^Log (?!Warm-Up)/);
  });

  it("with no history the ramp stands, and it is labelled Suggested", () => {
    renderScreen({}, bench({ ramp: true }));
    expect(cta()).toHaveTextContent("Log Warm-Up 45 Lb × 10");
    expect(screen.getByText("Suggested 45 Lb × 10")).toBeInTheDocument();
  });
});

describe("M: no schedule banner inside a workout", () => {
  it("the session screen neither mounts the hyperfocus guard nor draws its chip", () => {
    const src = read("SessionScreen.tsx");
    expect(src).not.toMatch(/useHyperfocusGuard|HyperfocusLine/);
    const { container } = renderScreen();
    expect(container.querySelector(".se-guard")).toBeNull();
  });
});

describe("O: the counters agree, on one progress line", () => {
  it("the facts line is the position, the same number the dots show, and the clock wears the now ink", () => {
    const exs = [bench(), plank, pullups];
    const l = live([], exs, 1);
    l.exercises[0]!.sets = [{ id: "z", w: 275, r: 8 }];
    renderScreen({ live: l, exercise: plank, dayExercises: exs, programDay: { id: "d1", name: "Push", exercises: exs } });
    expect(screen.getByText(/^Exercise 2 of 3/, { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByLabelText("Exercise 2 of 3")).toBeInTheDocument();
    expect(screen.queryByText(/of 3 Exercises/)).toBeNull();
    expect(screen.getByRole("timer").className).toBe("fact now");
    expect(document.querySelector(".se-count"), "no second count beside the dots").toBeNull();
    expect(document.querySelector(".se-prog .se-elapsed"), "the facts ride the dots' line").toBeTruthy();
  });

  it("the order is the board's: name, Now card, planned rows, then Details, chips, Best and Last", () => {
    const { container } = renderScreen({ history: [session("2026-10-10", [{ id: "h1", w: 275, r: 8 }])], onSetLoad: () => {} });
    const order = [".p3-q", ".setrow-now", ".set-chip-ghost.se-next", ".se-details", ".se-facts", ".se-hist", ".logbar"].map((sel) => container.querySelector(sel));
    order.forEach((el, i) => expect(el, `missing ${i}`).toBeTruthy());
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".se-hist .se-chip-best")).toHaveTextContent("Best275 Lb × 8");
    expect(container.querySelector(".logbar-row .se-add")).toHaveTextContent("Add Exercise");
  });
});

describe("J: the rest timer is in sight and can be started by hand", () => {
  it("renders directly under the strip, above This Workout", () => {
    const { container } = renderScreen({ live: { ...live([{ id: "s1", w: 275, r: 8 }]), restEndsAt: Date.now() + 90_000 } });
    const timer = container.querySelector(".rest-timer")!;
    expect(timer).toBeTruthy();
    const list = screen.getByText("This Workout", { selector: ".sh2 .t" });
    expect(timer.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING, "the timer comes before the list").toBeTruthy();
    const strip = container.querySelector(".set-strip")!;
    expect(strip.compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING, "and after the strip").toBeTruthy();
  });

  it("More offers Start Rest with four picks when no preset is running", () => {
    const onFit = vi.fn();
    renderScreen({ onFit });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Rest" }));
    expect(screen.getByRole("button", { name: "1 Min 30 Sec" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2 Min" }));
    const ends = (onFit.mock.calls[0]![0] as { restEndsAt: number }).restEndsAt;
    expect(ends - Date.now()).toBeGreaterThan(118_000);
    expect(ends - Date.now()).toBeLessThanOrEqual(120_000);
  });
});

describe("K: Add Exercise picks from the library first", () => {
  const entry: LibraryEntry = { key: "k-row", exerciseKey: "k-row", name: "Cable Row", kind: "weight_reps", unit: "lb", equipment: "cable", lastSets: [{ id: "x", w: 120, r: 12 }], lastUsed: 1 };

  it("opens the picker, and a pick lands with its key, unit, equipment and last strip", () => {
    const onAddMidSession = vi.fn();
    renderScreen({ library: [entry], onAddMidSession });
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.click(screen.getByText("Cable Row"));
    expect(onAddMidSession).toHaveBeenCalledTimes(1);
    const [draft, alsoOnDay] = onAddMidSession.mock.calls[0]!;
    expect(draft).toMatchObject({ name: "Cable Row", kind: "weight_reps", unit: "lb", exerciseKey: "k-row", equipment: "cable" });
    expect(draft.sets.map((s: SetEntry) => s.w)).toEqual([120]);
    expect(alsoOnDay).toBe(true);
  });

  it("a name the library does not know falls to the full sheet, prefilled", () => {
    // Neither his library nor the preloaded catalog (S9, 2026-10-16) knows a Zercher Squat.
    renderScreen({ library: [entry] });
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "Zercher Squat" } });
    fireEvent.click(screen.getByRole("button", { name: /Zercher Squat/ }));
    expect(screen.getByLabelText("Exercise name")).toHaveValue("Zercher Squat");
  });
});

describe("L: the copy reads once", () => {
  it("the last-time line says Use Last, and a skipped row does not say Skipped twice", () => {
    renderScreen({ live: live([{ id: "k", w: 275, r: 8, skipped: true }]), history: [session("2026-10-10", [{ id: "h1", w: 255, r: 1 }, { id: "h2", w: 255, r: 1 }])] });
    const use = screen.getByRole("button", { name: /same as last time$/ });
    expect(use).toHaveTextContent("Use Last");
    expect(use).not.toHaveTextContent("Match");
    const skipped = screen.getByRole("button", { name: /^Skipped, / });
    expect(within(skipped).getAllByText("Skipped")).toHaveLength(1);
    expect(skipped).toHaveTextContent("275 Lb × 8");
  });
});

describe("section 10: progressive overload on the Now card", () => {
  const allTop = session("2026-10-10", [{ id: "h1", w: 275, r: 8 }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }]);
  const plan = bench({ sets: [{ id: "p1", w: 275, r: 6 }, { id: "p2", w: 275, r: 8 }, { id: "p3", w: 275, r: 8 }], equipment: "barbell" });

  it("suggest (a stored choice, no longer the default): the fields open on last time, one line says Last and Suggested, Why cites his sets, Use fills the step", () => {
    writeGymSettings({ ...readGymSettings(), overloadApply: "suggest" });
    renderScreen({ history: [allTop] }, plan);
    expect(cta()).toHaveTextContent("Log 275 Lb × 8");
    // The board's one small line: Last in teal, then Suggested, then Use.
    const line = screen.getByText("Suggested 280 Lb × 6", { selector: ".fact" }).parentElement!;
    expect(line.className).toContain("se-nowline");
    expect(line.querySelector(".fact.cyan")).toHaveTextContent("Last 275 Lb × 8");
    fireEvent.click(screen.getByRole("button", { name: "Why" }));
    expect(screen.getByText("Last Time 275 × 8, 8, 8", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("All at the Top of 6 to 8", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("Step to 280 × 6", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("Expect 6 to 7", { selector: ".fact" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
    fireEvent.click(screen.getByRole("button", { name: /^Use 280 Lb × 6/ }));
    expect(cta()).toHaveTextContent("Log 280 Lb × 6");
    expect(screen.queryByRole("button", { name: /^Use 280/ }), "Use hides once the fields say it").toBeNull();
  });

  it("prefill, the default (Dave 2026-10-17): the first set opens on the step; the line says why and what to expect; no Use", () => {
    renderScreen({ history: [allTop] }, plan);
    expect(cta()).toHaveTextContent("Log 280 Lb × 6");
    expect(screen.getByLabelText("Set 1 Weight")).toHaveValue(280);
    const line = screen.getByText("All at the Top of 6 to 8", { selector: ".fact" }).parentElement!;
    expect(line.className).toContain("se-nowline");
    expect(within(line).getByText("Expect 6 to 7", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.queryByText("Suggested 280 Lb × 6"), "the fields already say it").toBeNull();
    expect(screen.queryByRole("button", { name: /^Use 280/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why" }));
    expect(screen.getByText("Last Time 275 × 8, 8, 8", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByText("Step to 280 × 6", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getAllByText("All at the Top of 6 to 8"), "the reason is drawn once").toHaveLength(1);
  });

  it("prefill's one-tap revert: Use Last puts last time back, and the step is offered with Use", () => {
    renderScreen({ history: [allTop] }, plan);
    fireEvent.click(screen.getByRole("button", { name: /^Use 275 Lb × 8, same as last time/ }));
    expect(cta()).toHaveTextContent("Log 275 Lb × 8");
    expect(screen.getByText("Suggested 280 Lb × 6", { selector: ".fact" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Use 280 Lb × 6/ }));
    expect(cta()).toHaveTextContent("Log 280 Lb × 6");
  });

  it("with Show Last off the revert is still one tap, to the numbers the set would have opened at", () => {
    writeGymSettings({ ...readGymSettings(), showLast: false });
    renderScreen({ history: [allTop] }, plan);
    fireEvent.click(screen.getByRole("button", { name: "Use 275 Lb × 8, without the step" }));
    expect(cta()).toHaveTextContent("Log 275 Lb × 8");
  });

  it("an untouched prefill logged is the accept: reported, the plan moves, nothing declined", () => {
    const onLog = vi.fn();
    const onAcceptSuggestion = vi.fn((_s: unknown) => null);
    renderScreen({ history: [allTop], onLog, onAcceptSuggestion }, plan);
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 280, r: 6, state: "reported" });
    expect(onLog.mock.calls[0]![0].declined).toBeUndefined();
    expect(onAcceptSuggestion).toHaveBeenCalledTimes(1);
    expect(onAcceptSuggestion.mock.calls[0]![0]).toMatchObject({ next: { w: 280, r: 6 } });
  });

  it("an override becomes the baseline: a changed weight is what logs, the plan does not move, and the step is kept as declined", () => {
    const onLog = vi.fn();
    const onAcceptSuggestion = vi.fn();
    renderScreen({ history: [allTop], onLog, onAcceptSuggestion }, plan);
    fireEvent.change(screen.getByLabelText("Set 1 Weight"), { target: { value: "275" } });
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 275, r: 6, state: "reported", declined: { w: 280, r: 6 } });
    expect(onAcceptSuggestion).not.toHaveBeenCalled();
  });

  it("changed reps at the step's weight is not an override: nothing declined, and the plan holds", () => {
    const onLog = vi.fn();
    const onAcceptSuggestion = vi.fn();
    renderScreen({ history: [allTop], onLog, onAcceptSuggestion }, plan);
    fireEvent.change(screen.getByLabelText("Set 1 Reps"), { target: { value: "5" } });
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 280, r: 5 });
    expect(onLog.mock.calls[0]![0].declined).toBeUndefined();
    expect(onAcceptSuggestion).not.toHaveBeenCalled();
  });

  it("never argues twice: a step he changed last time is offered, not filled in, and stays declined until he takes it", () => {
    const turnedDown = session("2026-10-10", [{ id: "h1", w: 275, r: 8, declined: { w: 280, r: 6 } }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }]);
    const onLog = vi.fn();
    renderScreen({ history: [turnedDown], onLog }, plan);
    expect(cta(), "his own numbers are the baseline").toHaveTextContent("Log 275 Lb × 8");
    expect(screen.getByText("Suggested 280 Lb × 6", { selector: ".fact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Use 280 Lb × 6/ })).toBeInTheDocument();
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 275, r: 8, declined: { w: 280, r: 6 } });
  });

  it("never argues twice, the other way: taking the offered step with Use is the accept", () => {
    const turnedDown = session("2026-10-10", [{ id: "h1", w: 275, r: 8, declined: { w: 280, r: 6 } }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }]);
    const onLog = vi.fn();
    const onAcceptSuggestion = vi.fn((_s: unknown) => null);
    renderScreen({ history: [turnedDown], onLog, onAcceptSuggestion }, plan);
    fireEvent.click(screen.getByRole("button", { name: /^Use 280 Lb × 6/ }));
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 280, r: 6 });
    expect(onLog.mock.calls[0]![0].declined).toBeUndefined();
    expect(onAcceptSuggestion).toHaveBeenCalledTimes(1);
  });

  it("a lighter week's first set does not warm up past itself: his own warm-up at or over the new top moves under it", () => {
    const heavyWarm = session("2026-10-10", [
      { id: "w1", w: 135, r: 8, warmup: true }, { id: "w2", w: 255, r: 3, warmup: true },
      { id: "h1", w: 275, r: 8 }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }]);
    const { rerender } = renderScreen({ history: [heavyWarm], backOffWeek: true }, plan);
    expect(cta()).toHaveTextContent("Log Warm-Up 135 Lb × 8");
    const again = (sets: SetEntry[]) => rerender(
      <SessionScreen onAdopt={() => {}} live={live(sets, [plan])} exercise={plan} dayExercises={[plan]} programDay={{ id: "d1", name: "Push", exercises: [plan] }}
        history={[heavyWarm]} library={[]} backOffWeek onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
        onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />,
    );
    again([{ id: "a", w: 135, r: 8, warmup: true }]);
    // 255 under a 245 top: 255 × 245 / 275 is 227.2, rounded down to the rack.
    expect(cta()).toHaveTextContent("Log Warm-Up 225 Lb × 3");
  });
});

describe("the cursor is already there (Dave 2026-10-17, answers 1 and 6)", () => {
  const allTop = session("2026-10-10", [{ id: "h1", w: 275, r: 8 }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }]);

  it("the Now card's first field is focused on open with its number selected, so a keystroke replaces it", () => {
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    renderScreen({ history: [allTop] });
    const weight = screen.getByLabelText("Set 1 Weight");
    expect(weight).toHaveFocus();
    expect(select.mock.contexts).toContain(weight);
    select.mockRestore();
  });

  it("a reps-only lift focuses its reps", () => {
    renderScreen({}, pullups);
    expect(screen.getByLabelText("Set 1 Reps")).toHaveFocus();
  });

  it("the next set takes the cursor once a set lands", () => {
    const ex = bench();
    const { rerender } = renderScreen({}, ex);
    screen.getByLabelText("Set 1 Weight").blur();
    rerender(
      <SessionScreen onAdopt={() => {}} live={live([{ id: "a", w: 275, r: 8 }], [ex])} exercise={ex} dayExercises={[ex]} programDay={{ id: "d1", name: "Push", exercises: [ex] }}
        history={[]} library={[]} onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
        onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />,
    );
    expect(screen.getByLabelText("Set 2 Weight")).toHaveFocus();
  });

  it("never under an open sheet", () => {
    renderScreen({ onCancel: () => {} });
    screen.getByLabelText("Set 1 Weight").blur();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Workout" }));
    expect(screen.getByLabelText("Set 1 Weight")).not.toHaveFocus();
  });
});

describe("log by voice, as a test (the Logging Standard, addendum 5; Alfred's ruling 2026-10-17)", () => {
  it("More opens it; the phrase is read back; his confirm writes a reported set with the big button's receipt and Undo", () => {
    const onLog = vi.fn();
    const onSetLogged = vi.fn();
    renderScreen({ onLog, onSetLogged });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Log by Voice" }));
    const field = screen.getByLabelText("Say or Type the Set");
    expect(field, "the cursor is in it, so the keyboard's mic is one tap").toHaveFocus();
    fireEvent.change(field, { target: { value: "yes" } });
    expect(screen.getByRole("button", { name: "Log Set" }), "a bare yes logs nothing").toBeDisabled();
    fireEvent.change(field, { target: { value: "Log 230 for 5" } });
    expect(screen.getByRole("status")).toHaveTextContent("Log 230 Lb × 5 on Bench Press");
    expect(onLog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Log Set" }));
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 230, r: 5, state: "reported" });
    expect(screen.queryByLabelText("Say or Type the Set"), "closed before the receipt").toBeNull();
    const receipt = vi.mocked(showToast).mock.calls.at(-1)![0];
    expect(receipt.message).toBe("Logged 230 Lb × 5");
    expect(receipt.actionLabel).toBe("Undo");
    receipt.onAction!();
    expect(onSetLogged).toHaveBeenCalledWith([], 0);
  });
});
