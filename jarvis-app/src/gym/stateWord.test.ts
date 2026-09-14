import { describe, it, expect } from "vitest";
import { setState, setKicker } from "./stateWord";

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
    expect(setKicker("next", 4)).toBe("Up Next · Set 4");
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
