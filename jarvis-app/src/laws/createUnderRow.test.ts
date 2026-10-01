import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

// ---------------------------------------------------------------------------
// LAW: AN IN-LIST CREATE SITS UNDER ITS ROW, NEVER ON IT (2026-10-01).
//
// Live audit: on the Edit Task sheet the black "Add a Note" capsule looked
// pasted over the "When and Where" row's edge, and "Add Item" did the same to
// a checklist row. Three causes, all in the shared .row-act pattern:
//   1. only the 4px base margin separated the capsule from the row above;
//   2. as a .row after a .row it inherited the list hairline (::before at
//      top: 0), a line drawn straight along the capsule's top edge;
//   3. the classify sheet's 56px "tiled card" indent hit the capsule as a
//      text line, shoving its centred label 38px off the capsule's centre.
// jsdom reports every box as 0, so the geometry itself was checked in a
// browser at 390 and at --type-scale 1.4 (light and dark); what lives here is
// the rules, so deleting one brings the screenshot back with a red test.
// ---------------------------------------------------------------------------

const SHEETS = readdirSync(join(ROOT, "src/styles")).filter((f) => f.endsWith(".css"))
  .map((f) => ({ f, css: read("src/styles/" + f).replace(/\/\*[\s\S]*?\*\//g, "") }));
const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1]!.replace(/\s+/g, " ").trim(), body: m[2]!.replace(/\s+/g, " ").trim() }));

describe("a create under a row clears it (2026-10-01)", () => {
  const COMP = SHEETS.find((s) => s.f === "components.css")!.css;
  const UNDER = ".card > .row:not(.row-act) + .row.row-act";

  it("a create that follows a row keeps a full --s-3 above and below", () => {
    const r = rules(COMP).find((x) => x.sel === UNDER);
    expect(r, "the create is back to the 4px base margin under a row").toBeTruthy();
    expect(r!.body).toMatch(/margin-top:\s*var\(--s-3\)/);
    expect(r!.body).toMatch(/margin-bottom:\s*var\(--s-3\)/);
  });

  it("a create paints no list hairline along its own top edge", () => {
    const r = rules(COMP).find((x) => x.sel === UNDER + "::before");
    expect(r, "the .row + .row hairline cuts through the capsule again").toBeTruthy();
    expect(r!.body).toMatch(/content:\s*none/);
  });

  it("the tiled-card indent does not treat a create as a text line", () => {
    const r = rules(COMP).find((x) => x.sel.includes("> .row:not(.row-act):not(:has(> .row-ico))"));
    expect(r, "the 56px indent reaches the capsule again and off-centres its label").toBeTruthy();
    expect(r!.body).toMatch(/padding-left/);
    expect(COMP).not.toMatch(/> \.row:not\(:has\(> \.row-ico\)\) \{ padding-left/);
  });

  it("no .row-act rule in any stylesheet pulls the capsule out of its slot", () => {
    // The negative-offset family: a negative margin or a translate/top shove
    // is the way a pill ends up drawn on the edge of what is beside it.
    const bad: string[] = [];
    for (const { f, css } of SHEETS) {
      for (const r of rules(css)) {
        const names = r.sel.split(",").map((s) => s.trim());
        if (!names.some((s) => /(^|[\s>+~])\.row-act(?![\w-])/.test(s) || /\.row\.row-act(?![\w-])/.test(s))) continue;
        if (names.every((s) => /::(before|after)/.test(s))) continue;
        if (/margin(-top|-bottom)?:\s*(?:[^;]*\s)?-\d/.test(r.body) || /(?:^|[; ])(top|bottom):\s*-/.test(r.body)
          || /transform:\s*translate/.test(r.body)) bad.push(f + ": " + r.sel + " { " + r.body + " }");
      }
    }
    expect(bad).toEqual([]);
  });

  it("the sheet's Add a Note and Add Item still use the shared create", () => {
    const t = read("src/tasks/screens/TaskSheet.tsx");
    expect(t).toMatch(/className="row row-act"[^\n]*>Add a Note</);
    expect(t).toMatch(/className="row row-act"[^\n]*>Add Item</);
  });
});
