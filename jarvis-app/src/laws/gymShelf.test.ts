import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// FOUR RULINGS FROM DAVE'S 2026-09-17 PASS OVER THE PROGRAM AND HEALTH
// SCREENS. Each one is a thing the code did that he had to photograph, so each
// one gets a test that goes red if it comes back.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

const GYM_FLOW = read("gym/GymFlow.tsx");

// ---------------------------------------------------------------------------
// 1. NO LONE NAVIGATIONAL PILL.
//
// "Your lifts / all programs breaks the rule of stand alone small pill.
//  Combine them into a nice clean container that matches other containers in
//  the health section."
//
// Two one-row cards, half a screen apart, each holding a single door: that is
// the floating-pill shape the 2026-08-31 count-pill wave was supposed to end.
// ---------------------------------------------------------------------------
describe("the program screen's doors share one shelf", () => {
  it("renders Your Lifts inside the All Programs card", () => {
    // The shelf: the All Programs row, then the lifts row, then the card
    // closes. If someone pulls LiftsRow back out into its own card, the row
    // stops being adjacent to All Programs and this goes red.
    const shelf = /All Programs<\/div>[\s\S]{0,900}?<LiftsRow[\s\S]{0,120}?<\/div><\/div>/;
    expect(shelf.test(GYM_FLOW), "All Programs and Your Lifts are not in one card").toBe(true);
  });

  it("spends one LiftsRow, so the two branches cannot drift apart", () => {
    // With a program it rides the shelf; with none there is no shelf to ride
    // and it keeps its own card. Both spend the same component.
    expect(GYM_FLOW.match(/<LiftsRow\b/g) ?? []).toHaveLength(2);
    expect(GYM_FLOW).toContain("{!program && library.length > 0 && (");
  });

  it("gives the shelf's rows facts, not a hand-joined sentence", () => {
    // G3: the CSS draws the middot, so no string carries one. The All
    // Programs meta line used to `.join(" · ")` its own.
    expect(GYM_FLOW).not.toContain('.filter(Boolean).join(" · ")');
  });
});

// ---------------------------------------------------------------------------
// 2. A WORKOUT'S TITLE IS TITLE CASE.
//
// "workouts doesn't follow title case rules. Fix it. Also, all workout titles
//  should be title cased as well."
// ---------------------------------------------------------------------------
describe("every place a workout names itself is cased", () => {
  const SITES: [string, string[]][] = [
    ["gym/GymFlow.tsx", [
      "workoutTitle(day.name)",
      "workoutTitle(program.data.name)",
      "workoutTitle(w.data.dayName)",
      "workoutTitle(parkedLive.dayName)",
    ]],
    ["gym/HistoryScreen.tsx", ["workoutTitle(r.workout.data.dayName)"]],
    ["gym/SessionScreen.tsx", ["workoutTitle(live.dayName)"]],
    ["gym/ReceiptSheet.tsx", ["workoutTitle(dayName)"]],
  ];

  it("cases the name at every screen that prints it", () => {
    const missing: string[] = [];
    for (const [file, calls] of SITES) {
      const src = read(file);
      for (const c of calls) if (!src.includes(c)) missing.push(file + ": " + c);
    }
    expect(missing, "a name typed before this shipped reads wrong here").toEqual([]);
  });

  // The read alone would leave the store holding the uncased spelling, so
  // anything reading the raw name later disagrees with the screen.
  it("cases the name at the write door too", () => {
    expect(GYM_FLOW).toContain("onSave(workoutTitle(v.trim()))");
  });

  // A WORKOUT'S TITLE AND A LIFT'S NAME ARE CASED BY DIFFERENT FUNCTIONS
  // (2026-09-17, the same afternoon: "Case those too"). Same spelling rule,
  // different risk: a lift's name is its identity when it has no
  // exerciseKey, so liftTitle carries the rule about never casing a value on
  // its way into a comparison. Keeping them apart is what makes that rule
  // readable at each call site.
  it("cases a lift's name with the function that documents the identity risk", () => {
    expect(GYM_FLOW).toContain("liftTitle(exercise.name)");
    expect(GYM_FLOW).not.toContain("workoutTitle(exercise.name)");
  });
});

// ---------------------------------------------------------------------------
// 2b. AN EXERCISE'S NAME IS TITLE CASE TOO, and casing it must never reach a
// lookup. "Bulgarian split squats / Calf raise machine / Glute kickbacks" was
// the library Dave was looking at.
//
// The danger this pins: the lift detail screen finds its record by matching
// `r.name === liftDetailFor.name` across a LIBRARY row and a RECORD. Case one
// side and the screen silently never finds its match -- no error, no warning,
// just a note and a muscle that stopped appearing.
// ---------------------------------------------------------------------------
describe("casing a lift's name never reaches a comparison", () => {
  it("leaves the by-name lookups reading raw record text", () => {
    // The three that exist today, each comparing a row or a record name
    // against the name the detail screen was opened with.
    expect(GYM_FLOW).toContain("r.name === liftDetailFor.name");
    expect(GYM_FLOW).toContain("e.name === liftDetailFor.name");
    // Nothing anywhere compares a CASED name to anything. `===` next to a
    // liftTitle call is the shape of the silent failure this law is about.
    const cased = [...GYM_FLOW.matchAll(/liftTitle\([^)]*\)\s*===|===\s*liftTitle\(/g)].map((m) => m[0]);
    expect(cased, "a cased name will never equal the raw one on the record").toEqual([]);
  });

  it("never cases the identity a library key is derived from", () => {
    // fallbackKey(name, kind) IS the key for a lift with no exerciseKey.
    const lib = read("gym/library.ts");
    expect(lib).not.toContain("liftTitle");
    expect(read("gym/libraryEdit.ts")).not.toContain("liftTitle");
    expect(read("gym/identity.ts")).not.toContain("liftTitle");
  });

  it("cases the name at every screen that prints it", () => {
    const SITES: [string, string][] = [
      ["gym/LibraryPage.tsx", '<div className="ex-name">{liftTitle(r.name)}</div>'],
      ["gym/LibraryPickSheet.tsx", "{liftTitle(entry.name)}"],
      ["gym/HistoryScreen.tsx", '<div className="conn-name truncate">{liftTitle(r.name)}</div>'],
      ["gym/LiftDetailScreen.tsx", "{liftTitle(name)}"],
      ["gym/SessionScreen.tsx", "{liftTitle(exercise.name)}"],
      ["gym/ReceiptSheet.tsx", "{liftTitle(p.name)}"],
      ["gym/CondReceipt.tsx", "liftTitle(exercise.name)"],
      ["gym/DuplicateReview.tsx", "{liftTitle(row.name)}"],
      ["gym/BatchSheet.tsx", "{liftTitle(ch.name)}"],
      ["gym/FitSheet.tsx", "{liftTitle(o.name)}"],
    ];
    const missing = SITES.filter(([f, call]) => !read(f).includes(call)).map(([f]) => f);
    expect(missing, "these still print the raw spelling").toEqual([]);
  });

  it("cases the name at the doors that mint or rewrite one", () => {
    expect(read("gym/ExerciseSheet.tsx")).toContain("name: liftTitle(name.trim())");
    expect(read("gym/LibraryPage.tsx")).toContain("onRename(r, liftTitle(draft.trim()))");
    expect(read("gym/LibraryPickSheet.tsx")).toContain("onFreeText(liftTitle(q.trim()))");
    expect(GYM_FLOW).toContain("const cased = liftTitle(name);");
  });
});

// ---------------------------------------------------------------------------
// 3. THE WEEK CARD'S LABELS AGREE WITH EACH OTHER.
//
// Working Sets and Training Time sit two rows under it in the same type at the
// same size. "workouts" alone was lowercase, which reads as a typo.
// ---------------------------------------------------------------------------
describe("the Last 7 Days card", () => {
  it("labels its count in the same case as the two beside it", () => {
    const body = read("brain/HealthBody.tsx");
    expect(body).toContain('"Workout" : "Workouts"');
    expect(body).toContain("<span>Working Sets</span>");
  });
});

// ---------------------------------------------------------------------------
// 4. THE MIDDLE RANGE IS THIRTY DAYS.
//
// "28 days makes no sense. Change to 30." Four weeks is a tidy number of
// weeks, which is not a unit anybody thinks in outside a spreadsheet.
// ---------------------------------------------------------------------------
describe("the insight ranges", () => {
  it("offers 30 days, and nothing anywhere still says 28", () => {
    const analytics = read("insights/analytics.ts");
    expect(analytics).toContain('"7d" | "30d" | "90d" | "custom"');
    expect(analytics).toContain('key === "30d" ? 30');
    for (const f of ["insights/AllDataPage.tsx", "insights/InsightsPage.tsx", "insights/ExportSheet.tsx", "brain/CategoryDetail.tsx"]) {
      expect(read(f), f + " still offers the four-week range").not.toMatch(/28d|28 Days/);
    }
  });
});

// ---------------------------------------------------------------------------
// DAVE'S 2026-09-18 PASS, four more photographs.
// ---------------------------------------------------------------------------

// "Arrows are out of place." Measured at 393px: a Recent row inside a swipe
// wrapper was 220px wide in a 361px card, so its trailing chevron sat 154px
// short of the card's right edge while the same chevron on an unswipeable
// Days row sat 13px from it.
//
// .swipe-row is a flex container and its child is a flex item, which defaults
// to flex: 0 1 auto -- it shrink-wraps to its content instead of filling the
// line. The lists carrying .task-row never showed it because that class sets
// its own width; the gym's lists use the plain .row, and did.
describe("a swiped row is the width of the list it is in", () => {
  it("makes the swipe wrapper's child fill it", () => {
    const ds = read("styles/jarvis-design-system.css");
    expect(ds).toContain(".swipe-row { display: flex; align-items: stretch; overflow: hidden; }");
    expect(ds, "and its one child is the whole row").toContain(".swipe-row > * { flex: 1 1 auto; min-width: 0; }");
  });
});

// "Your lifts subtext should be a chip." It was a clause under the name
// explaining what the door leads to, which is what the door is for, and it
// made this row two lines tall while All Programs beside it was one.
describe("the shelf's count is a chip on the row", () => {
  it("puts the exercise count in the trailing slot, not on a second line", () => {
    const lifts = GYM_FLOW.slice(GYM_FLOW.indexOf("function LiftsRow"), GYM_FLOW.indexOf("function DayRow"));
    expect(lifts, "the count is a capsule").toMatch(/<span className="ex-chip">\{capAfterNumber\(count/);
    expect(lifts, "and there is no facts line left under the name").not.toMatch(/className="facts"/);
  });
});

// "Also (other title) needs to be deleted and never render." A merged-away
// name is history, not an attribute of the exercise, and on a row whose whole
// job is to carry one name it read as a second one. The names are not lost: a
// merge keeps them on the record and search still matches them.
describe("an exercise's old names are never printed", () => {
  it("draws no alias line on any surface", () => {
    for (const f of ["gym/LibraryPage.tsx", "gym/DuplicateReview.tsx"]) {
      expect(read(f), f + " still prints an alias line").not.toMatch(/`Also \$\{[a-z]*\.?aliases/i);
    }
  });
});

// "Instructional subtext. It shouldn't be anywhere." The card explained what
// a comparison needs -- two sessions at the same rep count, equipment and
// unit -- every time it could not make one. That is a manual, and a missing
// chart already says there is nothing to compare.
describe("a card that cannot compare does not explain comparison", () => {
  it("states its counts instead of its requirements", () => {
    const ins = read("insights/InsightsPage.tsx");
    expect(ins).not.toContain("No two sessions at the same rep count");
    expect(ins).not.toContain("are what it takes");
    expect(ins, "the facts it does have stay").toContain("} in the period`");
  });
});

// "Where it says last Monday - Monday should be a color." The Up Next card
// said "LAST Monday" in the neutral grey .se-chip-when wears for any date,
// between a cyan count and a violet estimate -- while one card below it, on
// the same screen, the weekday a day was last trained is a lime .fact. The
// same fact, adjacent, in two colours.
describe("the day you last trained is lime wherever it appears", () => {
  it("gives the Up Next card the colour the day rows already use", () => {
    expect(GYM_FLOW, "the last-trained chip is not the neutral date chip")
      .toMatch(/className="se-chip se-chip-done"><em>Last<\/em>\{agoPhrase/);
    expect(GYM_FLOW, "and the day row's weekday it matches is lime")
      .toContain('<span className="fact lime">{doneWord}</span>');
    const css = read("styles/ruled.css");
    // The chip is WORDS, so it reads the ink twin (2026-09-22): the same
    // lime in dark, a lime that clears AA on white in light. Still lime
    // wherever it appears, which is what this law is about.
    expect(css).toMatch(/\.ruled\.health-ruled \.se-chip-done \{ color: var\(--hl-lime-ink\)/);
    // .se-chip-when stays grey: it carries plain dates, and on the session
    // screen it sits beside .se-chip-best, which is already lime.
    expect(css).toMatch(/\.se-chip-when[^{]*\{ color: var\(--tx-3\)/);
  });
});
