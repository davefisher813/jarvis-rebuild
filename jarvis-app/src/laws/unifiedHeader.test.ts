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
    // well"). The area was in that sheet for one deploy and is a pinned menu
    // beside the chips now, like Tasks. More than a move: it used to be a
    // MEMBER of the filter union, so picking Personal deselected All, Pinned
    // and Unfiled. An area is not a view; the two cuts compose.
    expect(notes).toMatch(/menu=\{areaIds\.length > 0 \? \([\s\S]{0,200}?ariaLabel="Area"/);
    expect(notes, "the area is its own axis, not a view").not.toMatch(/\{ kind: "area"; id: string \}/);
    expect(notes).toContain("const filtered = area ? inView.filter((n) => n.category === area) : inView;");
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
    expect(page).toContain('{ key: "on_hold", label: "On Hold", count: pausedCount }');
    expect(page, "and not a second word for one state").not.toContain('label: "Paused"');
    // Goals have no paused state, so there is no Paused chip.
    expect(read("life/types.ts")).toContain('export type GoalState = "on_track" | "steady" | "at_risk" | "achieved";');
    const goalViews = page.slice(page.indexOf("const GOAL_VIEWS"), page.indexOf("const GOAL_VIEWS") + 400);
    expect(goalViews).toContain('{ key: "achieved", label: "Achieved"');
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
describe("the chip row scrolls without looking broken", () => {
  const css = read("styles/components.css");

  it("snaps, so a chip is either fully in or fully out", () => {
    // .chip-row's own snap is `proximity`, which a browser may ignore, and a
    // scrolled row left a sliver of the previous pill cut square at x=0.
    expect(css).toContain("scroll-snap-type: x mandatory;");
    expect(css).toMatch(/\.chip-row \{[^}]*scroll-padding-left: var\(--s-4\)|scroll-padding-left: var\(--s-4\);/);
  });

  it("does not dissolve its own pills", () => {
    // .chip-row masks its last 32px to transparent as a "there is more"
    // signal. On large filled pills carrying counts that reads as a fault.
    expect(css).toContain(".hdr-chips { -webkit-mask-image: none; mask-image: none; }");
  });

  it("gives the pinned menu real ground, so chips pass UNDER it", () => {
    const line = css.slice(css.indexOf(".hdr-chip-line > .hdr-menu {"), css.indexOf(".hdr-chip-line > .hdr-menu {") + 260);
    expect(line).toContain("background: var(--bg)");
    expect(line).toContain("z-index: 1");
  });
});

describe("the category cut is findable, not merely reachable", () => {
  // Every page that has areas has the same pinned menu, in the same place
  // (Dave 2026-09-17: "I still want this to be uniform").
  const WITH_AREAS = [
    "tasks/screens/TasksPage.tsx",
    "notes/screens/NotesList.tsx",
    "bigger/BiggerPicturePage.tsx",
  ];

  it("is pinned beside the chips on every page that files by area", () => {
    for (const f of WITH_AREAS) {
      expect(read(f), f + " has no pinned area menu").toMatch(/menu=\{[\s\S]{0,240}?ariaLabel="Area"/);
    }
  });

  it("names the control when nothing is picked and the area when one is", () => {
    for (const f of WITH_AREAS) {
      expect(read(f), f).toMatch(/label=\{[^}]*\? undefined : "Area"\}|label=\{!catFilter \|\| catFilter === "all" \? "Area" : undefined\}/);
    }
  });

  // It is the cut across whichever view is chosen, not a view, so it must not
  // wear the chip's selected pill.
  it("does not dress as a view chip", () => {
    const css = read("styles/components.css");
    const dd = css.slice(css.indexOf(".hdr-menu > .dd {"), css.indexOf(".hdr-menu > .dd {") + 240);
    expect(dd, "not the uppercase eyebrow .dd draws by default").toContain("text-transform: none");
    expect(dd, "and not the white pill a chosen view wears").toContain("color: var(--tx-2)");
  });
});

describe("a view with nothing in it is not a chip", () => {
  it("prunes the conditional views and keeps the four standard ones", () => {
    expect(read("tasks/screens/TasksPage.tsx"))
      .toMatch(/\.filter\(\(f\) => LEAD_FILTERS\.includes\(f\) \|\| counts\[f\] > 0 \|\| f === filter\)/);
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
describe("the pinned menu sits on the chips' own line", () => {
  // "Area is too high up. Align it with the rest of the chips." Measured at
  // phone width: the capsule's centre sat 10px above the chips'. Two causes,
  // both of them height one child had and the other did not.
  const css = read("styles/components.css");

  it("gives the chip row no padding of its own, so its box IS its chips", () => {
    // .chip-row carries 8px of top padding for a row that stands alone.
    expect(css).toContain(".hdr-chips { padding-top: 0; padding-bottom: 0;");
  });

  it("puts the gap above on the LINE, not on one child's margin", () => {
    // align-items centres against the MARGIN box, so a margin on the chips
    // alone lifted the capsule by half of it.
    expect(css).toContain(".hdr-chip-line { display: flex; align-items: center; margin-top: 13px; }");
    expect(css, "the chips must not carry it themselves").not.toMatch(/\.hdr-chips \{ margin-top: 13px/);
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
