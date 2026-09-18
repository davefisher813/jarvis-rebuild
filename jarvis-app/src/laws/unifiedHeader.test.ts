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
    // Archived and Recently Deleted are VIEWS of this library, and they are
    // options in the view menu as of 2026-09-18. They were only ever in the
    // options sheet because a chip row had no room for five.
    for (const k of ['key: "archived"', 'key: "deleted"']) {
      expect(notes.slice(notes.indexOf("views={["), notes.indexOf("view={")), k + " is not a view").toContain(k);
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
    expect(notes, "Area and Tag are the cuts on the control line, in that order")
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
    // Nor to fit a chip row, which is what the menu settled (2026-09-18):
    // every FILTERS entry this page has is an option, in the page's order.
    expect(read("tasks/screens/TasksPage.tsx"))
      .toMatch(/const views: HeaderView\[\] = FILTERS\.map\(/);
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
// screen edge.
//
// SETTLED 2026-09-18, by the same person, on the two-row header that came out
// of the day's earlier fixes: "All of these chips that are on the second row
// should be on the first row. There is a ton of space... It should be one
// line across on every single page. If you drop down, make the chips drop
// down so everything is on one row directly across."
//
// The chip row is gone. What killed it was not the sliding, it was the
// budget: a chip row has to fit its WHOLE list on the screen, so it shed its
// counts (four with them: 458px of content in a 361px row), then shed Done
// to make room for the Area control, and still wanted a second line. A menu
// shows one answer and hands the list to a panel, so it costs the line one
// capsule whatever it holds.
describe("the header is one line of capsules, and it fits", () => {
  const css = read("styles/components.css");

  it("spends one line, left to right, with nothing under it", () => {
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "the view leads the line").toMatch(/<div className="hdr-controls">[\s\S]{0,200}?<HeadMenu\s+lead\s+ariaLabel="View"/);
    expect(hdr, "and the page's cuts follow it on the same line").toMatch(/ariaLabel="View"[\s\S]{0,300}?\{drops\}\s*<\/div>/);
    expect(hdr, "the chip row is gone, not hidden").not.toMatch(/chip-row|hdr-chips|hdr-drops/);
    expect(css).toMatch(/\.hdr-controls \{[\s\S]{0,160}?display: flex;/);
    expect(css, "and there is no second line left to put anything on").not.toContain(".hdr-drops");
  });

  // THE LINE NEVER OVERFLOWS. overflow-x is a floor for very large Dynamic
  // Type, not a plan, and before it can ever be reached the last control
  // gives way and ellipses -- so the line cannot come to rest on a
  // half-drawn capsule, which is the whole reason the chips went.
  it("makes the last control give way rather than scroll", () => {
    expect(css).toContain(".hdr-controls > *:last-child { flex: 0 1 auto; min-width: 0; }");
    expect(css).toMatch(/\.hdr-controls \{[\s\S]{0,200}?overflow-x: auto;/);
  });

  // Words, not the eyebrow .dd draws by default: three or four of these sit
  // where a sentence used to. The view leads in the page's ink, the cuts are
  // quiet, so the line says at a glance whether anything is narrowing it.
  it("reads as words, with the view leading", () => {
    expect(css).toMatch(/\.hdr-controls \.dd \{[\s\S]{0,200}?text-transform: none;/);
    expect(css).toMatch(/\.hdr-controls \.dd \{[\s\S]{0,240}?color: var\(--tx-2\);/);
    expect(css).toContain(".hdr-controls .dd.dd-lead { font-weight: var(--w-semi); color: var(--tx-1); }");
  });

  // AND THE VIEWS GOT THEIR LIST BACK. Every view each page has, with its
  // count, which no chip row ever managed.
  it("gives every view back, counts and all", () => {
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "a view may carry a count again").toMatch(/export interface HeaderView \{[\s\S]{0,600}?count\?: number;/);
    expect(read("tasks/screens/TasksPage.tsx"), "Tasks offers all seven")
      .toContain("const views: HeaderView[] = FILTERS.map((f) => ({ key: f, label: FILTER_LABEL[f], count: counts[f] || undefined }));");
    expect(read("tasks/screens/RemindersPage.tsx"), "Reminders' Done is back")
      .toContain("const views: HeaderView[] = PAGE_TABS.map((t) => ({ key: t.key, label: t.label }));");
    const bpp = read("bigger/BiggerPicturePage.tsx");
    expect(bpp.slice(bpp.indexOf("const PROJECT_VIEWS"), bpp.indexOf("const GOAL_VIEWS")), "Projects' Done is back")
      .toContain('key: "done"');
    const notes = read("notes/screens/NotesList.tsx");
    expect(notes, "Archived and Recently Deleted were always views of this library")
      .toMatch(/views=\{\[[\s\S]*?key: "archived"[\s\S]*?key: "deleted"[\s\S]*?\]\}/);
    // And the options sheets stop holding views they never should have.
    for (const f of ["tasks/screens/TasksPage.tsx", "notes/screens/NotesList.tsx"]) {
      const src = read(f);
      expect(src.slice(src.indexOf("<OptionsSheet")), f + " still keeps a view in its sheet")
        .not.toMatch(/key: "(done|archived|deleted)"/);
    }
  });

  // A label too long for a line that also carries the cuts says the short
  // word closed and the whole one in the panel, where the choosing happens.
  it("lets a long view name wear a shorter one while closed", () => {
    expect(read("shared/LifeHeader.tsx")).toContain('label={views.find((v) => v.key === view)?.short}');
    expect(read("notes/screens/NotesList.tsx")).toContain('label: "Recently Deleted", short: "Deleted"');
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
  it("names itself on the line, whether or not it is cutting", () => {
    // The capsule IS the indication (handoff rule 7: "do not leave users
    // wondering why records disappeared"). Unset it names the control --
    // "Area", one word, on a line that also carries the view -- and set it
    // wears the area's name and its dot. So a page that is cutting says so
    // without a second line, which is what let the second line go.
    for (const f of [...WITH_AREAS, "tasks/screens/RemindersPage.tsx"]) {
      expect(read(f), f + " does not name the control while nothing is picked")
        .toMatch(/label=\{[^}]*"Area"/);
    }
    const hdr = read("shared/LifeHeader.tsx");
    expect(hdr, "the line under it survives for a page with no control at all")
      .toContain("{!scope && filters && (");
    expect(hdr).toContain('<button type="button" className="hdr-scope-all" onClick={filters.onClear}>Clear</button>');
  });
});

// ---------------------------------------------------------------------------
// DAVE, 2026-09-17, on the fix for the sliding chips: "Get rid of done. Make
// multiple dropdown chips like areas in the most logical way possible. Stack
// dropdowns next to each other." Then 2026-09-18, on the two rows that made:
// "everything is on one row directly across."
//
// One shape, one line, on all five pages.
// ---------------------------------------------------------------------------
describe("every page wears the same one line", () => {
  const PAGES_WITH_CUTS = [
    "tasks/screens/TasksPage.tsx",
    "tasks/screens/RemindersPage.tsx",
    "notes/screens/NotesList.tsx",
    "bigger/BiggerPicturePage.tsx",
  ];

  it("puts every non-view cut on it, on every page that has one", () => {
    for (const f of PAGES_WITH_CUTS) {
      const src = read(f);
      expect(src, f + " has no cuts on its control line").toMatch(/drops=\{/);
      const drops = src.slice(src.indexOf("drops={"), src.indexOf("drops={") + 1600);
      expect(drops, f + " has a cut naming none of the three axes")
        .toMatch(/ariaLabel="(Area|Group by|Tag)"/);
      // A workflow state is a VIEW, and views are the one menu that leads.
      expect(drops, f + " put a view among the cuts").not.toMatch(/ariaLabel="View"/);
    }
  });

  it("leaves no page with a chip row of any length", () => {
    for (const [f] of PAGES) {
      expect(read(f), f + " still draws view chips").not.toMatch(/className="chip-row|hdr-chips/);
    }
  });

  it("keeps the options sheet for tools, not for views", () => {
    // Select, Import, Upload a Syllabus, Reminder Settings, Show Everything:
    // things that DO something. Every view moved into the menu, and the two
    // HeadMenus that were briefly rows here are on the line (2026-09-18).
    for (const f of PAGES_WITH_CUTS) {
      const src = read(f);
      const sheet = src.slice(src.indexOf("<OptionsSheet"));
      expect(sheet, f + " keeps a menu in its sheet").not.toMatch(/<HeadMenu/);
    }
  });
});

describe("the set of views does not depend on the data", () => {
  // It did for one deploy: the four standard views plus whichever else had a
  // count. A row whose length changes with the inbox fits on a quiet Tuesday
  // and overflows on a busy one, which is the worst version -- it breaks
  // only sometimes. The menu ended the question: every view, always, because
  // its length costs the line nothing (2026-09-18).
  it("offers every view a page has, never a subset chosen by counts", () => {
    const page = read("tasks/screens/TasksPage.tsx");
    expect(page).not.toMatch(/counts\[f\] > 0 \|\| f === filter/);
    expect(page).toMatch(/const views: HeaderView\[\] = FILTERS\.map\(/);
    // A count of zero is not drawn: the view still stands, quietly.
    expect(page).toContain("count: counts[f] || undefined");
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
describe("the control line owns its own gap", () => {
  // "Area is too high up. Align it with the rest of the chips." Measured at
  // phone width: the pinned capsule's centre sat 10px above the chips'. Both
  // causes were height one child had and the other did not -- .chip-row's
  // 8px of padding, and a 13px margin on the chips alone, which align-items
  // centres against. There is one line of one kind of control now, so the
  // 13px is simply the line's and nothing can be misaligned against it.
  const css = read("styles/components.css");

  it("carries the 13px itself, with no wrapper left to hold it", () => {
    expect(css).toMatch(/\.hdr-controls \{[\s\S]{0,200}?margin-top: 13px;/);
    expect(css, "the wrapper the pinned capsule needed is gone with it").not.toContain(".hdr-chip-line");
    expect(css, "and so is the second line").not.toContain(".hdr-drops");
  });

  it("still gives the content below it 24px", () => {
    expect(css).toContain(".life-hdr { padding-bottom: 24px; }");
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
