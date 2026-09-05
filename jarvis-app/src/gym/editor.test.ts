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
    expect(s).toContain("lastHeader(history, exercise.name, exercise.kind)");
    expect(s).toContain("lastSessionFor(history, exercise.name, exercise.kind)");
    expect(s).toMatch(/Best: \$\{header\.best\}/);
    expect(s).toContain("onMatchLast={lastHit");
    expect(s).toContain("onLog(entryFrom(src))");
  });

  it("the exercise sheet shows the same per-position reference while planning", () => {
    const s = src("ExerciseSheet.tsx");
    expect(s).toContain("lastSessionFor(history, name.trim(), kind)");
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
