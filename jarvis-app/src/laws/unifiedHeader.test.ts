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
    // Archived and Recently Deleted are options destinations; Tag left the
    // sheet for the dropdown line above.
    for (const s of ['key: "deleted"', 'key: "archived"']) {
      expect(notes.slice(notes.indexOf("<OptionsSheet")), s + " is not in the options sheet").toContain(s);
    }
    // AMENDED 2026-09-17 three times: a pinned capsule beside the chips, then
    // a row in the options sheet when it would not fit, then a dropdown on
    // the header's own line beside Tag (Dave: "Make multiple dropdown chips
    // like areas in the most logical way possible. Stack dropdowns next to
    // each other"). Area and Tag are the two lists on this page that grow
    // with the library, which is what a dropdown is for and a chip is not.
    //
    // Through all three the area is still not a VIEW: it used to be a MEMBER
    // of the filter union, so picking Personal deselected All, Pinned and
    // Unfiled. An area is not a workflow state; the two cuts compose.
    expect(notes, "Area and Tag are the dropdown line, in that order")
      .toMatch(/drops=\{[\s\S]*?ariaLabel="Area"[\s\S]*?ariaLabel="Tag"[\s\S]*?\)\}/);
    expect(notes, "the area is its own axis, not a view").not.toMatch(/\{ kind: "area"; id: string \}/);
    expect(notes).toContain("const filtered = area ? inView.filter((n) => n.category === area) : inView;");
    expect(notes, "and the capsule states which area, so no second line has to")
      .toMatch(/value=\{area \?\? "all"\}/);
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

  it("is the same three-or-fewer labels on every page in the set", () => {
    // 335px of content in a 361px row at 393px wide: 58px of slack. Counts
    // put it at 458px, which is where the scrolling came from.
    for (const [f] of PAGES) {
      const src = read(f);
      for (const m of src.matchAll(/HeaderView\[\] = \[([\s\S]*?)\n\s*\];/g)) {
        const body = m[1] ?? "";
        const keys = [...body.matchAll(/key: "/g)].length;
        expect(keys, f + " puts more than three chips in a row that fits three").toBeLessThanOrEqual(3);
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
  // Reminders joined them on 2026-09-17 ("That needs to be on all pages"):
  // every reminder row already carried its area and already printed its
  // name, so the cut it never had is the same one the other four have.

  it("is one dropdown under the chips on every page that files by area", () => {
    for (const f of [...WITH_AREAS, "tasks/screens/RemindersPage.tsx"]) {
      const src = read(f);
      expect(src, f + " has no Area dropdown on its header")
        .toMatch(/drops=\{[\s\S]{0,900}?ariaLabel="Area"/);
      expect(src, f + " still pins a control beside the chips").not.toMatch(/\bmenu=\{/);
    }
  });

  // WHAT A SHEET COSTS, AND HOW IT IS PAID. A cut you cannot see is a list
  // that shrank for no reason (handoff rule 7: "do not leave users wondering
  // why records disappeared"). So a page that is cutting by area says so,
  // under the chips, with one tap to undo it.
  it("names itself on the page whenever it is actually cutting", () => {
    // The Area capsule states its own answer, so the line under it is for
    // the views that have no control on the page at all: Done, Overdue,
    // From Email, Archived, Recently Deleted.
    for (const f of WITH_AREAS) {
      expect(read(f), f + " filters silently").toMatch(/filters=\{/);
    }
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "the line appears only when something is narrowing")
      .toContain("{!scope && filters && (");
    expect(hdr, "and clears it in one tap").toContain('<button type="button" className="hdr-scope-all" onClick={filters.onClear}>Clear</button>');
  });
});

// ---------------------------------------------------------------------------
// DAVE, 2026-09-17, on the fix for the sliding chips: "Get rid of done. Make
// multiple dropdown chips like areas in the most logical way possible. Stack
// dropdowns next to each other."
//
// Two shapes, two lines, and each shape does the job it is good at.
// ---------------------------------------------------------------------------
describe("a chip picks, a dropdown holds a list", () => {
  const PAGES_WITH_DROPS = [
    "tasks/screens/TasksPage.tsx",
    "tasks/screens/RemindersPage.tsx",
    "notes/screens/NotesList.tsx",
    "bigger/BiggerPicturePage.tsx",
  ];

  it("gives the dropdowns a line of their own, under the chips", () => {
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "the header reserves the line and spaces it").toContain('{drops && <div className="hdr-drops">{drops}</div>}');
    const css = read("styles/components.css");
    expect(css, "they sit next to each other, left to right").toMatch(/\.hdr-drops \{[\s\S]{0,140}?display: flex;/);
    // Not a second row of chips: the eyebrow's uppercase and letter-spacing
    // come off, and they wear the quiet ink rather than a view's white pill.
    expect(css).toMatch(/\.hdr-drops \.dd \{[\s\S]{0,200}?text-transform: none;/);
    expect(css).toMatch(/\.hdr-drops \.dd \{[\s\S]{0,240}?color: var\(--tx-2\);/);
  });

  it("puts every non-view cut there, on every page that has one", () => {
    for (const f of PAGES_WITH_DROPS) {
      expect(read(f), f + " has no dropdown line").toMatch(/drops=\{/);
    }
    // And nothing that IS a view: a workflow state is a chip.
    for (const f of PAGES_WITH_DROPS) {
      const src = read(f);
      const drops = src.slice(src.indexOf("drops={"), src.indexOf("drops={") + 1400);
      expect(drops, f + " has a dropdown naming none of the three cuts")
        .toMatch(/ariaLabel="(Area|Group by|Tag)"/);
      expect(drops, f + " put a view in the dropdown line").not.toMatch(/ariaLabel="View"/);
    }
  });

  // THE FINISHED PILE IS NOT A CHIP. It is the view you open least and it was
  // holding a slot on the line you touch most. Every page keeps it one tap
  // away, in the same options sheet, and the line under the chips names it
  // while it is on so the list is never quietly shorter than expected.
  it("takes Done off every chip row and leaves it reachable", () => {
    const tasks = read("tasks/screens/TasksPage.tsx");
    expect(tasks).toContain('const LEAD_FILTERS: TaskFilter[] = ["today", "upcoming", "all"];');
    expect(tasks, "and it lands in the sheet with its count").toMatch(/MORE_FILTERS\.map[\s\S]{0,160}?count: counts\[f\]/);

    const rem = read("tasks/screens/RemindersPage.tsx");
    expect(rem).toContain('const CHIP_TABS = PAGE_TABS.filter((t) => t.key !== "done");');
    expect(rem.slice(rem.indexOf("<OptionsSheet")), "Reminders keeps Done in its sheet").toContain('key: "done"');

    const bpp = read("bigger/BiggerPicturePage.tsx");
    const pv = bpp.slice(bpp.indexOf("const PROJECT_VIEWS"), bpp.indexOf("const GOAL_VIEWS"));
    expect(pv, "Projects' Done came off the row too").not.toContain('key: "done"');
    expect(bpp.slice(bpp.indexOf("<OptionsSheet")), "and into the sheet").toContain('key: "done"');
  });

  it("leaves no chip row longer than three", () => {
    for (const [f] of PAGES) {
      const src = read(f);
      for (const m of src.matchAll(/HeaderView\[\] = \[([\s\S]*?)\n\s*\];/g)) {
        const keys = [...(m[1] ?? "").matchAll(/key: "/g)].length;
        expect(keys, f + " has a chip row longer than three").toBeLessThanOrEqual(3);
      }
    }
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
