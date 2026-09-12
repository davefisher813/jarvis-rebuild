import { describe, it, expect } from "vitest";
import { loadOverrides, saveOverride, clearOverride, applyOverrides, KEY } from "./threadOverride";
import { loadRules, KEY as RULES_KEY } from "./rules";
import type { TriageMap } from "./triage";

// E-16 (2026-09-12): a per-thread correction, separate from the sender rule.

function mem(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe("threadOverride", () => {
  it("round-trips a correction and drops anything that is not a bucket", () => {
    const s = mem();
    saveOverride("t1", "worth_knowing", s);
    s.setItem(KEY, JSON.stringify({ ...loadOverrides(s), junk: "banana", t2: "needs_you" }));
    expect(loadOverrides(s)).toEqual({ t1: "worth_knowing", t2: "needs_you" });
  });

  it("clears one thread and leaves the rest", () => {
    const s = mem();
    saveOverride("t1", "worth_knowing", s);
    saveOverride("t2", "needs_you", s);
    expect(clearOverride("t1", s)).toEqual({ t2: "needs_you" });
  });

  it("keeps the newest 200", () => {
    const s = mem();
    for (let i = 0; i < 205; i++) saveOverride("t" + i, "noise", s);
    const all = loadOverrides(s);
    expect(Object.keys(all)).toHaveLength(200);
    expect(all.t0).toBeUndefined();
    expect(all.t204).toBe("noise");
  });

  it("moves only the overridden thread's bucket, and keeps its gist", () => {
    const map: TriageMap = {
      a: { bucket: "needs_you", gist: "the waiver", lastMsgId: "m1" },
      b: { bucket: "needs_you", gist: "the invoice", lastMsgId: "m2" },
    };
    const out = applyOverrides(map, { a: "worth_knowing" });
    expect(out.a).toEqual({ bucket: "worth_knowing", gist: "the waiver", lastMsgId: "m1" });
    expect(out.b).toBe(map.b);
  });

  // Law 4 (section 7): the correction never leaks into the sender rule.
  it("writes no SenderRules entry, ever", () => {
    const s = mem();
    saveOverride("t1", "worth_knowing", s);
    expect(s.getItem(RULES_KEY)).toBeNull();
    expect(loadRules(s)).toEqual({});
  });
});
