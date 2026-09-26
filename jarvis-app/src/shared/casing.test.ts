import { describe, it, expect } from "vitest";
import { capAfterNumber, liftTitle, lineCase, titleCase, workoutTitle } from "./casing";

// Dave 2026-08-20: "If a number leads a line the first letter after should be
// capitalized." He caught it on "14 emails need you".
describe("the number-lead capital", () => {
  it("capitalizes the word behind a leading number", () => {
    expect(capAfterNumber("14 emails need you")).toBe("14 Emails need you");
    expect(capAfterNumber("1 email needs you")).toBe("1 Email needs you");
    expect(capAfterNumber("55 days")).toBe("55 Days");
  });

  it("reads past a small word that joins two numbers: that is one quantity", () => {
    expect(capAfterNumber("2 of 5 done")).toBe("2 of 5 Done");
    expect(capAfterNumber("$500 of $2,000 saved")).toBe("$500 of $2,000 Saved");
  });

  it("but a small word NOT joining two numbers starts the line", () => {
    expect(capAfterNumber("88 at the peak")).toBe("88 At the peak");
    expect(capAfterNumber("3 of the crew")).toBe("3 Of the crew");
  });

  it("applies inside every dot segment, not just the first", () => {
    expect(capAfterNumber("2 events · 3 tasks due")).toBe("2 Events · 3 Tasks due");
    expect(capAfterNumber("55 days · no reply")).toBe("55 Days · no reply");
  });

  it("leaves lines that do not start with a number alone", () => {
    expect(capAfterNumber("Due in 3 days")).toBe("Due in 3 days");
    expect(capAfterNumber("Rent")).toBe("Rent");
  });

  it("never lowercases anything", () => {
    expect(capAfterNumber("3 Tasks Moved to Today")).toBe("3 Tasks Moved to Today");
  });

  it("needs a word to capitalize", () => {
    expect(capAfterNumber("14")).toBe("14");
    expect(capAfterNumber("")).toBe("");
  });
});

describe("titleCase is number-aware", () => {
  it("gives the edge slot to the word behind the number", () => {
    expect(titleCase("14 emails need you")).toBe("14 Emails Need You");
  });
  it("keeps small words down in the middle", () => {
    expect(titleCase("the state of the union")).toBe("The State of the Union");
  });
  it("keeps existing capitals inside a word", () => {
    expect(titleCase("book AA1187 now")).toBe("Book AA1187 Now");
  });
});

// DAVE, 2026-09-17, photographing a program whose six days read "Push Day 1",
// "Leg Day", "Pull Day 1", "Pull day 2": "workouts doesn't follow title case
// rules. Fix it. Also, all workout titles should be title cased as well."
describe("workoutTitle", () => {
  it("cases a day name typed in a hurry", () => {
    expect(workoutTitle("Pull day 2")).toBe("Pull Day 2");
    expect(workoutTitle("push day 1")).toBe("Push Day 1");
    expect(workoutTitle("leg day")).toBe("Leg Day");
  });

  it("leaves a name that is already cased exactly as it is", () => {
    expect(workoutTitle("Auxiliary Day")).toBe("Auxiliary Day");
    expect(workoutTitle("5 Day Program")).toBe("5 Day Program");
  });

  // It runs at the write door AND at the read, so it has to survive being
  // applied to its own output.
  it("is idempotent", () => {
    expect(workoutTitle(workoutTitle("pull day 2"))).toBe("Pull Day 2");
  });

  // An acronym an athlete typed on purpose is not a casing mistake.
  it("keeps capitals that are already inside a word", () => {
    expect(workoutTitle("AMRAP finisher")).toBe("AMRAP Finisher");
  });
});

// DAVE, 2026-09-17, on a library reading "Bulgarian split squats / Calf raise
// machine / Glute kickbacks": "Case those too please it's fine for this."
describe("liftTitle", () => {
  it("cases an exercise typed in a hurry", () => {
    expect(liftTitle("Bulgarian split squats")).toBe("Bulgarian Split Squats");
    expect(liftTitle("calf raise machine")).toBe("Calf Raise Machine");
    expect(liftTitle("glute kickbacks")).toBe("Glute Kickbacks");
  });

  it("keeps an acronym the athlete typed on purpose", () => {
    expect(liftTitle("RDLs (dumbbell)")).toBe("RDLs (Dumbbell)");
    expect(liftTitle("AMRAP push ups")).toBe("AMRAP Push Ups");
  });

  it("keeps small words down in the middle, like every other title in the app", () => {
    expect(liftTitle("good morning to the bar")).toBe("Good Morning to the Bar");
  });

  it("is idempotent, because it runs at the write door and at the read", () => {
    expect(liftTitle(liftTitle("bulgarian split squats"))).toBe("Bulgarian Split Squats");
  });

  // Casing a name never changes which lift it is: the fallback library key
  // lowercases the name before it hashes it, which is why display-time casing
  // is safe at all.
  it("does not change the identity a fallback key is derived from", () => {
    const key = (n: string) => n.trim().toLowerCase() + "\u0000weight_reps";
    expect(key(liftTitle("bulgarian split squats"))).toBe(key("bulgarian split squats"));
  });
});

// Dave 2026-09-26 (the pass-off): "After dots and numbers is always title
// casing", "Make sure all cases are addressed (ex: 45 min v 45 Min)".
describe("the whole rule: every line the app writes is Title Case", () => {
  it("cases the start of the line, after every dot, and after every number", () => {
    expect(lineCase("saves ~8 min \u00b7 never your main lift")).toBe("Saves ~8 Min \u00b7 Never Your Main Lift");
    expect(lineCase("Est 1RM \u00b7 Epley, not a tested max \u00b7 lb")).toBe("Est 1RM \u00b7 Epley, Not a Tested Max \u00b7 Lb");
    expect(lineCase("45 min")).toBe("45 Min");
    expect(lineCase("12 min left \u00b7 2 of 6 logged")).toBe("12 Min Left \u00b7 2 of 6 Logged");
  });
  it("keeps small words lowercase mid-phrase, and capitalizes the edges", () => {
    expect(lineCase("Sep 14 \u00b7 food and beverage store")).toBe("Sep 14 \u00b7 Food and Beverage Store");
    expect(lineCase("2 of 5 lifts")).toBe("2 of 5 Lifts");
    expect(lineCase("due in 12 days")).toBe("Due in 12 Days");
    expect(lineCase("310 of 325 lb at 1+ reps")).toBe("310 of 325 Lb at 1+ Reps");
    expect(lineCase("in")).toBe("In");
  });
  it("leaves a compact clock or count alone, and keeps capitals it finds", () => {
    expect(lineCase("0m of 3h 30m")).toBe("0m of 3h 30m");
    expect(lineCase("best 1:32:05 \u00b7 10x")).toBe("Best 1:32:05 \u00b7 10x");
    expect(lineCase("RDLs and AMRAP at the JARVIS gym")).toBe("RDLs and AMRAP at the JARVIS Gym");
    expect(lineCase("one-rep max")).toBe("One-Rep Max");
    expect(lineCase("use last time's 25 min")).toBe("Use Last Time's 25 Min");
  });
  it("is idempotent and keeps the spacing it was given", () => {
    const once = lineCase(" waiting 3 days \u00b7 nudged twice ");
    expect(once).toBe(" Waiting 3 Days \u00b7 Nudged Twice ");
    expect(lineCase(once)).toBe(once);
    expect(lineCase("")).toBe("");
  });
});
