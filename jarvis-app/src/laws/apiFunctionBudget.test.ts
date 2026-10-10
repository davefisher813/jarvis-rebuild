// LAW: THE HOST PLAN CAPS HOW MANY API FILES A DEPLOYMENT MAY HOLD (2026-10-08).
//
// A 31st file under api/ failed the production build ("No more than 12 Serverless Functions can be added to a Deployment on
// the Hobby plan", errorStep patchBuild) and, because the PR checks do not include the host's build, merged anyway: the
// deploy simply never went live. Every file in api/ that does not start with an underscore is a function; underscore files are
// modules. A new endpoint is a branch inside an existing route (see api/_outboxWorker.ts, reached through api/email/send.ts),
// or a module, or it needs the plan to change first. Raise this number only when the plan has changed.
//
// CORRECTION (2026-10-10): the 12 in that error is the binding number, and it counts NODE.JS functions only. Every route here
// declares the edge runtime, so the routes never touched it. What filled it was the TEST files under api/: Vercel deploys any
// non-underscore file there as a function, and a test declares no runtime, so each one was a Node.js function. On 2026-10-08
// there were 12; renaming api/cron/outbox.test.ts to _outboxWorker.test.ts is what brought the count back under, not the
// route count. Adding api/admin/users.test.ts made 13 and failed every production build from PR #74 on. The fix is
// .vercelignore (tests never deploy) and the two checks below. The route cap above is kept as it was.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const API = resolve(__dirname, "../../api");
const VERCELIGNORE = resolve(__dirname, "../../.vercelignore");
const MAX_API_FILES = 30;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !name.startsWith("_") && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p.slice(API.length + 1));
  }
}

describe("LAW: the API file budget", () => {
  it(`api/ holds at most ${MAX_API_FILES} route files (a 31st failed the production build)`, () => {
    const files: string[] = [];
    walk(API, files);
    expect(files.length).toBeLessThanOrEqual(MAX_API_FILES);
  });

  it("every route declares the edge runtime (a Node.js function counts against the plan's 12)", () => {
    const files: string[] = [];
    walk(API, files);
    const notEdge = files.filter((f) => !/runtime:\s*"edge"/.test(readFileSync(join(API, f), "utf8")));
    expect(notEdge).toEqual([]);
  });

  it(".vercelignore keeps the api/ test files out of the deploy (each would be a Node.js function)", () => {
    const lines = readFileSync(VERCELIGNORE, "utf8").split("\n").map((l) => l.trim());
    expect(lines).toContain("api/**/*.test.ts");
  });
});
