// LAW: THE HOST PLAN CAPS HOW MANY API FILES A DEPLOYMENT MAY HOLD (2026-10-08).
//
// A 31st file under api/ failed the production build ("No more than 12 Serverless Functions can be added to a Deployment on
// the Hobby plan", errorStep patchBuild) and, because the PR checks do not include the host's build, merged anyway: the
// deploy simply never went live. Every file in api/ that does not start with an underscore is a function; underscore files are
// modules. A new endpoint is a branch inside an existing route (see api/_outboxWorker.ts, reached through api/email/send.ts),
// or a module, or it needs the plan to change first. Raise this number only when the plan has changed.
import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const API = resolve(__dirname, "../../api");
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
});
