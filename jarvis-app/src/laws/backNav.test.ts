import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// BACK GOES BACK (Dave 2026-09-21: "I need you to FULLY audit back buttons on
// every single page and the logic. There are a bunch that take you to other
// pages and not the previous page. It should always be the previous page").
//
// WHAT THE AUDIT FOUND, and it is not what it looked like. Ninety-one back
// controls. Sixty-five are a bare chevron that pops the flow's own state, and
// those are correct by construction: within a flow, the step you came from IS
// the previous page. Of the twenty-six that NAME a destination, every single
// one is mounted by exactly one parent, and that parent is what the label
// says. No label lies about its own parent.
//
// The failure is one level up. The shell can drop you into a flow from
// another tab, and the flow cannot tell:
//
//   Today -> Start Now  jumps into the Tasks flow's start screen, whose back
//                       said "All Tasks" and went there.
//   Email -> Connections jumps into the More tab's connections page, whose
//                       back said "Settings" and went there.
//
// Both labels were true about the component tree and false about the journey.
// shell/navOrigin.tsx carries the origin WITH the jump so only the page that
// jump opened can read it; an unrelated back (Settings -> Advanced -> back)
// never sees it and never changes.
//
// These laws hold the two halves: every cross-tab jump records where it came
// from, and a page reachable by one of those jumps offers the way back.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const SHELL = read("shell/AppShell.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\./.test(e)) out.push(p);
  }
  return out;
}

describe("a cross-tab jump remembers where it came from", () => {
  // The shell is the only thing that can change tabs, so this is the whole
  // surface: every setActive that is not the tab bar, the boot default or the
  // return itself has to go through `jump`.
  it("every navigation that changes tab goes through jump", () => {
    const body = SHELL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // jumpToEntity's whole body is inside one jump(), so its branches are
    // covered by the wrapper rather than line by line.
    const JUMPED = body.slice(body.indexOf("const jumpToEntity ="), body.indexOf("const [notesChrome"));
    // A NOTIFICATION IS A JUMP THE OS MADE, from outside the app: there is no
    // previous page in here to return to, and the switcher is its back. Both
    // halves are exempt -- the tap handler and openFromBanner, which is the
    // one function it calls that lands somewhere.
    const TAPPED = body.slice(body.indexOf("const openFromBanner ="), body.lastIndexOf("onNotificationTap") + 1200);
    const loose: string[] = [];
    for (const line of body.split("\n")) {
      if (!/setActive\(/.test(line)) continue;
      // The tab bar itself, the boot/migration default, and navBack's own
      // restore are roots, not jumps. goLife is a helper, and its CALLERS
      // are what decide whether a jump is happening.
      if (/setActive\(k\)|setActive\(keys\[0\]|setActive\(o\.key\)|const goLife =/.test(line)) continue;
      if (JUMPED.includes(line) || TAPPED.includes(line)) continue;
      if (!/jump\(/.test(line)) loose.push(line.trim().slice(0, 90));
    }
    expect(loose, "these change tab without recording an origin").toEqual([]);
  });

  it("a tab tap is a new root and clears the origin", () => {
    const bar = SHELL.slice(SHELL.indexOf("<TabBar"), SHELL.indexOf("<TabBar") + 900);
    expect(bar).toMatch(/setOrigin\(null\)/);
  });

  // Going back must leave the tab you return to as a tab, not as a tab with
  // the sheet the jump opened still on top of it.
  it("going back closes whatever the jump opened", () => {
    const fn = SHELL.slice(SHELL.indexOf("const navBack ="), SHELL.indexOf("const navBack =") + 400);
    expect(fn).toMatch(/clearAllRef\.current\(\)/);
    expect(fn).toMatch(/setOrigin\(null\)/);
  });
});

// ---------------------------------------------------------------------------
// AND THE MODALS (Dave 2026-09-22: "make sure all modals and screens no
// matter where they are get addressed").
//
// The modal audit came back clean on the thing it was looking for: all sixty
// sheet render sites have BOTH a scrim tap and a Cancel, so no sheet in the
// app is a dead end. The gap was what happens AFTER one closes. A Cancel
// means "close this sheet" and leave you on the page behind it, which is
// right and must not change -- but when a cross-tab jump opened the sheet,
// the page behind it is a tab you never chose.
// ---------------------------------------------------------------------------
describe("no modal is a dead end", () => {
  it("every sheet can be dismissed by tapping its scrim", () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/className="sheet-scrim[^"]*"([^>]*)>/g)) {
        if (!/onClick/.test(m[1] ?? "")) bad.push(f.slice(SRC.length + 1));
      }
    }
    // The scrim is the exit that cannot be pushed below the fold, which is
    // how the Add-from-Your-Lifts sheet froze the app in September.
    expect([...new Set(bad)], "a sheet whose only exit can scroll away").toEqual([]);
  });
});

describe("closing a modal never strands you", () => {
  it("the shell draws one way home while a jump is live", () => {
    const pill = read("shell/ReturnPill.tsx");
    expect(pill, "it reads the origin").toMatch(/useNavOrigin\(\)/);
    expect(pill, "and nothing else decides when it shows")
      .toMatch(/if \(!nav\.origin \|\| nav\.claimed\) return null;/);
    expect(SHELL, "the shell mounts it once, outside every flow").toMatch(/<ReturnPill \/>/);
  });

  // TWO BACKS ON ONE SCREEN IS THE DRIFT THIS WHOLE PASS IS ABOUT. A page
  // whose own control already offers the way home claims the origin, and the
  // pill stands down for as long as that page is mounted.
  it("a page that offers its own way home suppresses the pill", () => {
    const helper = read("shell/navOrigin.tsx");
    expect(helper).toMatch(/return claim\(\);/);
    expect(SHELL, "and the claim is stable, or the effect claims in a loop")
      .toMatch(/const claim = useCallback\(/);
  });
});

describe("the page a jump opens offers the way back", () => {
  // The two the audit proved. Each says its own name when you reached it the
  // ordinary way and the origin's when a jump brought you.
  it("Start Now and Connections both defer to the origin", () => {
    for (const [f, own] of [
      ["tasks/screens/StartScreen.tsx", '"All Tasks"'],
      ["connections/ConnectionsPage.tsx", '"Settings"'],
    ] as const) {
      const src = read(f);
      expect(src, f + " must read the origin").toMatch(/useLeaveVia\(/);
      expect(src, f + " keeps its own label as the fallback").toContain(own);
      expect(src, f + " must render the resolved label").toMatch(/\{leave\.label\}/);
    }
  });

  // THE SIDE EFFECT SURVIVES. StartScreen's own back writes the stop point;
  // a version that swapped the handler out for the origin would drop it.
  it("a page's own close still runs before the shell returns", () => {
    const helper = read("shell/navOrigin.tsx");
    const fn = helper.slice(helper.indexOf("export function useLeaveVia"));
    expect(fn, "own() is called unconditionally").toMatch(/onBack: \(\) => \{ own\(\); nav\.back\(\); \}/);
    expect(read("tasks/screens/StartScreen.tsx"), "and the stop point is what it writes")
      .toMatch(/useLeaveVia\("All Tasks", \(\) => onBack\(suggestStopPoint\(text\)\)\)/);
  });

  // The other twenty-four labelled backs are correct BECAUSE each has one
  // parent. If a second mount appears, the label starts lying the way these
  // two did, and this is the test that says so before he has to find it.
  it("no page names a destination while more than one parent mounts it", () => {
    const files = walk(SRC);
    const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
    const OPT_IN = /useLeaveVia\(/;
    const bad: string[] = [];
    for (const [f, src] of text) {
      const labels = [
        ...[...src.matchAll(/back="([A-Za-z][A-Za-z ]*)"/g)].map((m) => m[1]!),
        ...[...src.matchAll(/className="nav-back"[^>]*>([A-Za-z][A-Za-z ]*)</g)].map((m) => m[1]!),
      ].filter((l) => l !== "Back");
      if (labels.length === 0 || OPT_IN.test(src)) continue;
      const name = f.slice(f.lastIndexOf("/") + 1).replace(/\.tsx?$/, "");
      const mounts = new Set<string>();
      for (const [g, gs] of text) {
        if (g === f) continue;
        if (new RegExp("<" + name + "[\\s/>]").test(gs)) mounts.add(g);
      }
      if (mounts.size > 1) bad.push(`${name} says "${labels.join("/")}" but ${mounts.size} parents mount it`);
    }
    expect(bad, "a named back with two parents cannot be right for both").toEqual([]);
  });
});
