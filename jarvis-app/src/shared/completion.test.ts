import { describe, it, expect } from "vitest";
import { gradientLine, clearsProject, movedBy, celebrationLine, burstSize } from "./completion";

describe("the goal gradient", () => {
  it("counts down rather than reporting a percentage", () => {
    expect(gradientLine(1, 4)).toBe("Three left");
    expect(gradientLine(2, 4)).toBe("Two left");
    expect(gradientLine(3, 4)).toBe("One left");
  });

  it("goes back to a ratio when the finish line is still far off", () => {
    expect(gradientLine(2, 12)).toBe("2 of 12 Done");
  });

  it("names the last one as the last one", () => {
    expect(gradientLine(4, 4)).toBe("That was the last one");
  });

  it("says nothing about work that does not exist", () => {
    expect(gradientLine(0, 0)).toBe("");
  });
});

describe("what the tap moved", () => {
  it("reports the project the tick advanced", () => {
    expect(movedBy("Bridge Golf Event", 1, 4)).toEqual({
      projectTitle: "Bridge Golf Event", line: "Three left", cleared: false,
    });
  });

  it("flags the tick that cleared the whole thing", () => {
    expect(movedBy("Bridge Golf Event", 4, 4)?.cleared).toBe(true);
    expect(clearsProject(4, 4)).toBe(true);
    expect(clearsProject(3, 4)).toBe(false);
  });

  it("invents nothing for a loose task", () => {
    expect(movedBy(null, 1, 4)).toBeNull();
    expect(movedBy("Bridge Golf Event", 0, 0)).toBeNull();
  });
});

describe("certain reward, varying form", () => {
  it("is stable for a given completion: never a spin", () => {
    expect(celebrationLine("task", "abc")).toBe(celebrationLine("task", "abc"));
  });

  it("varies across completions so it cannot habituate", () => {
    const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => celebrationLine("task", s)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("never shouts", () => {
    for (const s of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
      const line = celebrationLine("task", s);
      expect(line).not.toContain("!");
      expect(line.toLowerCase()).not.toContain("crush");
      expect(line.toLowerCase()).not.toContain("amazing");
    }
  });

  it("says the bigger thing when the tick cleared the project", () => {
    expect(celebrationLine("task", "abc", true)).not.toBe(celebrationLine("task", "abc", false));
  });

  it("keeps the big two fixed: those moments do not need variety", () => {
    expect(celebrationLine("project", "x")).toBe("Project done");
    expect(celebrationLine("goal", "y")).toBe("Goal achieved");
  });
});

describe("the moment scales with what it was", () => {
  it("a loose tick and a finished project do not feel the same", () => {
    expect(burstSize(movedBy("P", 1, 4))).toBe("small");
    expect(burstSize(movedBy("P", 4, 4))).toBe("big");
    expect(burstSize(null)).toBe("small");
  });
});
