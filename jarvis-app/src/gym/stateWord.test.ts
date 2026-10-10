import { describe, it, expect } from "vitest";
import { setState, setKicker, setCount, workNumbers } from "./stateWord";

// Health Push B, H-17 / R9 (2026-09-12): five words, derived from the row's
// place in the strip.
describe("setState", () => {
  it("names logged work done, the working set now, and the rest next", () => {
    expect(setState({}, 0, 2)).toBe("done");
    expect(setState({}, 1, 2)).toBe("done");
    expect(setState({}, 2, 2)).toBe("now");
    expect(setState({}, 3, 2)).toBe("next");
  });
  it("a ramp set is warm wherever it sits, and a skipped one is skipped", () => {
    expect(setState({ warmup: true }, 0, 1)).toBe("warm");
    expect(setState({ warmup: true }, 3, 1)).toBe("warm");
    expect(setState({ skipped: true }, 0, 1)).toBe("skipped");
    expect(setState({ skipped: true, warmup: true }, 0, 1)).toBe("skipped");
  });
  it("with every working set logged there is no now", () => {
    expect(setState({}, 4, -1)).toBe("done");
  });
});

describe("setKicker", () => {
  it("says the harness's words", () => {
    expect(setKicker("done", 1, true)).toBe("Set 1 · Done");
    expect(setKicker("now", 3)).toBe("Now · Set 3");
    // Pass-off item 9 (2026-10-10): a planned row says only its name; only
    // the Now row carries a state word.
    expect(setKicker("next", 4)).toBe("Set 4");
    expect(setKicker("warm", 1)).toBe("Warm-Up");
    expect(setKicker("warm", 1, true)).toBe("Warm-Up · Done");
    expect(setKicker("skipped", 2)).toBe("Skipped");
  });
});

// Part 3 wave 2: the drop is its own word.
describe("drop", () => {
  it("a drop segment reads as Drop, logged or planned, and never as a set number", () => {
    expect(setState({ drop: true }, 1, 1)).toBe("drop");
    expect(setKicker("drop", 2, true)).toBe("Drop · Done");
    expect(setKicker("drop", 2)).toBe("Drop");
  });
});

// PASS-OFF ITEM 9 (Dave 2026-10-09): "UP NEXT · SET 3" beside "0 of 3 Sets".
// One count feeds the head, the Now row's number and whether the plan is done,
// so they cannot say two things. The edge cases he can reach on a gym floor.
describe("one count: the head, the Now row and the plan agree", () => {
  const nowKicker = (logged: Parameters<typeof setCount>[0], planned: number) => setKicker("now", setCount(logged, planned).nowNo);

  it("with no set logged: 0 of 3, Now is Set 1, the rest are Set 2 and Set 3", () => {
    const c = setCount([], 3);
    expect([c.done, c.target]).toEqual([0, 3]);
    expect(nowKicker([], 3)).toBe("Now · Set 1");
    // The strip: the Now row, then the plan's two rows.
    expect(workNumbers([{}, {}, {}])).toEqual([1, 2, 3]);
    expect(setKicker("next", 2)).toBe("Set 2");
  });

  it("warm-ups count toward nothing and move no number", () => {
    const logged = [{ warmup: true }, { warmup: true }];
    const c = setCount(logged, 3);
    expect([c.done, c.target, c.nowNo, c.complete]).toEqual([0, 3, 1, false]);
    // Two logged warm-ups, then the Now row and the plan: Set 1, 2, 3.
    expect(workNumbers([...logged, {}, {}, {}])).toEqual([1, 1, 1, 2, 3]);
  });

  it("the Now card on its Warm-Up side does not take Set 1 from the plan", () => {
    // Row 0 is the Now card standing on Warm-Up; the plan's three follow.
    expect(workNumbers([{}, {}, {}, {}], 0)).toEqual([1, 1, 2, 3]);
  });

  it("a skipped set comes off the target and holds no number", () => {
    const logged = [{ skipped: true }];
    const c = setCount(logged, 3);
    expect([c.done, c.skipped, c.target, c.nowNo]).toEqual([0, 1, 2, 1]);
    expect(nowKicker(logged, 3)).toBe("Now · Set 1");
    // Skipped, then the Now row (Set 1), then the last planned set (Set 2).
    expect(workNumbers([...logged, {}, {}])).toEqual([1, 1, 2]);
    expect(setCount([{ skipped: true }, {}, {}], 3).complete).toBe(true);
  });

  it("logged work counts, and a drop rides its set without a number of its own", () => {
    const logged = [{}, { drop: true }, {}];
    const c = setCount(logged, 3);
    expect([c.done, c.target, c.nowNo]).toEqual([2, 3, 3]);
    expect(workNumbers([...logged, {}])).toEqual([1, 2, 2, 3]);
  });

  it("past the plan the count keeps going and the plan stays complete", () => {
    const c = setCount([{}, {}, {}, {}], 3);
    expect([c.done, c.target, c.complete]).toEqual([4, 3, true]);
  });

  it("a superset member counts only its own sets: each member's head is its own count", () => {
    // A1 and A2 alternate; each strip reads its own logged sets against its
    // own plan, so A2 at 0 of 3 says Now · Set 1 while A1 is at 1 of 3.
    expect(nowKicker([{}], 3)).toBe("Now · Set 2");
    expect(nowKicker([], 3)).toBe("Now · Set 1");
  });
});
