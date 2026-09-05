import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ONE EDITOR, NOT TWO -- D1, and LAST TIME -- D2 (Training Catalog V2,
// approved 2026-08-31). Source pins, same idiom as fsCard.test.ts: the
// engine behavior is tested in strip/liveSession/prs tests; these pin the
// UI wiring so a refactor cannot quietly bring the second editor back or
// unplug the ghosts.

const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("D1: the exercise sheet has one editor", () => {
  const sheet = src("ExerciseSheet.tsx");

  it("Quick Setup and its Generate button are gone", () => {
    expect(sheet).not.toContain("Quick Setup");
    expect(sheet).not.toContain("Generate Identical");
    expect(sheet).not.toContain("quickCount");
    expect(sheet).not.toContain("quickTarget");
  });

  it("the strip is edited in place through the bulk helpers", () => {
    expect(sheet).toContain("resizeStrip(s, n)");
    expect(sheet).toContain("applyToAll(kind, s, f.key, n)");
    expect(sheet).toContain("Edit All Sets");
  });

  it("a new exercise opens with the bulk editor out; an edit opens on the chips", () => {
    expect(sheet).toMatch(/useState\(mode === "new"\)/);
  });

  it("the summary row speaks the whole plan and its uniformity", () => {
    expect(sheet).toContain("targetLine(draft)");
    expect(sheet).toMatch(/isUniformStrip\(kind, sets\) \? "Uniform" : "Varies by set"/);
  });
});

describe("D2: last time is wired everywhere sets render", () => {
  it("the session screen shows the header line and per-set ghosts with tap-to-match", () => {
    const s = src("SessionScreen.tsx");
    // GYM-F-04 (2026-09-05): the EXERCISE, not its current name, so a
    // rename keeps the whole D2 surface pointed at the same history.
    expect(s).toContain("lastHeader(history, exercise, exercise.kind)");
    expect(s).toContain("lastSessionFor(history, exercise, exercise.kind)");
    expect(s).toMatch(/Best: \$\{header\.best\}/);
    expect(s).toContain("onMatchLast={lastHit");
    expect(s).toContain("onLog(entryFrom(src))");
  });

  it("the exercise sheet shows the same per-position reference while planning", () => {
    const s = src("ExerciseSheet.tsx");
    expect(s).toContain("lastSessionFor(history, { name: name.trim(), exerciseKey }, kind)");
    expect(s).toContain("lastFor={lastHit");
  });

  it("the switch honors Settings and defaults on", () => {
    expect(src("SessionScreen.tsx")).toContain("readGymSettings().showLast");
    expect(src("ExerciseSheet.tsx")).toContain("readGymSettings().showLast");
    expect(src("settings.ts")).toContain("showLast: true");
  });

  it("the strip renders the reference on chips and ghosts, quiet meta never a shout", () => {
    const s = src("SetStrip.tsx");
    expect(s).toMatch(/\{last && <div className="conn-meta">\{last\}<\/div>\}/);
    expect(s).toContain("set-last-act");
  });
});

describe("D7: the two live-log doors stamp, and nothing else invents stamps", () => {
  it("logSet and setLoggedSets carry the stamp; duplicates drop it", () => {
    const live = src("liveSession.ts");
    expect(live).toMatch(/logSet\([^)]*now: number = Date\.now\(\)/);
    expect(live).toMatch(/setLoggedSets\([^)]*now: number = Date\.now\(\)/);
    const strip = src("strip.ts");
    expect(strip).toContain("delete copy.at");
  });
});

// GYM-F-11 (2026-09-05): archiving your only program dropped you into the
// empty state, and the switcher (which holds the Archived shelf and its
// Restore) was reachable only from the Program row, which the empty state
// does not render. The way back was to create a throwaway program, restore
// the real one, then delete the throwaway.
describe("GYM-F-11: the archived shelf has a door from the empty state", () => {
  const flow = src("GymFlow.tsx");

  it("the no-program branch offers Restore an Archived Program when the shelf has anything on it", () => {
    expect(flow).toMatch(/allPrograms\.some\(\(p\) => p\.data\.archived\) && \(\s*<button className="btn btn-secondary" onClick=\{\(\) => setSwitcherOpen\(true\)\}>Restore an Archived Program<\/button>/);
  });

  it("the switcher itself renders outside the program branch, so that door actually opens", () => {
    // switcherEl sits in the shared tail with the sheets, not inside the
    // `program ? ... :` arms.
    expect(flow).toMatch(/\{doorPickEl\(\)\}\s*\{switcherEl\}/);
  });
});

// GYM-F-14 (2026-09-05): Back parks a session, it does not end it, but
// `reload` is also the resume path, so any program edit made from a parked
// session (a typo in the day's plan, a reorder, a pin) shoved the athlete
// straight back into the session the moment the write landed.
describe("GYM-F-14: a parked session stays parked", () => {
  const flow = src("GymFlow.tsx");

  it("reload skips the resume when the session was parked on purpose", () => {
    expect(flow).toMatch(/if \(!parkedRef\.current\) setLive\(readLive\(\)\)/);
  });

  it("Back parks rather than dropping the session on the floor", () => {
    expect(flow).toContain("onBack={parkSession}");
    expect(flow).toMatch(/const parkSession = \(\) => \{[^}]*parkedRef\.current = !!s;/);
  });

  it("every door that opens a session clears the parked flag", () => {
    expect(flow).toMatch(/const enterSession = \(s: LiveSession \| null\) => \{\s*parkedRef\.current = false;/);
    // The resume paths all go through that one door, never a bare setLive.
    for (const door of [
      "enterSession(existing);\n      showToast({ message: \"Resumed your open workout\" });",
      "isStillActive(existing, todayISO())) { enterSession(existing); return; }",
    ]) expect(flow).toContain(door);
    expect(flow).not.toMatch(/\{ setLive\(existing\); return; \}/);
  });

  it("the parked session is one tap away on the program page", () => {
    expect(flow).toMatch(/\{parkedLive && \(/);
    expect(flow).toContain("Resume {parkedLive.dayName}");
  });
});

// GYM-F-16 (2026-09-05): accepting a suggestion on a SWAPPED exercise
// rewrote the original lift's plan, because Swap keeps the original slot's
// exerciseId and acceptSuggestion trusted that id as a program identity.
describe("GYM-F-16: only the lift that is really in the plan moves the plan", () => {
  const flow = src("GymFlow.tsx");

  it("acceptSuggestion checks identity, not just the slot id", () => {
    expect(flow).toMatch(/const behind = entry \? programExerciseFor\(entry, day\) : undefined;\s*\n\s*if \(!behind \|\| behind\.id !== ex\.id\)/);
    // The old guard trusted the slot id alone.
    expect(flow).not.toContain("!day.exercises.some((e) => e.id === ex.id)");
  });

  it("a swapped or added exercise says the plan did not move rather than moving it silently", () => {
    expect(flow).toContain("is not in this day's plan, so nothing moved");
  });
});

// GYM-F-27 (2026-09-05): "Also Did · Band Pull-Aparts · Done 4 times"
// flickered to "Done 5 times" a moment later, because the receipt opened
// before the reload that puts the just-finished workout into `workouts`.
// ReceiptSheet's own comment already claimed the opposite order.
describe("GYM-F-27: the receipt counts the session it is the receipt for", () => {
  it("finish reloads before it opens the receipt", () => {
    const flow = src("GymFlow.tsx");
    expect(flow).toMatch(/await reload\(\);\s*\n\s*setReceipt\(\{ receipt: \{ \.\.\.r, goalHits \}/);
    // and never the other way round
    expect(flow).not.toMatch(/setReceipt\(\{ receipt[^\n]*\n\s*\} else \{\n\s*showToast\([^\n]*\n\s*\}\n\s*await reload\(\);/);
  });

  it("the sheet still reads the count out of the reloaded list", () => {
    expect(src("ReceiptSheet.tsx")).toContain("doneCount(workouts, name)");
  });
});

// GYM-F-30 (2026-09-05): History closed itself on the way into a lift, so
// Back from the lift detail landed on the program page instead of the list
// the athlete came from.
describe("GYM-F-30: Back from a lift returns to History", () => {
  const flow = src("GymFlow.tsx");

  it("opening a lift leaves History open underneath", () => {
    expect(flow).toContain("onOpenLift={(row) => setLiftDetailFor(row)}");
    expect(flow).not.toContain("onOpenLift={(row) => { setHistoryOpen(false); setLiftDetailFor(row); }}");
  });

  it("the lift branch is checked before the History branch, so it renders on top", () => {
    expect(flow.indexOf("if (liftDetailFor) {")).toBeLessThan(flow.indexOf("if (historyOpen) {"));
  });

  it("the two of them stacked are two levels deep, not one", () => {
    expect(flow).toMatch(/historyOpen && liftDetailFor\s*\n\s*\? 2/);
  });
});
