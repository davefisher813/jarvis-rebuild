import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// LAW: EVERY ENVIRONMENT VARIABLE IS WRITTEN DOWN (UP-LAUNCH-04, 2026-09-05).
//
// Nineteen variables were read across api/ and src/ with no list anywhere.
// The cost of that is not confusion, it is a silent wrong default on a
// stranger's deploy: AI_REQUIRE_LIMITS unset served uncapped AI, VITE_ADMIN_API
// unset told an admin the admin server was "wired at launch" while it was
// already deployed, and nobody could tell by reading, because there was
// nothing to read.
//
// So: a variable the code reads has a line in .env.example, and a line in
// .env.example names a variable the code reads. Both directions, because a
// stale example file teaches the wrong thing just as effectively as a missing
// one.
//
// api/ is not in tsconfig and not in the test run, so this file is the only
// automated thing that looks at it at all.

const APP = process.cwd();
const read = (f: string) => readFileSync(f, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const API = walk(join(APP, "api")).filter((f) => f.endsWith(".ts"));
const SRC = walk(join(APP, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
const CONFIGS = [join(APP, "vite.config.ts")];

const example = read(join(APP, ".env.example"));
// A documented variable is one that starts a line as NAME=. Comments explain;
// only an assignment counts as a declaration.
const documented = new Set(
  example.split("\n").map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1]).filter((v): v is string => !!v),
);

function readsOf(files: string[], pattern: RegExp): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const f of files) {
    for (const m of read(f).matchAll(pattern)) {
      const name = m[1]!;
      const where = found.get(name) ?? [];
      where.push(f.slice(APP.length + 1));
      found.set(name, where);
    }
  }
  return found;
}

// Build-only switches: passed on a command line by a build script, never set
// in a dashboard. .env.example lists them in prose at the bottom precisely so
// nobody sets them as configuration.
const BUILD_SWITCHES = new Set(["SINGLEFILE", "CLEAN", "DEMO", "TESTPANEL", "VERCEL_GIT_COMMIT_SHA", "NODE_ENV"]);

describe("LAW: every environment variable the code reads is documented", () => {
  it("no process.env read in api/ is missing from .env.example", () => {
    const reads = readsOf(API, /process\.env\.([A-Z][A-Z0-9_]*)/g);
    const missing = [...reads].filter(([name]) => !documented.has(name) && !BUILD_SWITCHES.has(name));
    expect(missing.map(([name, where]) => `${name} (read in ${where[0]})`)).toEqual([]);
  });

  it("no import.meta.env read in src/ is missing from .env.example", () => {
    const reads = readsOf(SRC, /import\.meta\.env\.(VITE_[A-Z0-9_]*)/g);
    const missing = [...reads].filter(([name]) => !documented.has(name));
    expect(missing.map(([name, where]) => `${name} (read in ${where[0]})`)).toEqual([]);
  });

  it("no documented variable is one nothing reads", () => {
    const everywhere = [...API, ...SRC, ...CONFIGS].map(read).join("\n") + "\n" + read(join(APP, "..", "codemagic.yaml"));
    const orphans = [...documented].filter((name) => !everywhere.includes(name));
    expect(orphans).toEqual([]);
  });

  it("no VITE_ variable holds anything that could be a secret", () => {
    // A VITE_ prefixed variable is compiled into the bundle and shipped to
    // every phone. This is the check that a service key or an API secret
    // never acquires that prefix by copy and paste.
    const vite = [...documented].filter((n) => n.startsWith("VITE_"));
    for (const name of vite) {
      expect(name, "a VITE_ variable is public by construction").not.toMatch(/SECRET|SERVICE_ROLE|PRIVATE|TOKEN_KEY/);
    }
    // ANON key is the one key that is public by design, and it is named so.
    expect(vite).toContain("VITE_SUPABASE_ANON_KEY");
  });

  it("the AI proxy fails closed when it cannot count", () => {
    // UP-LAUNCH-04 flipped this default for Track 3. A deploy with no service
    // role key cannot enforce a per-user or a global cap, and uncapped now
    // means every user at once against one Anthropic key.
    const ai = read(join(APP, "api", "ai.ts"));
    expect(ai).toContain('process.env.AI_REQUIRE_LIMITS !== "0"');
    expect(ai, "the old opt-in form would serve uncapped by default").not.toContain('AI_REQUIRE_LIMITS === "1"');
  });

  it("the admin allowlist still fails closed", () => {
    const admin = read(join(APP, "api", "_admin.ts"));
    const at = admin.indexOf("process.env.ADMIN_USER_IDS");
    expect(at, "the allowlist must still be read from the environment").toBeGreaterThan(-1);
    const gate = admin.slice(at, at + 400);
    expect(gate, "an unset allowlist must deny everyone, never allow everyone").toContain("admins.length === 0");
  });
});
