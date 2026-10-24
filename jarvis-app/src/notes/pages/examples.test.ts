import { describe, it, expect } from "vitest";
import { EXAMPLES, withExample, clearExample, hasExample } from "./examples";
import { TEMPLATES, newTemplatePage, isTemplateKey } from "./templateDefs";
import { newOutreachPage, newTeamPage, setValues, type PageData } from "./pageModel";

const TODAY = new Date(2026, 9, 23);
const base = (kind: string): PageData => (kind === "outreach" ? newOutreachPage() : kind === "team" ? newTeamPage() : newTemplatePage(kind as never));

describe("the template standard: a page opens as a filled example", () => {
  for (const kind of Object.keys(EXAMPLES)) {
    it(`${kind}: every example value fits a field, a choice or a heading the page has`, () => {
      const page = base(kind);
      for (const e of EXAMPLES[kind]!) {
        if (e.sec) expect((page.sections ?? []).map((s) => s.label), `${kind}: heading ${e.sec}`).toContain(e.sec);
        for (const [k, v] of Object.entries(e.v)) {
          const f = page.fields.find((x) => x.key === k);
          expect(f, `${kind}: field ${k}`).toBeTruthy();
          if (f!.type === "choice") expect(f!.options, `${kind}.${k}`).toContain(v);
          if (f!.type === "money" || f!.type === "number") expect(Number.isFinite(Number(v)), `${kind}.${k}`).toBe(true);
        }
      }
      const filled = withExample(page, TODAY);
      expect(filled.records.length).toBeGreaterThan(page.records.length);
      expect(filled.records.filter((r) => r.ex).length).toBe(EXAMPLES[kind]!.length);
    });
  }
  it("is only ever for a kind that exists", () => {
    for (const kind of Object.keys(EXAMPLES)) expect(kind === "outreach" || kind === "team" || isTemplateKey(kind), kind).toBe(true);
  });
  it("dates are today and around it, never a fixed past day", () => {
    const p = withExample(base("outreach"), TODAY);
    expect(p.records[0]!.v.last).toBe("2026-10-20");
    expect(p.records[2]!.v.last).toBeUndefined();
  });
  it("Clear Example takes the examples and nothing else; an edited example is the person's", () => {
    let p = withExample(base("healthcard"), TODAY);
    expect(hasExample(p)).toBe(true);
    const mine = p.records[0]!;
    p = setValues(p, mine.id, { detail: "Mine now" });
    const cleared = clearExample(p);
    expect(cleared.records.map((r) => r.id)).toEqual([mine.id]);
    expect(hasExample(cleared)).toBe(false);
  });
});

describe("the three fix items", () => {
  it("Health Card puts the emergency block first and has nothing to tick", () => {
    const d = TEMPLATES.healthcard;
    expect(d.sections![0]).toBe("Emergency Contacts");
    expect(d.fields.some((f) => f.type === "check")).toBe(false);
  });
  it("Handover Sheet says one plain line when empty and has nothing to tick", () => {
    expect(TEMPLATES.handover.plainEmpty).toBeTruthy();
    expect(TEMPLATES.handover.fields.some((f) => f.type === "check")).toBe(false);
  });
});
