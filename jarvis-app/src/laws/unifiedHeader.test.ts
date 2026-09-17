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
    // Areas, tags, archived and deleted are all options destinations now.
    for (const s of ['key: "area"', 'key: "tag"', 'key: "deleted"', 'key: "archived"']) {
      expect(notes.slice(notes.indexOf("<OptionsSheet")), s + " is not in the options sheet").toContain(s);
    }
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
