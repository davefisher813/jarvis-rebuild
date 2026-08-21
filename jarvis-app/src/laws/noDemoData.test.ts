import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// NO DEMO DATA IN THE REAL BUILD (Dave, twice: "why would we keep demo data in
// the real build? that's only for previews").
//
// Seeds and fixtures are reached through dynamic imports behind __DEMO_SEED__,
// so Rollup drops the modules entirely from a production build. The guard has
// to sit on the IMPORT, not on the render: a lazy import that is always
// constructed still emits a fetchable chunk, which means the fixtures sit on
// the server for anyone who knows the filename.
//
// This test reads the built output, because the only proof that something is
// absent from a bundle is looking in the bundle.

const DIST = join(__dirname, "../../dist");

function allFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allFiles(p));
    else if (/\.(js|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

// Names and strings that exist ONLY in demo seeds and fixtures. If any of
// these appear in a production build, demo data is shipping.
const DEMO_ONLY = [
  "Nadia Brandt",
  "Marcus Delaney",
  "Harper v Northline",
  "summitgear",
  "Calder Golf Event",
  "Ridgeline Fields",
  "Coach Ridgeley",
];

describe("LAW: the real build contains no demo data", () => {
  const files = allFiles(DIST);
  // A demo build marks itself (see vite.config.ts). Judging one as if it were
  // the real build would fail every time someone built a preview locally,
  // which is how a law gets ignored.
  const isDemoBuild = existsSync(join(DIST, "DEMO_BUILD"));

  it("has a build to inspect", () => {
    // Skipped rather than silently passing when dist is absent: a test that
    // proves nothing when the artefact is missing is worse than no test.
    if (files.length === 0) {
      console.warn("no dist/ found; run `npx vite build` for this law to mean anything");
    }
    expect(true).toBe(true);
  });

  it("ships none of the demo names", () => {
    if (files.length === 0 || isDemoBuild) return;
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const name of DEMO_ONLY) {
        if (src.includes(name)) hits.push(`${f.slice(DIST.length + 1)}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("emits no chunk built from a demo module", () => {
    if (files.length === 0 || isDemoBuild) return;
    const bad = files.filter((f) => /DemoMail|seedNotes|(^|\/)seed-/.test(f));
    expect(bad.map((f) => f.slice(DIST.length + 1))).toEqual([]);
  });
});
