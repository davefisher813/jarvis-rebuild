import { describe, it, expect } from "vitest";
import { defaultShortName, shortGoalName } from "./shortName";

describe("the goal's short name", () => {
  it("drops the leading verb and article and keeps two words", () => {
    expect(defaultShortName("Build a six-month runway")).toBe("Six-month runway");
    expect(defaultShortName("Make apartment aesthetic")).toBe("Apartment aesthetic");
    expect(defaultShortName("Ship the App Store Launch")).toBe("App Store");
    expect(defaultShortName("Build Massive Recruiting Pipeline")).toBe("Massive Recruiting");
    expect(defaultShortName("Get Paid On Time")).toBe("Paid On");
  });
  it("never eats the whole title", () => {
    expect(defaultShortName("Run")).toBe("Run");
    expect(defaultShortName("Run a")).toBe("A");
    expect(defaultShortName("")).toBe("");
    expect(defaultShortName("   ")).toBe("");
  });
  it("the typed short name wins, whitespace ignored", () => {
    expect(shortGoalName({ title: "Build Massive Recruiting Pipeline", short: "Recruiting Pipeline" })).toBe("Recruiting Pipeline");
    expect(shortGoalName({ title: "Build Massive Recruiting Pipeline", short: "   " })).toBe("Massive Recruiting");
    expect(shortGoalName({ title: "Build a six-month runway" })).toBe("Six-month runway");
  });
});
