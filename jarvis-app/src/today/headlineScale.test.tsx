// @vitest-environment jsdom
// S1 OF THE APPROVED STRIKING ROUND (issue 108, Dave 2026-10-13): "On Today, scale up the existing header elements in their
// current places and colors: the greeting, the DUE and GOALS chips, and the day ring. No new elements, nothing moved, no color
// changes." The hard constraint over all of it: the font style does not change, only the scale.
//
// jsdom has no layout, so each number is pinned where it is decided: the stylesheet text (what size, that it is scoped to the
// Today header, and that the rule writes NOTHING but a size or the room that size needs), and the real TodayPage (that the
// elements those scoped selectors reach are really inside the hero, and the ring that must not grow is really outside it).
// The fit itself was measured in a browser (390, 375 and 360 wide, light and dark, text scale 1 and 1.4, three and four chips)
// and is in the report that came with the change.
// The cases that pin the new sizes fail against the stylesheet as it stood before the change; the ones that pin what must NOT
// move (the base rules, the evening ring, the face, the weights, the colours) pass on both, by design.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import TodayPage from "./TodayPage";
import { setCategoryRegistry } from "../shared/categories";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// The stylesheet text
// ---------------------------------------------------------------------------
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const sheet = (f: string) => strip(readFileSync(join(__dirname, "../styles/" + f), "utf8"));
const COMPONENTS = sheet("components.css");
const RULED = sheet("ruled.css");
const DESIGN = sheet("jarvis-design-system.css");
const GLASS_DARK = sheet("glass-dark.css");
const GLASS_LIGHT = sheet("glass-light.css");

/** Every rule body whose selector is exactly `selector` (a rule of its own, not the tail of a longer selector), whitespace squeezed. */
function bodies(css: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim().replace(/\s+/g, " ") === selector) out.push(m[2]!.replace(/\s+/g, " ").trim());
  }
  return out;
}
/** The one rule with that exact selector, or fail loudly: a second rule is a second place the size can be decided. */
function rule(css: string, selector: string): string {
  const all = bodies(css, selector);
  expect(all.length, `exactly one rule for ${selector}`).toBe(1);
  return all[0]!;
}
const propsOf = (body: string) => body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => d.split(":")[0]!.trim());
const valueOf = (body: string, prop: string) => new RegExp("(?:^|;)\\s*" + prop + ":\\s*([^;]+)").exec(body)?.[1]?.trim();

// The five new rules, by selector. Each one is size and room only.
const GREETING = ".today-title";
const CHIP_NUMBER = ".ruled .today-hero .stat-tile .st-n";
const CHIP_BOX = ".ruled .today-hero .stat-tile";
const RING = ".today-hero .dring";
const RING_DISC = ".today-hero .dring > div";
const RING_NUMBER = ".today-hero .dring b";
const HERO_ROW = ".today-hero .today-hero-row";

describe("S1: the Today header steps up, and only its size moves", () => {
  it("the greeting is 38, up from 34 (--t-h1), and its rule writes only the size, the weight and the tracking it always had", () => {
    const body = rule(COMPONENTS, GREETING);
    expect(valueOf(body, "font-size")).toBe("max(calc(34px * var(--type-scale)), calc(24px * var(--type-scale) + 14px))");
    expect(valueOf(body, "font-weight")).toBe("var(--w-semi)");
    expect(valueOf(body, "letter-spacing")).toBe("-0.4px");
    expect(propsOf(body)).toEqual(["font-size", "font-weight", "letter-spacing"]);
  });

  it("the step fades out as Larger Text rises: 38 at 1.0, a little over the old size at 1.2, exactly the old 34 x scale at 1.4, and never under it", () => {
    // At 1.4 the old size already fills the column beside the ring: a flat 38 x scale pushed a 9-letter first name into the ring there
    // ("Alexandra" at 390 wide), where the old size cleared it. So the formula has to land ON the old size by 1.4, not past it.
    const m = /^max\(calc\((\d+)px \* var\(--type-scale\)\), calc\((\d+)px \* var\(--type-scale\) \+ (\d+)px\)\)$/.exec(valueOf(rule(COMPONENTS, GREETING), "font-size")!);
    expect(m, "the greeting size is max(old size per step, new size per step plus a floor)").not.toBeNull();
    const [old, perStep, plus] = m!.slice(1).map(Number) as [number, number, number];
    expect(old, "the floor is the old 34 per step, --t-h1").toBe(34);
    expect(DESIGN).toMatch(/--t-h1:\s*calc\(34px \* var\(--type-scale\)\)/);
    const size = (s: number) => Math.max(old * s, perStep * s + plus);
    expect(size(1)).toBe(38);
    expect(size(1.2)).toBeCloseTo(42.8, 9);
    expect(size(1.2)).toBeGreaterThan(34 * 1.2);
    expect(size(1.4)).toBeCloseTo(34 * 1.4, 9);
    for (const s of [1, 1.05, 1.1, 1.2, 1.3, 1.4, 1.6, 2]) expect(size(s), `never under the old size at ${s}x`).toBeGreaterThanOrEqual(34 * s - 1e-9);
  });

  it("the chip numbers go up one ramp step, 20 to --t-title (26), scoped to the Today header, and that rule writes nothing but the size", () => {
    const body = rule(RULED, CHIP_NUMBER);
    expect(propsOf(body)).toEqual(["font-size"]);
    expect(valueOf(body, "font-size")).toBe("var(--t-title)");
    expect(DESIGN).toMatch(/--t-title:\s*calc\(26px \* var\(--type-scale\)\)/);
  });

  it("a chip's number carries the room it needs and nothing else: side padding on the 10 step, and never narrower than a tap", () => {
    const body = rule(RULED, CHIP_BOX);
    expect(valueOf(body, "padding-left")).toBe("var(--s-2h)");
    expect(valueOf(body, "padding-right")).toBe("var(--s-2h)");
    expect(valueOf(body, "min-width")).toBe("var(--tap-min)");
    expect(propsOf(body).sort()).toEqual(["min-width", "padding-left", "padding-right"]);
    expect(DESIGN).toMatch(/--s-2h:\s*10px/);
    expect(DESIGN).toMatch(/--tap-min:\s*44px/);
  });

  it("the day ring is 72 with a 58 disc and a 20 number (--t-h2), all times the text scale, scoped to the Today header, writing only sizes", () => {
    const ring = rule(COMPONENTS, RING);
    expect(valueOf(ring, "width")).toBe("calc(72px * var(--type-scale))");
    expect(valueOf(ring, "height")).toBe("calc(72px * var(--type-scale))");
    expect(valueOf(ring, "flex-basis")).toBe("calc(72px * var(--type-scale))");
    expect(propsOf(ring).sort()).toEqual(["flex-basis", "height", "width"]);

    const disc = rule(COMPONENTS, RING_DISC);
    expect(valueOf(disc, "width")).toBe("calc(58px * var(--type-scale))");
    expect(valueOf(disc, "height")).toBe("calc(58px * var(--type-scale))");
    expect(propsOf(disc).sort()).toEqual(["height", "width"]);

    const num = rule(COMPONENTS, RING_NUMBER);
    expect(propsOf(num)).toEqual(["font-size"]);
    expect(valueOf(num, "font-size")).toBe("var(--t-h2)");
    expect(DESIGN).toMatch(/--t-h2:\s*calc\(20px \* var\(--type-scale\)\)/);
  });

  it("the ring grows into the gap beside it (12 to 4, the 8 it gained), so the text column keeps the exact width it had at every phone width", () => {
    const body = rule(COMPONENTS, HERO_ROW);
    expect(propsOf(body)).toEqual(["gap"]);
    expect(valueOf(body, "gap")).toBe("var(--s-1)");
    // 64 + 12 = 72 + 4: the ring and the gap take the same room together as before.
    expect(DESIGN).toMatch(/--s-1:\s*4px/);
    expect(rule(COMPONENTS, ".today-hero-row")).toMatch(/gap: var\(--s-3\)/);
    expect(DESIGN).toMatch(/--s-3:\s*12px/);
    expect(rule(COMPONENTS, ".dring")).toMatch(/width: calc\(64px \* var\(--type-scale\)\)/);
  });

  it("no new rule writes a family, weight, tracking, case, numeral width, colour or fill: nothing but size and room", () => {
    const FORBIDDEN = ["font-family", "font-weight", "font-style", "font-variant-numeric", "letter-spacing", "text-transform", "line-height",
      "color", "background", "background-color", "background-image", "border", "border-color", "box-shadow", "filter", "opacity"];
    const added: [string, string][] = [
      [COMPONENTS, RING], [COMPONENTS, RING_DISC], [COMPONENTS, RING_NUMBER], [COMPONENTS, HERO_ROW], [RULED, CHIP_NUMBER], [RULED, CHIP_BOX],
    ];
    for (const [css, sel] of added) {
      const props = propsOf(rule(css, sel));
      for (const bad of FORBIDDEN) expect(props, `${sel} must not write ${bad}`).not.toContain(bad);
    }
    // The greeting's rule is the one that already existed, so it may keep its weight and tracking, and still writes no colour.
    const greeting = propsOf(rule(COMPONENTS, GREETING));
    for (const bad of ["font-family", "font-style", "text-transform", "color", "background"]) expect(greeting).not.toContain(bad);
  });
});

describe("S1: what the new rules sit on is untouched", () => {
  it("the greeting keeps its display face, the glass sheets keep its tracking and kerning, and the serif word keeps its face, slant and weight", () => {
    expect(DESIGN).toMatch(/\.pagehead-title, \.today-title, [^{]*\{\s*font-family: var\(--f-display\);\s*\}/);
    for (const [css, theme] of [[GLASS_DARK, "dark"], [GLASS_LIGHT, "light"]] as const) {
      expect(css, `${theme} tracking`).toMatch(new RegExp(`html\\[data-theme="${theme}"\\] \\.today-title \\{ letter-spacing: -0\\.03em; \\}`));
      expect(css, `${theme} kerning`).toMatch(new RegExp(`html\\[data-theme="${theme}"\\] \\.today-title \\{ text-rendering: optimizeLegibility; font-kerning: normal; \\}`));
    }
    expect(rule(COMPONENTS, ".today-title .greet-when")).toBe("font-family: 'Newsreader', Georgia, serif; font-style: italic; font-weight: var(--w-regular);");
  });

  it("the base chip rules keep the old numbers: 20 for a number, 11 caps for its word, and the padding every other tile has", () => {
    const n = rule(RULED, ".ruled .stat-tile .st-n");
    expect(n).toMatch(/font-size: var\(--t-h2\)/);
    expect(n).toMatch(/font-weight: var\(--w-bold\)/);
    expect(n).toMatch(/letter-spacing: -0\.02em/);
    expect(n).toMatch(/line-height: 1\.05/);
    const w = rule(RULED, ".ruled .stat-tile .st-w");
    expect(w).toMatch(/font-size: var\(--t-micro\)/);
    expect(w).toMatch(/text-transform: uppercase/);
    expect(rule(RULED, ".ruled .stat-tile")).toMatch(/padding: var\(--s-2\) var\(--s-3\) var\(--s-2\)/);
    expect(rule(RULED, ".ruled .stat-tiles")).toMatch(/flex-wrap: wrap/);
  });

  it("the base ring keeps its 64, 50 and 17, which the evening ring, the goal ring and every other .dring still draw", () => {
    const ring = rule(COMPONENTS, ".dring");
    expect(ring).toMatch(/width: calc\(64px \* var\(--type-scale\)\); height: calc\(64px \* var\(--type-scale\)\)/);
    expect(ring).toMatch(/flex: 0 0 calc\(64px \* var\(--type-scale\)\)/);
    expect(rule(COMPONENTS, ".dring > div")).toMatch(/width: calc\(50px \* var\(--type-scale\)\); height: calc\(50px \* var\(--type-scale\)\)/);
    expect(rule(COMPONENTS, ".dring b")).toMatch(/font-size: calc\(17px \* var\(--type-scale\)\)/);
    expect(rule(COMPONENTS, ".dring span")).toMatch(/font-size: var\(--t-micro\)/);
  });

  it("no rule outside the Today header resizes a ring or a chip number: every .dring and .st-n rule that says a new size lives under .today-hero", () => {
    const loose: string[] = [];
    for (const [file, css] of [["components.css", COMPONENTS], ["ruled.css", RULED]] as const) {
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1]!.trim().replace(/\s+/g, " ");
        const body = m[2]!;
        const ringSize = /\.dring\b/.test(sel) && /(72px|58px|var\(--t-h2\))/.test(body);
        const chipSize = /\.st-n\b/.test(sel) && /var\(--t-title\)/.test(body);
        if ((ringSize || chipSize) && !/\.today-hero\b/.test(sel)) loose.push(`${file}: ${sel}`);
      }
    }
    expect(loose).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The real page: the scope the new selectors rely on
// ---------------------------------------------------------------------------
setCategoryRegistry([{ id: "orgB", name: "Ridgeley", color: "sky" }]);
const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "orgB" } });
const tk = (id: string, due: string | null): TaskItem => ({ id, data: { text: id, category: "orgB", done: false, due } });
const base = {
  greeting: "Good Afternoon, Dave",
  dateLong: "Wednesday, May 20",
  summary: { events: 4, due: 13, overdue: 2, moves: 3 },
  todayEvents: [ev("e1", "09:00")],
  now: "08:00",
  nowLabel: "8:00",
  tomorrowEvents: [ev("t1", "09:00")],
  tomorrowDate: "Thu, May 21",
  tasks: [tk("over", "2026-05-18"), tk("due", "2026-05-20")],
  today: "2026-05-20",
  onSeeAllSchedule: () => {},
  onSeeAllTasks: () => {},
  onGoBigger: () => {},
  ring: { done: 6, total: 13 },
};

describe("S1: the scoped selectors reach the right elements on the real page", () => {
  it("in the morning the greeting, the four chip numbers and the ring are all inside the hero, and the ring is the row's second child", () => {
    const { container } = render(<TodayPage {...base} daypart="morning" />);
    const hero = container.querySelector(".today-hero")!;
    expect(hero.querySelector(".today-hero-row > :first-child .today-title")).not.toBeNull();
    expect(hero.querySelectorAll(".today-summary .stat-tile .st-n")).toHaveLength(4);
    const row = hero.querySelector(".today-hero-row")!;
    expect(row.children).toHaveLength(2);
    expect(row.children[1]).toHaveClass("dring");
    expect(row.querySelector(".dring > div > b")).toHaveTextContent("6/13");
    // exactly one ring on the page in the morning, and it is the one the new rules size
    expect(container.querySelectorAll(".dring")).toHaveLength(1);
  });

  it("in the evening the hero has no ring, and the one in How Today Went sits outside the hero, so it keeps its 64", () => {
    const plan = { picks: [{ id: "p1", text: "Ship it", done: true }, { id: "p2", text: "Call", done: false }], done: 1, total: 2 };
    const evening = { doneDue: 6, dueTotal: 13, eventsLeft: 1, openCount: 7, thingsDone: 9 };
    const { container } = render(<TodayPage {...base} daypart="evening" evening={evening} plan={plan as never} />);
    const hero = container.querySelector(".today-hero")!;
    expect(hero.querySelector(".dring")).toBeNull();
    expect(hero.querySelector(".stat-tile")).toBeNull();
    const rings = [...container.querySelectorAll(".dring")];
    expect(rings).toHaveLength(1);
    expect(rings[0]!.closest(".today-hero")).toBeNull();
    expect(rings[0]!.closest(".card")).not.toBeNull();
  });

  it("the greeting is the one .today-title on the page, so the larger size reaches no other screen title", () => {
    const { container } = render(<TodayPage {...base} daypart="morning" />);
    expect(container.querySelectorAll(".today-title")).toHaveLength(1);
  });
});
