import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// ONE HEADER, FIVE PAGES (Dave 2026-09-17, the Unified Headers handoff:
// "unify the headers of Tasks, Reminders, Notes, Projects and Goals using the
// attached mockups. This is a presentation and discovery improvement.
// Preserve existing behaviors, records, relationships and the catalog
// rules").
//
// The handoff's first rule is the one this file exists to keep: "Provide
// slots for page title, existing section navigation, search, Add, view chips
// and an options control... Reuse catalog tokens; do not build five
// independent versions."
//
// Five pages that each grew their own answer is exactly how they got here:
// Reminders with a full-width red banner and a Search toggle, Tasks with its
// views hidden in a dropdown, Notes with four kinds of thing in one wrapping
// filter row, Projects and Goals with no search or visible create at all.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

/** Every page the handoff names, and the word its Add speaks to a screen
 *  reader ("even though the visible button says Add"). */
const PAGES: [string, string][] = [
  ["tasks/screens/TasksPage.tsx", "New Task"],
  ["tasks/screens/RemindersPage.tsx", "New Reminder"],
  ["notes/screens/NotesList.tsx", "New Note"],
  ["bigger/BiggerPicturePage.tsx", "New Project"],
];

describe("all five pages spend the one header", () => {
  it("every one of them mounts it, and none builds its own", () => {
    for (const [f] of PAGES) {
      expect(read(f), f + " does not use the shared header").toMatch(/<LifeHeader\b/);
    }
    // Projects and Goals are two lenses of one page, so four files cover five.
    expect(read("bigger/BiggerPicturePage.tsx")).toContain('"New Goal"');
  });

  it("every one of them carries the same options control", () => {
    for (const [f] of PAGES) {
      expect(read(f), f + " has no options control").toMatch(/<OptionsButton\b/);
      expect(read(f), f + " has nowhere to put its secondary tools").toMatch(/<OptionsSheet\b/);
    }
  });

  it("Add names the type it creates, even though the button says Add", () => {
    for (const [f, label] of PAGES) {
      // Projects and Goals are one page with two lenses, so its label is an
      // expression rather than a literal.
      expect(read(f), f).toContain(`"${label}"`);
      expect(read(f), f + " never passes a bare Add as the accessible name").toMatch(/addLabel=/);
    }
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "the visible word is the same on all five").toContain("<span>Add</span>");
    expect(hdr).toContain("aria-label={addLabel}");
  });
});

describe("what the handoff forbids", () => {
  // "No giant red creation banners across every page."
  it("Add is a dark surface with a red glyph, never a second oversized primary", () => {
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "Add is not a .btn-primary").not.toMatch(/hdr-add[^>]*btn-primary/);
    const css = read("styles/components.css");
    const add = css.slice(css.indexOf(".hdr-add {"), css.indexOf(".hdr-add .ic"));
    expect(add, "its ground is a surface, not the accent fill").toContain("background: var(--surface-2)");
    // --tint, not --accent: the brand red is banned as glyph ink by the
    // contrast law, and --accent-tx is white in dark theme.
    expect(css).toContain(".hdr-add .ic { width: 20px; height: 20px; color: var(--tint); }");
    // The banner it replaced.
    expect(read("tasks/screens/RemindersPage.tsx")).not.toMatch(/btn btn-primary[^>]*>.*New Reminder/);
  });

  // "No two or three wrapping chip rows."
  it("no page in the set wraps its view chips", () => {
    for (const [f] of PAGES) {
      expect(read(f), f + " still wraps a chip row").not.toMatch(/chip-wrap-row/);
    }
    const css = read("styles/components.css");
    expect(css, ".chip-row is the scrolling one").toMatch(/\.chip-row \{ display: flex;[^}]*overflow-x: auto;/);
  });

  // "Do not mix area names, deleted records and workflow states in the same
  // row." Notes is the page the handoff names for this.
  it("the Notes chips are three workflow states and nothing else", () => {
    const notes = read("notes/screens/NotesList.tsx");
    expect(notes).toMatch(/const VIEWS: HeaderView\[\] = \[\s*\{ key: "all", label: "All" \},\s*\{ key: "pinned", label: "Pinned" \},\s*\{ key: "unfiled", label: "Unfiled" \},\s*\];/);
    // Tags, archived and deleted are options destinations.
    for (const s of ['key: "tag"', 'key: "deleted"', 'key: "archived"']) {
      expect(notes.slice(notes.indexOf("<OptionsSheet")), s + " is not in the options sheet").toContain(s);
    }
    // AMENDED 2026-09-17 (Dave: "Don't forget to add it to notes page as
    // well"), then again the same day when the pinned capsule beside the
    // chips turned out not to fit. The area is a row in the options sheet,
    // and it is still not a VIEW: it used to be a MEMBER of the filter
    // union, so picking Personal deselected All, Pinned and Unfiled. An area
    // is not a workflow state; the two cuts compose.
    expect(notes.slice(notes.indexOf("<OptionsSheet")), "the area is one tap away, in the sheet")
      .toMatch(/key: "area",\s*label: "Area"/);
    expect(notes, "the area is its own axis, not a view").not.toMatch(/\{ kind: "area"; id: string \}/);
    expect(notes).toContain("const filtered = area ? inView.filter((n) => n.category === area) : inView;");
    expect(notes, "and the list says so when it is cutting by one").toMatch(/filters=\{area \|\|/);
  });
});

describe("nothing was invented to make the pictures match", () => {
  // Rule 2: "If Paused or Achieved does not exist, map to an existing status
  // or omit the chip for launch. Do not invent a lifecycle as part of this
  // pass."
  it("the chips are the statuses the data actually has", () => {
    const page = read("bigger/BiggerPicturePage.tsx");
    // Projects: active | on_hold | done. The mockup's "Paused" is this app's
    // On Hold, which is what it has been called everywhere since it shipped.
    expect(read("projects/types.ts")).toContain('export const PROJECT_STATES: ProjectStatus[] = ["active", "on_hold", "done"];');
    expect(page).toContain('{ key: "on_hold", label: "On Hold" }');
    expect(page, "and not a second word for one state").not.toContain('label: "Paused"');
    // Goals have no paused state, so there is no Paused chip.
    expect(read("life/types.ts")).toContain('export type GoalState = "on_track" | "steady" | "at_risk" | "achieved";');
    const goalViews = page.slice(page.indexOf("const GOAL_VIEWS"), page.indexOf("const GOAL_VIEWS") + 400);
    expect(goalViews).toContain('{ key: "achieved", label: "Achieved" }');
    expect(goalViews, "a goal cannot be paused, so it is not offered").not.toContain("on_hold");
  });

  // Rule 2, again: "Preserve the existing definitions and do not reclassify
  // data for visual consistency." The mockup lists four Tasks chips; the page
  // has seven views, one of which Dave asked for by name on 2026-09-13.
  it("no existing view was dropped to match a four-chip picture", () => {
    expect(read("tasks/screens/TasksPage.tsx"))
      .toMatch(/FILTERS\.filter\(\(f\) => !LEAD_FILTERS\.includes\(f\)\)/);
  });
});

describe("search says what it searched", () => {
  // Rule 4: "Search the current entity type, constrained by the chosen view
  // and Area. For example: '2 results in Active projects'. Offer 'Search all
  // projects' to expand the status scope without silently changing it."
  it("every page states its scope and offers to widen it", () => {
    for (const [f] of PAGES) {
      expect(read(f), f + " searches silently").toMatch(/scope=\{/);
      expect(read(f), f + " never offers to widen").toMatch(/allLabel:/);
    }
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr).toContain("${scope.count} ${scope.count === 1 ? \"result\" : \"results\"} in ${scope.where}");
  });

  // Rule 6: "Hide the suggestion card during local search and in Done so it
  // does not distract from browsing."
  it("the Tasks start card gets out of the way of a search", () => {
    expect(read("tasks/screens/TasksPage.tsx")).toContain('startCard && !q && filter !== "done"');
  });
});

// ---------------------------------------------------------------------------
// THE FOUR THINGS DAVE FOUND ON THE LIVE HEADER, 2026-09-17:
//
//   "the chips have visual issues when I scroll them"
//   "I can no longer sort by category on any of these pages"
//   "there's too many chips in my opinion on tasks page"
//   "there's containers on the task page vertically don't follow
//    spacing/border rules (way too close together)"
//
// All four were measured in a real Chromium render at phone width before and
// after, so the numbers below are observations, not intentions.
// ---------------------------------------------------------------------------
// AMENDED 2026-09-17, hours later, on a photograph of the row mid-drag
// (Dave: "Look at what happens to the chips when they slide. This is simply
// not going to work"). Snapping and unmasking were both attempts to make a
// scrolling row of large filled pills look deliberate. Neither could: at
// every resting position between the ends, one pill is cut in half by the
// screen edge. The row does not scroll any more, so there is nothing to make
// look right.
describe("the chip row does not scroll, because it fits", () => {
  const css = read("styles/components.css");

  it("carries neither snap nor mask, because there is nothing to hint at", () => {
    expect(css).toContain(".hdr-chips { -webkit-mask-image: none; mask-image: none; scroll-snap-type: none; }");
  });

  it("is the same four-or-fewer labels on every page in the set", () => {
    // 335px of content in a 361px row at 393px wide: 58px of slack. Counts
    // put it at 458px, which is where the scrolling came from.
    for (const [f] of PAGES) {
      const src = read(f);
      for (const m of src.matchAll(/HeaderView\[\] = \[([\s\S]*?)\n\s*\];/g)) {
        const body = m[1] ?? "";
        const keys = [...body.matchAll(/key: "/g)].length;
        expect(keys, f + " puts more than four chips in a row that fits four").toBeLessThanOrEqual(4);
        expect(body, f + " puts a count back on a chip").not.toMatch(/count:/);
      }
    }
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "and the type forbids one").toMatch(/export interface HeaderView \{\s*key: string;\s*label: string;\s*\}/);
  });

  it("has no second control sharing its line", () => {
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "the chip row is the whole line").toMatch(/<div className="chip-row hdr-chips" role="tablist" aria-label="Views">/);
    expect(hdr, "nothing is pinned beside it").not.toMatch(/hdr-chip-line|hdr-menu/);
  });
});

describe("the category cut is findable, not merely reachable", () => {
  // Every page that has areas reaches it the same way (Dave 2026-09-17: "I
  // still want this to be uniform"). It was a capsule pinned beside the
  // chips for one deploy; it is a row in the options sheet now, because the
  // chip line has no room for a second control and still fit.
  const WITH_AREAS = [
    "tasks/screens/TasksPage.tsx",
    "notes/screens/NotesList.tsx",
    "bigger/BiggerPicturePage.tsx",
  ];

  it("is one row in the options sheet on every page that files by area", () => {
    for (const f of WITH_AREAS) {
      const src = read(f);
      expect(src.slice(src.indexOf("<OptionsSheet")), f + " has no Area row in its sheet")
        .toMatch(/key: "area",\s*label: "Area"/);
      expect(src, f + " still pins a control beside the chips").not.toMatch(/\bmenu=\{/);
    }
  });

  // WHAT A SHEET COSTS, AND HOW IT IS PAID. A cut you cannot see is a list
  // that shrank for no reason (handoff rule 7: "do not leave users wondering
  // why records disappeared"). So a page that is cutting by area says so,
  // under the chips, with one tap to undo it.
  it("names itself on the page whenever it is actually cutting", () => {
    for (const f of WITH_AREAS) {
      expect(read(f), f + " filters silently").toMatch(/filters=\{/);
    }
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "the line appears only when something is narrowing")
      .toContain("{!scope && filters && (");
    expect(hdr, "and clears it in one tap").toContain('<button type="button" className="hdr-scope-all" onClick={filters.onClear}>Clear</button>');
  });
});

describe("the set of chips does not depend on the data", () => {
  // It did for one deploy: the four standard views plus whichever else had a
  // count. A row whose length changes with the inbox fits on a quiet Tuesday
  // and overflows on a busy one, which is the worst version -- it breaks
  // only sometimes. Four, fixed, on every page (2026-09-17).
  it("keeps the four standard views and nothing conditional", () => {
    const page = read("tasks/screens/TasksPage.tsx");
    expect(page).not.toMatch(/\.filter\(\(f\) => LEAD_FILTERS\.includes\(f\) \|\| counts\[f\] > 0 \|\| f === filter\)/);
    expect(page).toMatch(/const views: HeaderView\[\] = LEAD_FILTERS\.map\(\(f\) => \(\{ key: f, label: FILTER_LABEL\[f\] \}\)\);/);
  });
});

describe("two containers are two containers", () => {
  // Measured at phone width before the fix: zero. The ruled list card carries
  // its own page margin rather than a .pad-x wrapper, so it fell outside the
  // rule that spaces two card blocks and sat flush against the card above it.
  it("spaces the list under the card above it", () => {
    expect(read("styles/ruled.css")).toMatch(/\.ruled \.pad-x:has\(> \.card\) \+ \.task-list-block \{ margin-top: var\(--s-4\); \}/);
    expect(read("tasks/screens/TasksPage.tsx")).toContain('<div className="task-list-block">');
  });

  // The chips lost their 13px because `.hdr-chips:last-child` matched
  // whenever there was no scope line under them.
  it("keeps the gap above the chips whether or not a scope line follows", () => {
    expect(read("styles/components.css")).not.toContain(".hdr-chips:last-child { margin-top: 0; }");
  });
});

// ---------------------------------------------------------------------------
// DAVE, 2026-09-17, on the live header again.
// ---------------------------------------------------------------------------
describe("the chip row owns its own line", () => {
  // "Area is too high up. Align it with the rest of the chips." Measured at
  // phone width: the pinned capsule's centre sat 10px above the chips'. Both
  // causes were height one child had and the other did not -- .chip-row's
  // 8px of padding, and a 13px margin on the chips alone, which align-items
  // centres against. There is nothing beside the chips now, so the gap is
  // simply theirs and the padding stays off.
  const css = read("styles/components.css");

  it("gives the chip row no padding of its own, so its box IS its chips", () => {
    expect(css).toContain(".hdr-chips { padding-top: 0; padding-bottom: 0;");
  });

  it("carries the 13px itself, with no line wrapper left to hold it", () => {
    expect(css).toContain(".hdr-chips { margin-top: 13px; }");
    expect(css, "the wrapper the capsule needed is gone with it").not.toContain(".hdr-chip-line");
  });
});

describe("A Place to Begin is about the list it sits on", () => {
  // "the huge start now container is the same for all of the pages. Like
  // setting up Jarvis has NOTHING to do with emails."
  it("picks out of the selected view, through the same Area cut", () => {
    const flow = read("tasks/TasksFlow.tsx");
    expect(flow).toContain("const startFrom = visible(filter);");
    expect(flow).toContain("const pick = topPick(startFrom, today, sessions, { skip: skippedStarts });");
    expect(flow, "Choose Another offers from the same list").toContain("others={otherPicks(startFrom, today, pick.task.id)}");
    expect(flow, "never the whole backlog again").not.toContain("topPick(parts.all,");
  });
});
