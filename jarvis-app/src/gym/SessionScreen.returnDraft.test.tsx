// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry } from "./types";
import type { LiveSession } from "./liveSession";
import { nowDraftStore, readNowDraft } from "./sessionDrafts";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));

// THE LOGGING STANDARD ON THE NOW CARD (2026-10-17). Rule 4: Return in a
// field is the Log button, so a changed weight is tap, type, Return. Rule 8:
// what was typed and not yet logged survives a kill, keyed to this session
// and this exercise, spent by the log, and comes back unselected. Addendum
// 1: what the Log button writes is reported.

const logged: SetEntry[] = [{ id: "s1", w: 225, r: 5 }];
const exercise: Exercise = {
  id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb",
  sets: [{ id: "p1", w: 225, r: 5 }, { id: "p2", w: 225, r: 5 }],
};
const live = (): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Push", date: "2026-10-17", startedAt: 1000, idx: 0,
  exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: logged }],
});

function renderScreen(over: Partial<Parameters<typeof SessionScreen>[0]> = {}) {
  return render(
    <SessionScreen onAdopt={() => {}}
      live={live()} exercise={exercise} dayExercises={[exercise]} programDay={{ id: "d1", name: "Push", exercises: [exercise] }}
      history={[]} library={[]}
      onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}} onAddMidSession={() => {}}
      onFit={() => {}} onFinish={() => {}} onBack={() => {}}
      {...over}
    />,
  );
}

beforeEach(() => { localStorage.clear(); cleanup(); });

describe("rule 4: Return accepts and logs", () => {
  it("tap, type, Return logs what the field says, as the Log button would", () => {
    const onLog = vi.fn();
    renderScreen({ onLog });
    const weight = screen.getByLabelText("Set 2 Weight");
    fireEvent.change(weight, { target: { value: "230" } });
    expect(screen.getByRole("button", { name: "Log 230 Lb × 5" })).toBeInTheDocument();
    fireEvent.keyDown(weight, { key: "Enter" });
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 230, r: 5, state: "reported" });
  });
});

describe("addendum 1: the Log button stamps reported", () => {
  it("the big button's entry is reported, and the strip's old entries are left as they were", () => {
    const onLog = vi.fn();
    renderScreen({ onLog });
    fireEvent.click(screen.getByRole("button", { name: "Log 225 Lb × 5" }));
    expect(onLog.mock.calls[0]![0].state).toBe("reported");
    expect(logged[0]!.state, "a legacy entry is never back-stamped").toBeUndefined();
  });
});

describe("rule 8: nothing typed is lost", () => {
  it("writes the draft per keystroke, restores it on remount with the cursor in it but not selected, and the log spends it", () => {
    const store = nowDraftStore(1000, "e1");
    const first = renderScreen();
    fireEvent.change(screen.getByLabelText("Set 2 Weight"), { target: { value: "23" } });
    expect(readNowDraft(store)).toMatchObject({ w: "23", r: "5" });
    fireEvent.change(screen.getByLabelText("Set 2 Weight"), { target: { value: "235" } });
    expect(readNowDraft(store), "every keystroke, not the blur").toMatchObject({ w: "235", r: "5" });
    // The app is killed mid-typing.
    first.unmount();
    const onLog = vi.fn();
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    renderScreen({ onLog });
    const weight = screen.getByLabelText("Set 2 Weight");
    expect(weight).toHaveValue(235);
    // The cursor is there (Dave 2026-10-17), but his own half-typed number is
    // not selected, so one key does not wipe it.
    expect(weight).toHaveFocus();
    expect(select, "mid-typing, so not pre-selected").not.toHaveBeenCalled();
    select.mockRestore();
    expect(screen.getByRole("button", { name: "Log 235 Lb × 5" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log 235 Lb × 5" }));
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 235, r: 5 });
    expect(readNowDraft(store), "the log spent it").toBeNull();
  });
  it("a draft belongs to its own session and exercise", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Set 2 Weight"), { target: { value: "240" } });
    expect(readNowDraft(nowDraftStore(1000, "e1"))).toMatchObject({ w: "240" });
    expect(readNowDraft(nowDraftStore(1000, "e2"))).toBeNull();
    expect(readNowDraft(nowDraftStore(2000, "e1"))).toBeNull();
  });
});
