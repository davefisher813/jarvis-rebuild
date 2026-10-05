// The stylesheet halves of the life-area round-3 fixes (Dave 2026-10-05). A computed style needs a browser, so these hold the rules
// themselves, comments stripped, to the properties the round-2 review found wrong.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const RULED = strip(readFileSync(join(__dirname, "../styles/ruled.css"), "utf8"));
const COMP = strip(readFileSync(join(__dirname, "../styles/components.css"), "utf8"));
const block = (css: string, sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?:^|[}\\s])" + esc + "\\s*\\{([^}]*)\\}").exec(css)?.[1] ?? "";
};

describe("a goal's state word is text on every page, never a pill", () => {
  it(".gstat has no fill, padding or radius, and Health no longer repaints it lime", () => {
    const gstat = block(RULED, ".ruled .gstat");
    expect(gstat, "the rule exists").not.toBe("");
    expect(gstat).not.toMatch(/background|padding|border-radius/);
    expect(block(RULED, ".ruled .gstat-good")).not.toMatch(/background/);
    expect(block(RULED, ".ruled .gstat-warn")).not.toMatch(/background/);
    expect(RULED).not.toMatch(/health-ruled \.gstat-good/);
  });
});

describe("the Health week card", () => {
  it("the hero count is the key's done green, and white at zero", () => {
    expect(block(RULED, ".ruled.health-ruled .h-week-count b")).toMatch(/color: var\(--good\)/);
    expect(block(RULED, ".ruled.health-ruled .h-week-count.zero b")).toMatch(/color: var\(--tx-1\)/);
    expect(block(RULED, ".ruled.health-ruled .h-stat.lime b")).toMatch(/color: var\(--good\)/);
  });

  it("an empty day's mark is readable on the card, not the press wash it vanished into in dark", () => {
    expect(block(RULED, ".ruled.health-ruled .h-bar i")).not.toMatch(/--press-3/);
    expect(block(RULED, ".ruled.health-ruled .h-bar i")).toMatch(/--tx-4/);
  });
});

describe("a project's pie", () => {
  it("is neutral ink on every screen, never the area's colour", () => {
    const rule = block(RULED, ".ruled .pp-slot .pp, .ruled .r-pg .pp-sm");
    expect(rule).toMatch(/color: var\(--tx-2\)/);
  });
});

describe("Coming Up on an area page", () => {
  it("its time column starts at the card's left inset, left aligned, and never wraps AM from the time", () => {
    const rule = block(RULED, ".ruled .sched-coming .sched-row > .sched-time");
    expect(rule).toMatch(/text-align: left/);
    expect(rule).toMatch(/white-space: nowrap/);
  });
});

describe("the segmented control's selected pill in light", () => {
  it("draws its ring inset, so a scrolling strip's clip cannot leave a stroke beside it", () => {
    const rule = block(COMP, '[data-theme="light"] .segmented .seg.active');
    expect(rule).toMatch(/box-shadow: inset 0 0 0 0\.5px/);
  });
});

describe("the area tiles", () => {
  it("share the row's full width instead of sitting as two small boxes with a gap beside them", () => {
    expect(block(RULED, ".ruled .area-tiles .stat-tile")).toMatch(/flex: 1 1 auto/);
  });
});
