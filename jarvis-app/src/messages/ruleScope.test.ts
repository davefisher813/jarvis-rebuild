import { describe, it, expect } from "vitest";
import { normalizeRule, migrateRules, ruleApplies } from "./ruleScope";
import { loadRules, saveRule, setRuleEnabled, setRuleAccount, applyRules, clearRule, KEY } from "./rules";
import type { TriageMap } from "./triage";
import type { ThreadRow } from "../connections/google/map";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, raw: m };
}
const row = (id: string, fromEmail: string, account?: string): ThreadRow => ({
  id, from: fromEmail, fromEmail, subject: "s", snippet: "", dateMs: 1, unread: false, count: 1, inInbox: true, lastMsgId: "m" + id,
  ...(account ? { account } : {}),
});
const map = (ids: string[]): TriageMap => Object.fromEntries(ids.map((id) => [id, { bucket: "worth_knowing" as const, gist: "g", lastMsgId: "m" + id }]));

// E-24 (Push E): Standing Rules v2. Account and on/off on top of the
// sender -> bucket core, and a migration that loses nothing.
describe("ruleScope v2", () => {
  it("reads a v1 bucket string as an on, all-accounts rule", () => {
    expect(normalizeRule("noise")).toEqual({ bucket: "noise", enabled: true });
    expect(normalizeRule("nonsense")).toBeNull();
    expect(normalizeRule({ bucket: "needs_you", account: "Dave@Work.com", enabled: false })).toEqual({ bucket: "needs_you", account: "dave@work.com", enabled: false });
    expect(normalizeRule({ bucket: "needs_you" })).toEqual({ bucket: "needs_you", enabled: true });
    expect(normalizeRule({ bucket: "later" })).toBeNull();
    expect(migrateRules({ "a@x.com": "noise", "b@x.com": { bucket: "noise", enabled: false }, "c@x.com": 3 }))
      .toEqual({ "a@x.com": { bucket: "noise", enabled: true }, "b@x.com": { bucket: "noise", enabled: false } });
  });

  it("migrates the stored v1 map on read and writes v2 back on the next save", () => {
    const s = mem();
    s.setItem(KEY, JSON.stringify({ "old@x.com": "noise" }));
    expect(loadRules(s)).toEqual({ "old@x.com": { bucket: "noise", enabled: true } });
    saveRule("new@x.com", "needs_you", s);
    expect(JSON.parse(s.raw.get(KEY)!)).toEqual({
      "old@x.com": { bucket: "noise", enabled: true },
      "new@x.com": { bucket: "needs_you", enabled: true },
    });
  });

  it("off is not gone: the mapping stays, applyRules skips it, filing again turns it on", () => {
    const s = mem();
    saveRule("promo@x.com", "noise", s);
    let rules = setRuleEnabled("promo@x.com", false, s);
    expect(rules["promo@x.com"]).toEqual({ bucket: "noise", enabled: false });
    expect(applyRules(map(["t1"]), [row("t1", "promo@x.com")], rules)["t1"]!.bucket).toBe("worth_knowing");
    rules = setRuleEnabled("promo@x.com", true, s);
    expect(applyRules(map(["t1"]), [row("t1", "promo@x.com")], rules)["t1"]!.bucket).toBe("noise");
    setRuleEnabled("promo@x.com", false, s);
    expect(saveRule("promo@x.com", "noise", s)["promo@x.com"]!.enabled).toBe(true);
    // Unknown sender: nothing written.
    expect(setRuleEnabled("nobody@x.com", false, s)["nobody@x.com"]).toBeUndefined();
  });

  it("an account-scoped rule speaks only for that inbox; All speaks for every one", () => {
    const s = mem();
    saveRule("promo@x.com", "noise", s);
    const scoped = setRuleAccount("promo@x.com", "Dave@Work.com", s);
    expect(scoped["promo@x.com"]).toEqual({ bucket: "noise", enabled: true, account: "dave@work.com" });
    const rows = [row("w", "promo@x.com", "dave@work.com"), row("h", "promo@x.com", "dave@home.com"), row("n", "promo@x.com")];
    const out = applyRules(map(["w", "h", "n"]), rows, scoped);
    expect(out["w"]!.bucket).toBe("noise");
    expect(out["h"]!.bucket).toBe("worth_knowing");
    expect(out["n"]!.bucket).toBe("worth_knowing");
    const all = setRuleAccount("promo@x.com", undefined, s);
    expect(all["promo@x.com"]).toEqual({ bucket: "noise", enabled: true });
    expect(Object.values(applyRules(map(["w", "h", "n"]), rows, all)).every((t) => t.bucket === "noise")).toBe(true);
    // Filing again keeps the scope he chose.
    setRuleAccount("promo@x.com", "dave@work.com", s);
    expect(saveRule("promo@x.com", "needs_you", s)["promo@x.com"]).toEqual({ bucket: "needs_you", enabled: true, account: "dave@work.com" });
    expect(ruleApplies({ bucket: "noise", enabled: true, account: "a@x.com" }, "A@X.com")).toBe(true);
    expect(ruleApplies({ bucket: "noise", enabled: false }, undefined)).toBe(false);
  });

  it("clearRule still removes the whole entry", () => {
    const s = mem();
    saveRule("promo@x.com", "noise", s);
    setRuleEnabled("promo@x.com", false, s);
    expect(clearRule("promo@x.com", s)).toEqual({});
    expect(loadRules(s)).toEqual({});
  });
});
