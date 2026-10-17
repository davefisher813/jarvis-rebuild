// STAGE 1 OF THE STAGED BUILD (the 2026-10-13 FINAL spec, audited against the code 2026-10-17): the pure parts of what the spec
// named and the code lacked. Team Sheet positions by sport and Outreach labels by kind (auto-adjust rule 3's flagship adjustments),
// the poker blind schedule (the same rule), and the 1:1 Log's open promises carrying forward.
import { describe, it, expect } from "vitest";
import { newTeamPage, newOutreachPage, addRecord, setValues } from "./pageModel";
import { newTemplatePage } from "./templateDefs";
import { TEAM_SPORTS, setTeamSport } from "./teamSports";
import { OUTREACH_KINDS, setOutreachKind, KNOWN_STATUS, STATUS_TONE } from "./outreachKinds";
import { blindSchedule, carriedForward, MAX_BLIND_LEVELS, untouchedTemplatePage } from "./templateLogic";

describe("Team Sheet positions by sport", () => {
  it("every sport names its spots in Title Case, once each", () => {
    expect(TEAM_SPORTS.map((s) => s.key)).toEqual(expect.arrayContaining(["baseball", "softball", "basketball", "soccer", "football", "hockey", "volleyball", "lacrosse"]));
    for (const s of TEAM_SPORTS) {
      expect(new Set(s.positions).size, s.name).toBe(s.positions.length);
      for (const p of s.positions) expect(p, s.name).toMatch(/^[A-Z]/);
    }
  });
  it("picking a sport turns Position into that sport's choices and moves no value", () => {
    let p = newTeamPage();
    p = addRecord(p, { name: "Ava Chen", number: "7", position: "Pitcher" }).page;
    p = addRecord(p, { name: "Ben Ruiz", number: "12", position: "Wing" }).page;
    p = setTeamSport(p, "baseball");
    const pos = p.fields.find((f) => f.key === "position")!;
    expect(pos.type).toBe("choice");
    expect(pos.options).toContain("Shortstop");
    expect(p.meta?.sport).toBe("baseball");
    // A typed position that is not on the list is still the row's position.
    expect(p.records[1]!.v.position).toBe("Wing");
    expect(p.records[0]!.v.position).toBe("Pitcher");
    // Any Sport: text again, every value kept.
    p = setTeamSport(p, "");
    expect(p.fields.find((f) => f.key === "position")).toMatchObject({ type: "text" });
    expect(p.fields.find((f) => f.key === "position")!.options).toBeUndefined();
    expect(p.meta?.sport).toBeUndefined();
    expect(p.records.map((r) => r.v.position)).toEqual(["Pitcher", "Wing"]);
  });
  it("a sheet whose Position was removed takes the sport without breaking", () => {
    const p = { ...newTeamPage(), fields: newTeamPage().fields.filter((f) => f.key !== "position") };
    const next = setTeamSport(p, "soccer");
    expect(next.fields.some((f) => f.key === "position")).toBe(false);
    expect(next.meta?.sport).toBe("soccer");
  });
});

describe("Outreach Tracker kinds", () => {
  it("three kinds: outreach, grants and sponsors, networking; every status word has a tone", () => {
    expect(OUTREACH_KINDS.map((k) => k.name)).toEqual(["Outreach", "Grants and Sponsors", "Networking"]);
    for (const s of KNOWN_STATUS) expect(STATUS_TONE[s], s).toBeDefined();
  });
  it("a kind renames the labels and the status words, adds its fields, and keeps every value and key", () => {
    let p = newOutreachPage();
    p = addRecord(p, { who: "Coach Miller", org: "Lions", status: "Reached Out", next: "Send the schedule" }).page;
    p = setOutreachKind(p, "grants");
    expect(p.meta?.kind).toBe("grants");
    const label = (k: string) => p.fields.find((f) => f.key === k)!.label;
    expect(label("org")).toBe("Funder or Sponsor");
    expect(label("who")).toBe("Contact");
    expect(p.fields.find((f) => f.key === "status")!.options).toEqual(["To Ask", "Asked", "Proposal Sent", "Funded", "Declined"]);
    expect(p.fields.find((f) => f.key === "amount")).toMatchObject({ label: "Amount Asked", type: "money" });
    expect(p.fields.find((f) => f.key === "deadline")).toMatchObject({ label: "Deadline", type: "date" });
    // The row is untouched: its status is still the word that was typed, its keys the same.
    expect(p.records[0]!.v).toEqual({ who: "Coach Miller", org: "Lions", status: "Reached Out", next: "Send the schedule" });
    // Back to plain outreach: the original labels and words; the grant's fields stay (a field is never taken away by a kind).
    p = setOutreachKind(p, "general");
    expect(label("org")).toBe("Organization");
    expect(p.fields.find((f) => f.key === "status")!.options).toContain("Meeting Set");
    expect(p.fields.some((f) => f.key === "amount")).toBe(true);
    // Switching twice adds no second copy of a field.
    p = setOutreachKind(setOutreachKind(p, "grants"), "grants");
    expect(p.fields.filter((f) => f.key === "amount")).toHaveLength(1);
  });
  it("a renamed label the person typed survives a kind that does not name that key", () => {
    let p = newOutreachPage();
    p = { ...p, fields: p.fields.map((f) => (f.key === "notes" ? { ...f, label: "Remarks" } : f)) };
    p = setOutreachKind(p, "networking");
    // Notes is named by every kind, so it goes back to Notes; a field the kind does not name would keep its label.
    expect(p.fields.find((f) => f.key === "notes")!.label).toBe("Notes");
    const custom = { ...p, fields: [...p.fields, { key: "f_x", label: "Shirt Size", type: "text" as const }] };
    expect(setOutreachKind(custom, "grants").fields.find((f) => f.key === "f_x")!.label).toBe("Shirt Size");
  });
});

describe("Poker Night's blind schedule", () => {
  it("is empty until a starting blind is set", () => {
    expect(blindSchedule(newTemplatePage("poker"))).toEqual([]);
    expect(blindSchedule({ ...newTemplatePage("poker"), meta: { blindStart: "0" } })).toEqual([]);
  });
  it("climbs the usual ladder from the starting blind, each level with its minutes", () => {
    const p = { ...newTemplatePage("poker"), meta: { blindStart: "25", blindMin: "15", blindLevels: "6" } };
    const s = blindSchedule(p);
    expect(s.map((l) => `${l.small}/${l.big}`)).toEqual(["25/50", "50/100", "75/150", "100/200", "150/300", "200/400"]);
    expect(s.every((l) => l.minutes === 15)).toBe(true);
    expect(s.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("defaults to eight levels, never more than the ladder has, and no minutes when none are given", () => {
    expect(blindSchedule({ ...newTemplatePage("poker"), meta: { blindStart: "10" } })).toHaveLength(8);
    expect(blindSchedule({ ...newTemplatePage("poker"), meta: { blindStart: "10", blindLevels: "99" } })).toHaveLength(MAX_BLIND_LEVELS);
    expect(blindSchedule({ ...newTemplatePage("poker"), meta: { blindStart: "10" } })[0]!.minutes).toBe(0);
  });
  it("a fresh Poker Night is still the untouched template; one with blinds set is the person's", () => {
    expect(untouchedTemplatePage(newTemplatePage("poker"))).toBe(true);
    expect(untouchedTemplatePage({ ...newTemplatePage("poker"), meta: { blindStart: "25" } })).toBe(false);
  });
});

describe("1:1 Log: open promises carry forward", () => {
  it("a new meeting starts with the newest meeting's follow-ups", () => {
    let p = newTemplatePage("oneonone");
    p = addRecord(p, { date: "2026-10-01", topics: "Roadmap", actions: "Send the draft" }).page;
    p = addRecord(p, { date: "2026-10-08", topics: "Hiring", actions: "Book the panel; Share the rubric" }).page;
    expect(carriedForward(p)).toEqual({ from: "2026-10-08", values: { actions: "Book the panel; Share the rubric" } });
    // The newest by DATE, not by position on the page.
    p = addRecord(p, { date: "2026-09-24", topics: "Old", actions: "Stale" }).page;
    expect(carriedForward(p)!.values.actions).toBe("Book the panel; Share the rubric");
  });
  it("nothing carries when the last meeting left nothing open, or the page is empty, or it is not a 1:1 Log", () => {
    let p = newTemplatePage("oneonone");
    expect(carriedForward(p)).toBeNull();
    p = addRecord(p, { date: "2026-10-08", topics: "Hiring", actions: "" }).page;
    expect(carriedForward(p)).toBeNull();
    p = setValues(p, p.records[0]!.id, { actions: "Follow up" });
    expect(carriedForward(p)).not.toBeNull();
    expect(carriedForward({ ...newTemplatePage("projtracker"), records: [{ id: "r1", v: { item: "X", actions: "Y" } }] })).toBeNull();
  });
  it("an undated meeting is the last one by position, and says it has no date", () => {
    let p = newTemplatePage("oneonone");
    p = addRecord(p, { topics: "Hiring", actions: "Book the panel" }).page;
    expect(carriedForward(p)).toEqual({ from: "", values: { actions: "Book the panel" } });
  });
});
