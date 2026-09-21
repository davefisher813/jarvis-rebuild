import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");

// ---------------------------------------------------------------------------
// LAW: A FUNCTION THAT IS WRITTEN AND TESTED AND CALLED BY NOTHING IS A
// FEATURE THAT IS HALF BUILT.
//
// Dave, 2026-09-21: "There's also no superset buttons anywhere in the workout
// pages. I don't understand how you just ignore my requests." He was right,
// and fixing the buttons turned up the same defect one layer down:
// `ungroupToday` in gym/liveGroups.ts had been written, documented, and given
// its own passing unit tests -- and was imported by nothing. You could make a
// superset for today and the only way out was a five second toast.
//
// Every guard the repo already had says that was fine. The module is
// reachable (its sibling `withLiveGroups` is used everywhere), so the
// unreachable-module law was satisfied. The export had tests, so coverage was
// satisfied. The tests passed, so the suite was green. A function can be
// perfectly tested and still be attached to nothing, and the test suite is
// the last place that will tell you, because a unit test is a caller.
//
// So this counts callers that are not tests. An export used only by its own
// test file is either wired up or deliberately named here with the reason it
// is not, which is the same shape every other roster in these laws uses.
// ---------------------------------------------------------------------------

/** Named, with the reason, the way every roster in this directory is.
 *  Empty, because gym/ has none left. */
const ROSTER: Record<string, string> = {};

// WHY THIS IS SCOPED TO gym/ AND NOT THE WHOLE APP (2026-09-21).
//
// Run over all of src it names about sixty exports, and they are not one
// thing. Some are test utilities by their own name (resetOutboxForTest).
// Some are a whole layer waiting on a build that has not happened: native/
// carries workoutFromHealth, dedupeHealthWorkouts and enrichPeople, all
// written, all tested, all called by nothing -- and CLAUDE.md says why, the
// iOS half is deferred until there is a native build to put it in. That is a
// roster entry with a real reason, not a bug, and the difference can only be
// decided one export at a time by someone who knows what each was for.
//
// So this guards the area the drift was actually found in, today, at zero
// roster entries -- and widening it is a named piece of work in
// docs/AUDIT_CHECKLIST.md rather than a number quietly left out of a report.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "bench" ? [] : walk(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });

describe("LAW: an export that only its own test calls is half a feature", () => {
  it("every exported function in gym/ has a caller that is not a test", () => {
    const files = walk(join(SRC, "gym")).filter((f) => !/\.test\.tsx?$/.test(f));
    const sources = walk(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .map((f) => [f, readFileSync(f, "utf8")] as const);

    const dead: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const mod = f.slice(SRC.length + 1).replace(/\.tsx?$/, "");
      for (const m of src.matchAll(/^export function (\w+)/gm)) {
        const name = m[1]!;
        if (ROSTER[mod + "." + name]) continue;
        // A caller is any non-test source that names it, INCLUDING the
        // declaring file below its own signature: `restRemainingSec` is used
        // three times inside RestTimer.tsx and exported so its arithmetic can
        // be tested directly, which is a used helper and not a dead one. What
        // this is looking for is the export whose only references anywhere
        // are in test files.
        const inOwn = new RegExp("\\b" + name + "\\b").test(src.replace(m[0]!, ""));
        const used = inOwn || sources.some(([g, text]) =>
          g !== f && new RegExp("\\b" + name + "\\b").test(text));
        if (!used) dead.push(mod + "." + name);
      }
    }
    expect(dead, "written, tested, and wired to nothing -- wire it or roster it with the reason").toEqual([]);
  });
});
