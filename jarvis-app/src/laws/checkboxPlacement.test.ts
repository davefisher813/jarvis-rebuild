import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ONE POSITION FOR EVERY CHECKBOX AND COMPLETION CONTROL (Dave 2026-10-13: "complete and checkbox controls live in ONE position
// everywhere", after a proposed schedule row drew its checkbox at the right edge). They lead the row, at the left. Two ways a control has
// ended up at the wrong end, and both are held here: a checkbox passed as a form Row's trailing children (the Row now takes `lead`), and
// a checkbox class pushed to the end of its row by CSS.
const SRC = join(__dirname, "..");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(f) && !/\.test\./.test(f) ? [p] : []; });
const files = walk(SRC).map((p) => ({ p, s: readFileSync(p, "utf8") }));

describe("checkbox placement", () => {
  it("no form Row carries a checkbox as its trailing children: it goes in `lead`", () => {
    const bad = files.filter(({ s }) => /<Row\b[^>]*[^/]>\s*<[^>]*role="checkbox"/.test(s)).map(({ p }) => p.replace(SRC, ""));
    expect(bad).toEqual([]);
  });

  it("no checkbox class is pushed to the end of its row by CSS", () => {
    const styles = join(SRC, "styles");
    const rules = readdirSync(styles).filter((f) => f.endsWith(".css")).flatMap((f) =>
      [...readFileSync(join(styles, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ f, sel: m[1]!.trim(), body: m[2]! })));
    const CHECK = /(^|[\s>,])\.(task-check-tap|task-check|sel-box|cb|bh-check)(\b|$)/;
    const pushed = rules.filter((r) => r.sel.split(",").some((s) => CHECK.test(s.trim().split(/\s+/).pop()!.replace(/^[^.]*/, "") ? s : "")) && /(margin-left\s*:\s*auto|float\s*:\s*right|(^|;)\s*order\s*:\s*[1-9])/.test(r.body));
    expect(pushed.map((r) => `${r.f}: ${r.sel}`)).toEqual([]);
  });
});
