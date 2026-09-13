// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { derivePrinciple, answerPrinciple, principleAnswered, MIN_PRINCIPLE_DECISIONS, type DeriveDecision } from "./principle";

// C-63 (Astra, 2026-09-12).
const dec = (id: string, ruledOut: string[], label?: string): DeriveDecision => ({
  id, decision: "d" + id, ruledOut, createdAt: "2026-09-0" + id + "T12:00:00.000Z",
  ...(label ? { links: [{ type: "org", id: "o-" + label, label }] } : {}),
});

describe("derivePrinciple", () => {
  it("needs three decisions ruling out the same live area, and names what won instead", () => {
    const ds = [dec("1", ["Jarvis polish"], "Bridge"), dec("2", ["optional Jarvis work"], "Bridge"), dec("3", ["Jarvis"], "Tucci")];
    expect(derivePrinciple(ds.slice(0, 2), ["Jarvis", "Bridge"])).toBeNull();
    const d = derivePrinciple(ds, ["Jarvis", "Bridge"])!;
    expect(d.derivation).toBe("principle");
    expect(d.category).toBe("values");
    expect(d.strandText).toBe("Bridge wins ties over Jarvis");
    expect(d.title).toBe("\"Bridge before Jarvis\" looks like a standing rule");
    expect(d.sub).toBe("3 Decisions");
    expect(d.evidence.length).toBe(3);
    expect(MIN_PRINCIPLE_DECISIONS).toBe(3);
  });

  it("with no home chosen instead, says only what keeps getting ruled out", () => {
    const ds = [dec("1", ["Jarvis"]), dec("2", ["Jarvis polish"]), dec("3", ["the Jarvis roadmap"])];
    expect(derivePrinciple(ds, ["Jarvis"])!.strandText).toBe("Jarvis is what gets ruled out");
  });

  it("never invents an area: only live area names count", () => {
    const ds = [dec("1", ["Clover"]), dec("2", ["Clover"]), dec("3", ["Clover"])];
    expect(derivePrinciple(ds, ["Bridge"])).toBeNull();
  });
});

describe("the two quiet answers", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* node */ } });
  it("Only Sometimes rests the question for a month; Not True closes it", () => {
    answerPrinciple("Bridge wins ties over Jarvis", "sometimes", "2026-09-12");
    expect(principleAnswered("Bridge wins ties over Jarvis", "2026-09-20")).toBe(true);
    expect(principleAnswered("Bridge wins ties over Jarvis", "2026-10-20")).toBe(false);
    answerPrinciple("Jarvis is what gets ruled out", "never", "2026-09-12");
    expect(principleAnswered("Jarvis is what gets ruled out", "2027-01-01")).toBe(true);
    expect(principleAnswered("something else", "2026-09-12")).toBe(false);
  });
});
