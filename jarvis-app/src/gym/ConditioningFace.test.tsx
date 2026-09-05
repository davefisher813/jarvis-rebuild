// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import ConditioningFace from "./ConditioningFace";
import CondReceipt from "./CondReceipt";
import type { Exercise } from "./types";

// THE FACE and THE RECEIPT (Check, Health, Stop, 2026-09-02). The clock is
// driven by performance.now under fake timers; the tests walk the lead-in,
// tap rounds, and read what the finish hands back.
describe("ConditioningFace", () => {
  let t = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => t);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const tick = (ms: number) => { t += ms; act(() => { vi.advanceTimersByTime(ms); }); };

  it("counts three in, then runs, marks rounds by the button, and finishes on the slide with the splits", () => {
    const onFinish = vi.fn();
    render(<ConditioningFace name="Cindy" cond={{ format: "amrap", capSec: 720 }} onFinish={onFinish} onCancel={() => {}} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Round" })).toBeNull();
    tick(3100);
    // The corner copies exist for landscape; the mid-ring line is the one read.
    const round = () => document.querySelector(".cf-round")!.textContent;
    expect(round()).toBe("Round 1");
    // An AMRAP counts down its window.
    expect(document.querySelector(".cf-num")).toHaveTextContent("12:00");
    tick(98_000);
    fireEvent.click(screen.getByRole("button", { name: "Round" }));
    expect(round()).toBe("Round 2");
    expect(document.querySelector(".cf-last")).toHaveTextContent("last 1:38");
    tick(104_000);
    fireEvent.click(screen.getByRole("button", { name: "Round" }));
    expect(document.querySelector(".cf-last")).toHaveTextContent("last 1:44");
    // Enter on the knob is the keyboard's slide.
    fireEvent.keyDown(screen.getByRole("button", { name: "Slide to finish" }), { key: "Enter" });
    expect(onFinish).toHaveBeenCalledTimes(1);
    const r = onFinish.mock.calls[0]![0];
    expect(r.splits.map(Math.round)).toEqual([98, 202]);
    expect(Math.round(r.elapsed)).toBe(202);
  });

  it("ends itself when the cap lands", () => {
    const onFinish = vi.fn();
    render(<ConditioningFace name="Cindy" cond={{ format: "amrap", capSec: 10 }} onFinish={onFinish} onCancel={() => {}} />);
    tick(3100);
    tick(10_200);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0]![0].elapsed).toBe(10);
  });

  it("an EMOM marks its own rounds and offers no Round button", () => {
    render(<ConditioningFace name="Power cleans" cond={{ format: "emom", capSec: 600, intervalSec: 60, rounds: 10 }} onFinish={() => {}} onCancel={() => {}} />);
    tick(3100);
    expect(screen.queryByRole("button", { name: "Round" })).toBeNull();
    expect(document.querySelector(".cf-round")).toHaveTextContent("Round 1 of 10");
    tick(61_000);
    expect(document.querySelector(".cf-round")).toHaveTextContent("Round 2 of 10");
  });

  // GYM-F-10 (2026-09-05, fork option B): the top-left button used to throw
  // the clock and every split away, twelve minutes in, with no confirm and no
  // undo. A logged set is never lost, so it stops and logs what happened. A
  // clock that never started still just closes.
  it("Cancel during the lead-in discards, because nothing has happened yet", () => {
    const onFinish = vi.fn(); const onCancel = vi.fn();
    render(<ConditioningFace name="Cindy" cond={{ format: "amrap", capSec: 720 }} onFinish={onFinish} onCancel={onCancel} />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("Stop mid-run logs the elapsed time and the splits so far, never discards them", () => {
    const onFinish = vi.fn(); const onCancel = vi.fn();
    render(<ConditioningFace name="Cindy" cond={{ format: "amrap", capSec: 720 }} onFinish={onFinish} onCancel={onCancel} />);
    tick(3100);
    tick(98_000);
    fireEvent.click(screen.getByRole("button", { name: "Round" }));
    tick(104_000);
    fireEvent.click(screen.getByRole("button", { name: "Round" }));
    // The button says what it now does.
    fireEvent.click(screen.getByText("Stop"));
    expect(onFinish).toHaveBeenCalledTimes(1);
    const r = onFinish.mock.calls[0]![0];
    expect(r.splits.map(Math.round)).toEqual([98, 202]);
    expect(Math.round(r.elapsed)).toBe(202);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Stop in the first second with nothing marked closes rather than logging an empty run", () => {
    const onFinish = vi.fn(); const onCancel = vi.fn();
    render(<ConditioningFace name="Cindy" cond={{ format: "amrap", capSec: 720 }} onFinish={onFinish} onCancel={onCancel} />);
    tick(3100);
    fireEvent.click(screen.getByText("Stop"));
    expect(onCancel).toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe("CondReceipt", () => {
  const ex: Exercise = { id: "e1", name: "Cindy", kind: "rounds", sets: [], note: "5 pull-ups, 10 push-ups, 15 squats", cond: { format: "amrap", capSec: 720 } };
  it("prints every round with its delta, and the score with the reps typed by hand", () => {
    const onChange = vi.fn();
    const { container } = render(<CondReceipt exercise={ex} entries={[{ id: "s1", r: 3, elapsed: 720, splits: [98, 202, 313] }]} onChange={onChange} />);
    expect(screen.getByText("AMRAP")).toBeInTheDocument();
    expect(screen.getByText("5 pull-ups, 10 push-ups, 15 squats")).toBeInTheDocument();
    const rows = container.querySelectorAll(".cr-table tr");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("1:44");
    expect(rows[1]!.querySelector(".cr-d.up")).toHaveTextContent("+6");
    expect(screen.getByText("Rounds + reps · 12:00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reps past the last round"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith([{ id: "s1", r: 3, elapsed: 720, splits: [98, 202, 313], extra: 12 }]);
  });
  it("says Not run yet before the clock has run", () => {
    render(<CondReceipt exercise={ex} entries={[]} onChange={() => {}} />);
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
  });

  // GYM-F-10: miss one Round tap and the receipt showed 6 with no way to make
  // it 7; a misfired attempt could only be fixed later in the finished workout.
  it("the round count is correctable in place", () => {
    const onChange = vi.fn();
    render(<CondReceipt exercise={ex} entries={[{ id: "s1", r: 6, elapsed: 720, splits: [100, 200] }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "More Rounds" }));
    expect(onChange).toHaveBeenCalledWith([{ id: "s1", r: 7, elapsed: 720, splits: [100, 200], done: undefined }]);
  });

  it("a misfired attempt can be deleted where it is", () => {
    const onChange = vi.fn();
    render(<CondReceipt exercise={ex} entries={[{ id: "s1", r: 6, elapsed: 720 }, { id: "s2", r: 2, elapsed: 120 }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete attempt 2" }));
    expect(onChange).toHaveBeenCalledWith([{ id: "s1", r: 6, elapsed: 720 }]);
  });
});
