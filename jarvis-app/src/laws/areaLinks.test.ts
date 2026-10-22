import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// LAW: AN EDITOR WITH AN AREA AND A LINKED FIELD NARROWS ONE BY THE OTHER (Dave 2026-10-22, "Linked pickers filter by Area, both directions").
//
// His screenshot: the task sheet's Area said Elite Squad and its Goal picker still listed every goal in the app. The Area, Person, Project and
// Goal fields of an editor are one question asked four ways; each editor used to answer it alone. The rule now lives in shared/areaLinks (a
// list under the Area, a pick brings its Area in, a change of Area clears what no longer fits) and every editor that carries an Area with
// any of the other three reads it from there.
//
// This finds the editors by what they draw (a menu labelled Area beside one labelled Person, Project or Goal), so the NEXT editor that grows
// the same pair fails here until it is wired, instead of shipping the screenshot again.
const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}
const rel = (p: string) => p.slice(SRC.length + 1);
const has = (src: string, label: string) => new RegExp(`ariaLabel="${label}"`).test(src);

// The editors, as of 2026-10-22. A file that appears in the scan and not here is new; one here that stops matching has been changed.
const EDITORS = [
  "projects/ProjectDetailPage.tsx", // Area and Goal, saved the moment they are picked
  "projects/ProjectSheet.tsx", // Area and Goal
  "schedule/screens/EventSheet.tsx", // Area and Project
  "tasks/screens/TaskSheet.tsx", // Area, Person, Project and Goal
];

describe("linked pickers follow the Area (shared/areaLinks)", () => {
  const files = walk(SRC).filter((f) => !/\/(bench|testpanel|laws)\//.test(f));
  const found = files.filter((f) => {
    const s = read(f);
    return (has(s, "Area") || has(s, "Areas")) && (has(s, "Person") || has(s, "Project") || has(s, "Goal"));
  }).map(rel).sort();

  it("finds exactly the editors this rule was built for", () => {
    expect(found, "an editor with an Area menu beside a Person, Project or Goal menu: wire it to shared/areaLinks, then add it to EDITORS").toEqual(EDITORS);
  });

  it.each(EDITORS)("%s reads its lists, picks and area changes through shared/areaLinks", (f) => {
    const s = read(join(SRC, f));
    expect(s, "imports the shared rule").toMatch(/from "(\.\.\/)+shared\/areaLinks"/);
    expect(s, "narrows a menu with listInAreas").toMatch(/listInAreas\(/);
  });

  it("every editor that can CHANGE its Area clears what no longer fits (keepIfTied) and brings an Area in with a pick (homeArea)", () => {
    for (const f of EDITORS) {
      const s = read(join(SRC, f));
      expect(s, f + " clears on a change of Area").toMatch(/keepIfTied\(/);
      // The event sheet brings the project's own category in directly (a project has exactly one), the others through homeArea.
      if (f !== "schedule/screens/EventSheet.tsx") expect(s, f + " brings an Area in").toMatch(/homeArea\(/);
    }
  });

  it("the sheet builders hand the sheets each person's and goal's areas, from the stored links", () => {
    const links = read(join(SRC, "tasks/screens/sheetLinks.ts"));
    expect(links, "a person is tied to the areas in categoryIds").toMatch(/areas: p\.data\.categoryIds/);
    const reach = read(join(SRC, "bigger/reach.ts"));
    expect(reach, "a goal is tied to the areas it watches, its tags").toMatch(/areas: goalTags\(g\)/);
  });
});
