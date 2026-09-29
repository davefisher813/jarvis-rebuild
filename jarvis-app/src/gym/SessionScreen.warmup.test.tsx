// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry, Workout } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));
import { showToast } from "../shared/toast";

// ---------------------------------------------------------------------------
// THE WARM-UP, SIMPLIFIED (2026-09-29). Dave: "Edit the warm up feature. It is
// way too complicated. It seems like it's on some automode but it's a huge
// pain to deal with. I should also be EASILY able to mark sets as warm ups and
// vice versa."
//
// His screenshot: two warm-ups of his own logged (180 x 8, 270 x 6), and under
// them two dashed "Warm-Up" rows the ramp still offered (160 x 5, 225 x 3),
// because the ramp was counted off by HOW MANY warm-ups were logged rather
// than by what was lifted. The ramp is a suggestion for the Now card now, and
// the card has a Work | Warm-Up pill.
// ---------------------------------------------------------------------------

// Plan 225 x 5, ramp on: the rack's ramp is 45 x 10, 90 x 8, 135 x 5, 190 x 3.
const bench = (over: Partial<Exercise> = {}): Exercise => ({
  id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", ramp: true,
  sets: [{ id: "p1", w: 225, r: 5 }, { id: "p2", w: 225, r: 5 }], ...over,
});

const live = (sets: SetEntry[]): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Push", date: "2026-09-29", startedAt: 0, idx: 0,
  exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets }],
});

function renderScreen(sets: SetEntry[] = [], over: Partial<Parameters<typeof SessionScreen>[0]> = {}, ex: Exercise = bench()) {
  return render(
    <SessionScreen
      live={live(sets)}
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

const cta = () => screen.getByRole("button", { name: /^Log / });
const pill = (name: "Work" | "Warm-Up") => within(screen.getByRole("group", { name: "Set type" })).getByRole("button", { name });
const warmed = (w: number, r: number, id = `w${w}`): SetEntry => ({ id, w, r, warmup: true });

describe("the Now card opens on the side the ramp says", () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(showToast).mockClear(); });

  it("Warm-Up, at the ramp's first step, before any working set", () => {
    renderScreen();
    expect(cta()).toHaveTextContent("Log Warm-Up 45 Lb × 10");
    expect(pill("Warm-Up")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Now · Warm-Up")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 1 weight")).toHaveValue(45);
  });

  it("with the ramp off it is Work, and the plan's numbers are what it names", () => {
    renderScreen([], {}, bench({ ramp: false }));
    expect(cta()).toHaveTextContent("Log 225 Lb × 5");
    expect(pill("Work")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Now · Warm-Up")).toBeNull();
  });

  it("goes to Work once a working set has been logged, ramp steps left or not", () => {
    renderScreen([{ id: "s1", w: 225, r: 5 }]);
    expect(cta()).toHaveTextContent("Log 225 Lb × 5");
    expect(pill("Work")).toHaveAttribute("aria-pressed", "true");
  });

  // THE BUG IN THE SCREENSHOT. Custom warm-ups no longer desync the ramp.
  it("reads the ramp against WHAT WAS LIFTED: 100 and 140 logged means the 190 is next, not the 45 and 90", () => {
    renderScreen([warmed(100, 8), warmed(140, 6)]);
    expect(cta()).toHaveTextContent("Log Warm-Up 190 Lb × 3");
  });

  it("and is Work when the athlete has warmed up past the whole ramp", () => {
    renderScreen([warmed(180, 8), warmed(270, 6)]);
    expect(cta()).toHaveTextContent("Log 225 Lb × 5");
    expect(pill("Work")).toHaveAttribute("aria-pressed", "true");
  });

  it("advances to the next step by itself as each warm-up lands", () => {
    const onLog = vi.fn();
    const { rerender } = renderScreen([], { onLog });
    fireEvent.click(cta());
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ w: 45, r: 10, warmup: true }));
    const ex = bench();
    rerender(
      <SessionScreen live={live([warmed(45, 10)])} exercise={ex} dayExercises={[ex]} programDay={{ id: "d1", name: "Push", exercises: [ex] }}
        history={[]} library={[]} onLog={onLog} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
        onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />,
    );
    expect(cta()).toHaveTextContent("Log Warm-Up 90 Lb × 8");
  });
});

describe("the stale dashed ramp rows are gone", () => {
  beforeEach(() => { localStorage.clear(); });

  it("draws no Warm-Up row of its own: the Now card and the plan's rows are all there is", () => {
    const { container } = renderScreen();
    // Two planned working sets: the Now card and one Up Next row. Not six.
    expect(container.querySelectorAll(".set-chip-ghost")).toHaveLength(2);
    expect(screen.queryByText("Warm-Up", { selector: ".se-kick" }), "no dashed Warm-Up kicker").toBeNull();
    expect(screen.getByText("Up Next · Set 2")).toBeInTheDocument();
  });

  it("does not offer the passed-over 160 and 225 under warm-ups already logged", () => {
    const { container } = renderScreen([warmed(180, 8), warmed(270, 6)]);
    expect(container.querySelectorAll(".set-chip-ghost")).toHaveLength(2);
    expect(screen.queryByText(/160 Lb × 5/)).toBeNull();
    expect(screen.queryByText(/225 Lb × 3/)).toBeNull();
    // The logged ones stay put as rows, named for what they are.
    expect(screen.getAllByText("Warm-Up · Done")).toHaveLength(2);
  });

  it("the rows after the Now card keep the WORK's numbers while the card is on Warm-Up", () => {
    renderScreen();
    const next = screen.getByText("Up Next · Set 2").closest(".set-chip-ghost") as HTMLElement;
    expect(next).toHaveTextContent("225 Lb × 5");
  });
});

describe("the Work | Warm-Up pill", () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(showToast).mockClear(); });

  it("flips to Work in one tap, at the plan's working numbers", () => {
    renderScreen();
    fireEvent.click(pill("Work"));
    expect(cta()).toHaveTextContent("Log 225 Lb × 5");
    expect(pill("Work")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Set 1 weight")).toHaveValue(225);
    expect(screen.getByText("Now · Set 1")).toBeInTheDocument();
  });

  it("flips back to Warm-Up at the next ramp step", () => {
    renderScreen();
    fireEvent.click(pill("Work"));
    fireEvent.click(pill("Warm-Up"));
    expect(cta()).toHaveTextContent("Log Warm-Up 45 Lb × 10");
  });

  it("Warm-Up with the ramp off opens at half the working weight on the rack, editable", () => {
    renderScreen([], {}, bench({ ramp: false }));
    fireEvent.click(pill("Warm-Up"));
    // 225 / 2 = 112.5, floored to what a 45 lb bar and 2.5 lb plates can build.
    expect(cta()).toHaveTextContent("Log Warm-Up 110 Lb × 8");
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "95" } });
    expect(cta()).toHaveTextContent("Log Warm-Up 95 Lb × 8");
  });

  it("the choice survives typing", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Set 1 reps"), { target: { value: "12" } });
    expect(cta()).toHaveTextContent("Log Warm-Up 50 Lb × 12");
    expect(pill("Warm-Up")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pill("Work"));
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "230" } });
    expect(cta()).toHaveTextContent("Log 230 Lb × 5");
    expect(pill("Work")).toHaveAttribute("aria-pressed", "true");
  });

  it("only the red button logs, and it writes warmup: true on the Warm-Up side", () => {
    const onLog = vi.fn();
    renderScreen([], { onLog });
    fireEvent.click(pill("Warm-Up"));
    expect(onLog, "the pill never logs").not.toHaveBeenCalled();
    fireEvent.click(cta());
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 45, r: 10, warmup: true });
    expect(vi.mocked(showToast).mock.calls[0]![0].message).toBe("Logged Warm-Up 45 Lb × 10");
  });

  it("and writes a plain working set on the Work side, with no warm-up flag", () => {
    const onLog = vi.fn();
    renderScreen([], { onLog });
    fireEvent.click(pill("Work"));
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0].warmup).toBeFalsy();
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 225, r: 5 });
  });

  it("a set can be called a warm-up on an exercise that has no ramp at all", () => {
    const onLog = vi.fn();
    renderScreen([], { onLog }, bench({ ramp: undefined }));
    fireEvent.click(pill("Warm-Up"));
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ warmup: true });
  });

  it("a warm-up does not move the place in the plan", () => {
    renderScreen([warmed(45, 10)], {}, bench({ ramp: false }));
    expect(screen.getByText("Now · Set 1")).toBeInTheDocument();
    expect(screen.getByText("Up Next · Set 2")).toBeInTheDocument();
  });
});

describe("the suggestion belongs to the work", () => {
  beforeEach(() => { localStorage.clear(); });
  const past: Workout = { id: "w0", data: { programId: "p", dayId: "d1", dayName: "Push", date: "2026-09-22", startedAt: 0, endedAt: 0,
    exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [
      { id: "h1", w: 225, r: 5, moved: "clean" }, { id: "h2", w: 225, r: 5, moved: "clean" }] }] } };

  it("shows on the Work side and hides on the Warm-Up side", () => {
    renderScreen([], { history: [past] });
    expect(screen.queryByText(/^Suggested/)).toBeNull();
    fireEvent.click(pill("Work"));
    // Work opens at last week's 225 x 5; the suggestion is 230 x 5.
    expect(screen.getByText(/^Suggested 230 Lb × 5/)).toBeInTheDocument();
  });
});
