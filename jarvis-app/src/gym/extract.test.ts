import { describe, it, expect } from "vitest";
import { parseProgramExtract, coerceKind } from "./extract";

// The upload parser is tolerant but never inventive: bad entries drop, numbers
// clamp, and nothing usable means null, not a fabricated program.

const GOOD = JSON.stringify({
  name: "Summer Speed",
  days: [
    {
      name: "Tuesday · Speed",
      exercises: [
        { name: "40 Yard Dash", kind: "time_faster", unit: "sec", sets: 4, target: { v: 4.6 } },
        { name: "Broad Jump", kind: "height", unit: "in", sets: 3, target: { v: 100 } },
        { name: "Stretching", kind: "done", sets: 1 },
      ],
    },
    { name: "Thursday · Lift", exercises: [{ name: "Bench", kind: "weight_reps", unit: "lb", sets: 3, target: { w: 135, r: 8 } }] },
  ],
});

describe("parseProgramExtract", () => {
  it("parses a clean reply, keeping the user's words verbatim", () => {
    const p = parseProgramExtract(GOOD)!;
    expect(p.name).toBe("Summer Speed");
    expect(p.days.map((d) => d.name)).toEqual(["Tuesday · Speed", "Thursday · Lift"]);
    expect(p.days[0]!.exercises[0]).toMatchObject({ name: "40 Yard Dash", kind: "time_faster", unit: "sec", sets: 4, target: { v: 4.6 } });
    expect(p.days[0]!.exercises[2]!.kind).toBe("done");
  });

  it("strips code fences and surrounding prose", () => {
    expect(parseProgramExtract("Here you go:\n```json\n" + GOOD + "\n```\nEnjoy!")).not.toBeNull();
    expect(parseProgramExtract("Sure! " + GOOD)).not.toBeNull();
  });

  it("drops nameless exercises, clamps absurd numbers, fixes bad units", () => {
    const messy = JSON.stringify({
      days: [{
        name: "Day",
        exercises: [
          { name: "", kind: "reps", sets: 3 }, // nameless: dropped
          { name: "Bench", kind: "weight_reps", unit: "stone", sets: 900, target: { w: 999999, r: -3 } },
        ],
      }],
    });
    const p = parseProgramExtract(messy)!;
    expect(p.days[0]!.exercises).toHaveLength(1);
    const b = p.days[0]!.exercises[0]!;
    expect(b.unit).toBe("lb"); // unknown unit -> the kind's default
    expect(b.sets).toBe(20); // clamped
    expect(b.target!.w).toBe(2000); // clamped
    expect(b.target!.r).toBeUndefined(); // negative reps are not data
    expect(p.name).toBe("My Program"); // missing name gets the honest default
  });

  it("returns null rather than inventing a program", () => {
    expect(parseProgramExtract("I could not read the image, sorry.")).toBeNull();
    expect(parseProgramExtract("{}")).toBeNull();
    expect(parseProgramExtract(JSON.stringify({ days: [{ name: "D", exercises: [] }] }))).toBeNull();
    expect(parseProgramExtract("{broken json")).toBeNull();
  });
});

describe("coerceKind", () => {
  it("keeps valid kinds and falls back by evidence, never guessing a time direction", () => {
    expect(coerceKind("time_longer", {})).toBe("time_longer");
    expect(coerceKind("bench", { w: 135, r: 8 })).toBe("weight_reps");
    expect(coerceKind(undefined, { r: 12 })).toBe("reps");
    expect(coerceKind("sprint", { v: 40, t: 5 })).toBe("distance_time");
    expect(coerceKind(null, { v: 100 })).toBe("distance");
    expect(coerceKind("mystery", {})).toBe("done");
  });
});
