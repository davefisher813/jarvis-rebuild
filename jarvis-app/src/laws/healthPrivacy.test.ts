import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sharedView, isKidRoomId, KID_ROOM_CATEGORIES, DEFAULT_GRANTED, HEALTH_CATEGORIES } from "../health/shareLine";
import type { ConsentGrant } from "../health/types";

// THE HEALTH SAFETY RAILS (catalog: claude/HEALTH_CATALOG.md, Part 9), made
// literal. These are additive, health-module-only checks; they do not touch
// or restructure the existing laws.test.ts / editingPrimitives.test.ts files.
//
// Every check here runs against the SOURCE of src/health, not against a
// running app, for the same reason the rest of laws.test.ts does it that
// way: a rule that only fails when someone happens to click through the
// right screen is a rule that mostly does not fire.

const SRC = join(process.cwd(), "src", "health");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL = walk(SRC);
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);
const SOURCES = ALL.filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(SRC.length + 1);

// Strip both comment shapes so a comment may legitimately NAME the thing
// this file exists to ban (every source file in src/health does, in its own
// header), the same convention laws.test.ts already uses for "the app never
// scolds" and "no shame vocabulary".
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("HEALTH LAW: no composite score of a person, ever expressible", () => {
  // Rail 1. If the word cannot appear in the module at all (outside a
  // comment explaining why not), nobody can add a `readiness` field "just
  // this once" without this failing the same day.
  it("no readiness, recovery, wellness, or score vocabulary in rendered or typed code", () => {
    const banned = /\b(readiness|recovery|wellness|score)\b/i;
    const bad: string[] = [];
    for (const f of SOURCES) {
      strip(read(f)).split("\n").forEach((line, i) => {
        if (banned.test(line)) bad.push(rel(f) + ":" + (i + 1) + " " + line.trim().slice(0, 80));
      });
    }
    expect(bad).toEqual([]);
  });
});

describe("HEALTH LAW: no calorie, macro, weight, or body-composition field", () => {
  // Rail 3, schema-level. Scoped to src/health so this cannot be satisfied
  // by simply not USING such a field somewhere in a screen; it cannot be
  // declared anywhere in the module, typed or otherwise.
  it("no such vocabulary anywhere in src/health", () => {
    const banned = /\b(calorie|calories|macro|macros|bodyfat|body_fat|bodycomposition|body_composition|weightkg|weightlb|bodyweight|body_weight)\b/i;
    const bad: string[] = [];
    for (const f of SOURCES) {
      strip(read(f)).split("\n").forEach((line, i) => {
        if (banned.test(line)) bad.push(rel(f) + ":" + (i + 1) + " " + line.trim().slice(0, 80));
      });
    }
    expect(bad).toEqual([]);
  });
});

describe("HEALTH LAW: no named diagnosis is ever rendered as a system statement", () => {
  // Rail 4. Point at It and Still There? are the two features that could
  // plausibly slip into naming a condition; scoped to the whole module
  // because nothing else in src/health needs this vocabulary either.
  it("no diagnosis vocabulary in rendered or typed code", () => {
    const banned = /\b(concussion|stress fracture|tendinitis|shin splint|red-s|acl tear|depression)\b/i;
    const bad: string[] = [];
    for (const f of SOURCES) {
      strip(read(f)).split("\n").forEach((line, i) => {
        if (banned.test(line)) bad.push(rel(f) + ":" + (i + 1) + " " + line.trim().slice(0, 80));
      });
    }
    expect(bad).toEqual([]);
  });
});

describe("HEALTH LAW: no count of failures", () => {
  // Rail 2. A literal fraction in source ("2 of 6", "3 of 10 doses") is how
  // this bug ships: someone writes the count-and-total pair directly rather
  // than building it from two live numbers, which is exactly what the
  // timeline functions in timelines.ts refuse to compute in the first
  // place. "missed" is banned outright in rendered copy: nothing in this
  // module has an expected count to fall short of, so there is no honest
  // use of the word here.
  it("no literal N-of-M fraction and no 'missed' in rendered or typed code", () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      const src = strip(read(f));
      if (/\bmissed\b/i.test(src)) bad.push(rel(f) + ": the word 'missed'");
      for (const m of src.matchAll(/["'`][^"'`\n]*\b\d+\s+of\s+\d+\b[^"'`\n]*["'`]/g)) {
        bad.push(rel(f) + ": literal fraction " + m[0]);
      }
    }
    expect(bad).toEqual([]);
  });

  // The positive half: the loggers' own data shapes carry no field an
  // expected/target count could be read from, so "N missed" has nothing to
  // compute itself from even if someone tried.
  it("the logged shapes carry no expected-count or target field", () => {
    const types = read(join(SRC, "types.ts"));
    for (const field of ["expected", "scheduledAt", "target", "expectedCount"]) {
      expect(types, field + " must not appear as a field in health/types.ts").not.toMatch(new RegExp(field + "\\s*[?:]"));
    }
  });
});

describe("HEALTH LAW: THE KID'S ROOM is a floor, not a default", () => {
  // Structural: setGrant/updateGrant's category parameter is typed
  // HealthCategoryId, which KidRoomCategoryId is not a member of. Checked
  // by reading the exported signature text rather than trusting the type
  // checker alone, so a future refactor that widens the parameter type
  // fails this test immediately instead of silently reopening the hole.
  it("updateGrant only accepts HealthCategoryId, never KidRoomCategoryId, in its signature", () => {
    const src = read(join(SRC, "shareLine.ts"));
    const m = /export function updateGrant\(([^)]*)\)/.exec(src);
    expect(m, "updateGrant must exist with a readable signature").toBeTruthy();
    expect(m![1]).toMatch(/category:\s*HealthCategoryId/);
    expect(m![1]).not.toMatch(/KidRoomCategoryId/);
  });

  // sharedView must check isKidRoomId BEFORE it ever consults the grants
  // list, so a corrupted or hand-edited grants array cannot smuggle a
  // Kid's Room category through by claiming it is "granted". Order matters:
  // a check placed after the grant lookup would only ever run on items that
  // already failed to match a grant, which defeats the point.
  it("sharedView checks isKidRoomId unconditionally, before consulting any grant", () => {
    const src = read(join(SRC, "shareLine.ts"));
    const start = src.indexOf("export function sharedView");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}", start));
    const kidRoomCheck = body.indexOf("isKidRoomId(");
    const grantCheck = body.indexOf("granted.has(");
    expect(kidRoomCheck).toBeGreaterThan(-1);
    expect(grantCheck).toBeGreaterThan(-1);
    expect(kidRoomCheck).toBeLessThan(grantCheck);
  });

  // Runtime proof of the same claim: a Kid's Room category never survives
  // sharedView even when a forged grants array claims it is granted.
  it("a Kid's Room category never appears in a parent-visible query, even with a forged grant", () => {
    const items = KID_ROOM_CATEGORIES.map((category, i) => ({ id: String(i), data: { category } }));
    const forged: ConsentGrant[] = KID_ROOM_CATEGORIES.map(
      (category) => ({ category: category as unknown as ConsentGrant["category"], granted: true, updatedAt: 1 }),
    );
    expect(sharedView(items, forged)).toEqual([]);
    for (const c of KID_ROOM_CATEGORIES) expect(isKidRoomId(c)).toBe(true);
  });

  // The UI half: the Share Line's Kid's Room rows carry no onClick handler
  // that could reach a grant setter, so there is no path from a tap on
  // that screen to a Kid's Room category ever being marked granted.
  it("ShareLineScreen's Kid's Room rows carry no onClick", () => {
    const src = read(join(SRC, "screens", "ShareLineScreen.tsx"));
    const start = src.indexOf("KID_ROOM_CATEGORIES.map");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("</div></div>", start));
    expect(block).not.toMatch(/onClick/);
  });

  // No literal Kid's Room category id is ever passed as an argument to a
  // grant-setting call anywhere in the module (setGrant, updateGrant, or a
  // screen's onToggle prop).
  it("no Kid's Room category id is ever passed to a grant-setting call", () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      const src = read(f);
      for (const call of ["setGrant(", "updateGrant(", "onToggle("]) {
        for (const m of src.matchAll(new RegExp(call.replace("(", "\\(") + '\\s*"(mind|cycle|notes)"', "g"))) {
          bad.push(rel(f) + ": " + call + '"' + m[1] + '"');
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("HEALTH LAW: off by default, except pure logistics", () => {
  it("every body-data category defaults to ungranted; only logistics defaults on", () => {
    for (const c of HEALTH_CATEGORIES) {
      expect(DEFAULT_GRANTED[c], c).toBe(c === "logistics");
    }
  });
});

describe("HEALTH LAW: everything logs offline", () => {
  // Rail 7. Every logXxx method on HealthService must go through the
  // localStorage-backed pending queue rather than calling the Store
  // directly, so a tap in a gym basement is never blocked on the network.
  it("every logger writes through queueHealthLog before touching the Store", () => {
    const src = read(join(SRC, "HealthService.ts"));
    for (const method of ["logLightsOut", "logAteBefore", "logTookIt", "logCallIt", "logPointAtIt"]) {
      const start = src.indexOf(method + "(");
      expect(start, method + " must exist").toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n  }", start));
      expect(body, method + " must queue before returning").toMatch(/logAndQueue\(/);
    }
    // And logAndQueue itself is the one and only path into the pending
    // queue that all five funnel through, so a future sixth logger inherits
    // the guarantee just by calling it.
    const helper = src.slice(src.indexOf("private logAndQueue"), src.indexOf("private logAndQueue") + 300);
    expect(helper).toMatch(/queueHealthLog\(/);
  });
});
