import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FLAGS, parseFlags } from "./flagList";
import { flagOn, flagsOn, FLAGS as REEXPORTED } from "./flags";

// Phase 0 (2026-10-10): the flag roster lives in a module with no environment
// in it, so a law or a script can know the flags without Vite; flags.ts is the
// one env read and re-exports the roster.
describe("flagList: the roster and the parser", () => {
  it("names the four flags that existed and the three Phase 0 adds", () => {
    expect([...FLAGS]).toEqual([
      "substrate_v1", "email_intake_v1", "verified_agent_adapters", "email_hold_v1",
      "memory_v1", "trust_v1", "vyzn_sync_v1",
    ]);
  });

  it("parses a build string, forgives whitespace and drops names it does not know", () => {
    expect([...parseFlags("memory_v1, trust_v1 ,nope")]).toEqual(["memory_v1", "trust_v1"]);
    expect(parseFlags(undefined).size).toBe(0);
    expect(parseFlags("").size).toBe(0);
  });

  it("reads no environment", () => {
    const src = readFileSync(join(__dirname, "flagList.ts"), "utf8");
    expect(src).not.toContain("import.meta.env");
    expect(src).not.toContain("process.env");
  });
});

describe("flags: the app's readers over the same roster", () => {
  it("re-exports the one roster", () => {
    expect(REEXPORTED).toBe(FLAGS);
  });

  it("flagOn and flagsOn answer from the set they are given, in roster order", () => {
    const set = parseFlags("vyzn_sync_v1,memory_v1");
    expect(flagOn("memory_v1", set)).toBe(true);
    expect(flagOn("trust_v1", set)).toBe(false);
    expect(flagsOn(set)).toEqual(["memory_v1", "vyzn_sync_v1"]);
  });
});
