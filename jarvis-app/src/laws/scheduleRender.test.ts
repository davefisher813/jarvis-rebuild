import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// SCHEDULE RENDERING, ALFRED'S LIVE AUDIT OF 2026-10-13 (build 7df1640, light and dark). Three of the four defects are geometry and
// contrast, which a jsdom render cannot see, so the rules are held here, the way the shell and the tab bar are:
//   1. a past row is dimmed, not washed out;
//   2. a flexible block's "FLEXIBLE · UNTIL 7:00 PM" is one left-aligned unit on Home's day card as well as the Schedule tab;
//   3. a check never takes room in front of the time: all times in a list share one left edge, and one event column.
const STYLES = join(__dirname, "..", "styles");
const sheets = readdirSync(STYLES).filter((f) => f.endsWith(".css")).map((f) => ({ f, css: readFileSync(join(STYLES, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));
const rules = sheets.flatMap(({ f, css }) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ f, sel: m[1]!.trim(), body: m[2]! })));
const bodies = (sel: string) => rules.filter((r) => r.sel.split(",").some((s) => s.trim() === sel)).map((r) => r.body);

describe("schedule rendering", () => {
  it("a past row keeps at least 0.65 of its ink", () => {
    const ops = bodies(".sched-row.past").flatMap((b) => [...b.matchAll(/opacity\s*:\s*([\d.]+)/g)].map((m) => Number(m[1])));
    expect(ops.length).toBeGreaterThan(0);
    for (const o of ops) expect(o).toBeGreaterThanOrEqual(0.65);
  });

  it("the flexible Until is released from its right-edge pin on Home's day card and the Schedule tab", () => {
    const home = bodies(".ruled .sched-ticker .sched-holds .sched-body > .sched-cat > .sched-fact").join(";");
    const tab = bodies(".ruled .sched-card .sched-holds .sched-body > .sched-cat > .sched-fact").join(";");
    for (const b of [home, tab]) { expect(b).toMatch(/margin-left\s*:\s*0/); expect(b).toMatch(/padding-left\s*:\s*0/); }
  });

  it("a row's check rides the end of the row, so it never takes room in front of the time", () => {
    const b = bodies(".sched-row .sched-check").join(";");
    expect(b).toMatch(/order\s*:\s*3/);
    expect(b).toMatch(/margin-left\s*:\s*var\(--s-2\)/);
    // Nothing gives a row with a check more left padding than one without.
    for (const r of rules) if (/sched-proposed|sched-check/.test(r.sel) && /\.sched-row/.test(r.sel)) expect(r.body, r.sel).not.toMatch(/padding-left/);
  });
});
