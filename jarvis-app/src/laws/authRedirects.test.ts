import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// EVERY AUTH CALL THAT LEAVES THE APP NAMES WHERE IT COMES BACK (P0, 2026-10-04).
//
// A demo tester reset her password and the link in the email opened
// http://localhost:3000. Supabase puts the redirect the app asks for into the
// email only when it is on the project's allow list (Authentication > URL
// Configuration); otherwise it uses the project's Site URL, which was still
// the default. Nothing in this repo can set that list, so the repo's half is
// to ask for the right place every time and to never ask for a bad one.
//
// Two things are fixed here, read from the source rather than remembered:
//   1. Every call that sends an email or bounces the browser (signInWithOtp,
//      signUp, resetPasswordForEmail, signInWithOAuth, resend) passes a
//      redirect. A new call that forgets it fails this file.
//   2. No source names localhost as a place for an auth link to land. A
//      production build asking for a localhost redirect would be the same bug
//      in the other direction.

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");
const API = join(ROOT, "api");
const read = (f: string) => readFileSync(f, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const SOURCES = [...walk(SRC), ...walk(API)].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.includes("/bench/"));
const rel = (f: string) => f.slice(ROOT.length + 1);

// The slice of source from a call's open paren to its matching close paren.
function callBody(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return src.slice(from, i + 1); }
  }
  return src.slice(from);
}

const EMAIL_CALLS: { call: string; key: RegExp }[] = [
  { call: "signInWithOtp", key: /emailRedirectTo/ },
  { call: "signUp", key: /emailRedirectTo/ },
  { call: "resetPasswordForEmail", key: /redirectTo/ },
  { call: "signInWithOAuth", key: /redirectTo/ },
  { call: "resend", key: /emailRedirectTo/ },
];

describe("AUTH REDIRECT law 1: every call that sends an email or opens a provider names where it lands", () => {
  it("finds the calls at all", () => {
    const found = SOURCES.flatMap((f) => [...read(f).matchAll(/\bauth\.(signInWithOtp|signUp|resetPasswordForEmail|signInWithOAuth|resend)\s*\(/g)]);
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  for (const { call, key } of EMAIL_CALLS) {
    it(`${call} always passes a redirect`, () => {
      const bad: string[] = [];
      for (const f of SOURCES) {
        const src = read(f);
        for (const m of src.matchAll(new RegExp(`\\bauth\\.${call}\\s*\\(`, "g"))) {
          const body = callBody(src, m.index! + m[0].length - 1);
          if (!key.test(body)) bad.push(`${rel(f)}: auth.${call}(...) names no redirect`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("AUTH REDIRECT law 2: no auth link is pointed at localhost", () => {
  it("no source passes a localhost redirect to an auth call", () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      const src = read(f);
      for (const m of src.matchAll(/(?:emailRedirectTo|redirectTo)\s*[:=]\s*([^,}\n]+)/g)) {
        if (/localhost|127\.0\.0\.1/.test(m[1]!)) bad.push(`${rel(f)}: ${m[0].trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the native redirect is the app's own scheme and the web redirect is the page's own origin", () => {
    const link = read(join(SRC, "auth/authLink.ts"));
    expect(link).toMatch(/NATIVE_AUTH_REDIRECT = "jarvis:\/\/auth"/);
    expect(link).toMatch(/const origin = webOrigin\(\)/);
    const base = read(join(SRC, "shared/apiBase.ts"));
    expect(base).toMatch(/window\.location\.origin/);
  });
});
