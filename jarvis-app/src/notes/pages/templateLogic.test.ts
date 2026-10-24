import { describe, it, expect } from "vitest";
import { newTemplatePage, TEMPLATE_KEYS, TEMPLATES, SHELVES, templateDef } from "./templateDefs";
import { addRecord, newTeamPage, type PageData, takeSnapshot, restoreSnapshot, duplicatePage, pageSummary, recordName } from "./pageModel";
import {
  addSection, renameSection, removeSection, moveSection, setSection, groupedRecords, sectionGroups, untouchedTemplatePage, moveField, suggestedFor, addSuggested, groupDues, keyDates, sumOf, totalsLine, asMyTemplate, fromMyTemplate,
  restDaysFor, pitcherStatuses, clockAfter, sessionClock, standingsOf, addGame, removeTeamAndGames, gamesOfTeam, num, fieldConsequences,
} from "./templateLogic";

describe("the catalog", () => {
  it("every template has a shelf, a headline field it has, and Title Case words in its picker line", () => {
    const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
    for (const k of TEMPLATE_KEYS) {
      const d = TEMPLATES[k];
      expect(SHELVES).toContain(d.shelf);
      expect(d.fields.some((f) => f.key === d.headline), k).toBe(true);
      for (const key of d.show) expect(d.fields.some((f) => f.key === key) || (d.suggested ?? []).some((f) => f.key === key), `${k}.${key}`).toBe(true);
      expect(d.desc, k).not.toMatch(/\.$/);
      const words = d.desc.split(/\s+/);
      words.forEach((w, i) => { if (/^[a-z]/.test(w)) expect(i > 0 && i < words.length - 1 && SMALL.has(w), `${k}: ${d.desc}`).toBe(true); });
    }
  });
  it("a new page is the smallest useful structure, never with a credential field", () => {
    for (const k of TEMPLATE_KEYS) {
      const p = newTemplatePage(k);
      expect(p.kind).toBe(k);
      expect(p.fields.length).toBeGreaterThan(0);
      for (const f of [...p.fields, ...(TEMPLATES[k].suggested ?? [])]) expect(f.label, `${k}: ${f.label}`).not.toMatch(/password|passcode|\bpin\b|security code|login/i);
    }
  });
  it("names are unique", () => {
    expect(new Set(TEMPLATE_KEYS.map((k) => TEMPLATES[k].name)).size).toBe(TEMPLATE_KEYS.length);
  });
});

const sheet = (): PageData => newTemplatePage("session");
/** The page with its starter rows taken off, for the tests about placing rows by hand. */
const bare = (): PageData => ({ ...sheet(), records: [] });

describe("sections: named, added, removed and ordered by the person; every one is drawn on the page", () => {
  it("the page draws every heading, rows or none, in order, with loose rows first; an export walks only the ones with rows", () => {
    let p = bare();
    expect(groupedRecords(p)).toEqual([]);
    expect(sectionGroups(p, { includeEmpty: true }).map((x) => x.section?.label ?? null)).toEqual(["Warm-Up", "Drills", "Scrimmage", "Cool-Down"]);
    const a = addRecord(p, { act: "Stretch", min: "10" }); p = setSection(a.page, a.id, p.sections![0]!.key);
    const b = addRecord(p, { act: "Passing", min: "20" }); p = setSection(b.page, b.id, p.sections![1]!.key);
    const c = addRecord(p, { act: "Loose" }); p = c.page;
    expect(groupedRecords(p).map((x) => x.section?.label ?? null)).toEqual([null, "Warm-Up", "Drills"]); // Scrimmage and Cool-Down have no rows
    const all = sectionGroups(p, { includeEmpty: true });
    expect(all.map((x) => x.section?.label ?? null)).toEqual([null, "Warm-Up", "Drills", "Scrimmage", "Cool-Down"]);
    expect(all.map((x) => x.records.length)).toEqual([1, 1, 1, 0, 0]);
  });
  it("a template with starter rows opens with them under their headings, and a fresh page is untouched until it is changed", () => {
    const p = sheet();
    expect(p.records.map((r) => [r.v.act, p.sections!.find((s) => s.key === r.sec)?.label])).toEqual([["Warm-Up", "Warm-Up"], ["Cool-Down", "Cool-Down"]]);
    expect(untouchedTemplatePage(p)).toBe(true);
    expect(untouchedTemplatePage(newTemplatePage("eventday"))).toBe(true);
    expect(untouchedTemplatePage(newTemplatePage("scouting"))).toBe(true);
    expect(untouchedTemplatePage(addRecord(p, { act: "Passing" }).page)).toBe(false);
    expect(untouchedTemplatePage({ ...p, records: p.records.slice(1) })).toBe(false);
    expect(untouchedTemplatePage(renameSection(p, p.sections![0]!.key, "Get Loose"))).toBe(false);
    expect(untouchedTemplatePage(addSuggested(p, "coach"))).toBe(false);
    expect(untouchedTemplatePage({ ...p, meta: { start: "17:30" } })).toBe(false);
    expect(untouchedTemplatePage(asMyTemplate(p))).toBe(false);
    // Every catalog template's fresh page is untouched; its seeds are a few editable rows, never personal data.
    for (const k of TEMPLATE_KEYS) {
      expect(untouchedTemplatePage(newTemplatePage(k)), k).toBe(true);
      const seeds = TEMPLATES[k].starter ?? [];
      expect(seeds.length, k).toBeLessThanOrEqual(7);
      for (const r of seeds) for (const v of Object.values(r.v)) expect(v, `${k}: ${v}`).not.toMatch(/@|\d{3}[- ]\d{3}/);
    }
  });
  it("renames, adds, moves and removes; a removed heading keeps its rows", () => {
    let p = bare();
    const a = addRecord(p, { act: "Stretch" }); p = setSection(a.page, a.id, p.sections![0]!.key);
    p = renameSection(p, p.sections![0]!.key, "  Get   Loose ");
    expect(p.sections![0]!.label).toBe("Get Loose");
    const made = addSection(p, "Water Break");
    p = moveSection(made.page, made.key, -1);
    expect(p.sections!.map((s) => s.label).slice(-2)).toEqual(["Water Break", "Cool-Down"]);
    const key = p.sections![0]!.key;
    p = removeSection(p, key);
    expect(p.sections!.find((s) => s.key === key)).toBeUndefined();
    expect(p.records[0]!.sec).toBeUndefined();
    expect(p.records).toHaveLength(1);
    expect(renameSection(p, p.sections![0]!.key, "   ")).toBe(p);
  });
});

describe("fields: reorder and suggested", () => {
  it("moves a field and stops at the ends", () => {
    const p = sheet();
    const first = p.fields[0]!.key;
    expect(moveField(p, first, -1)).toBe(p);
    const moved = moveField(p, first, 1);
    expect(moved.fields[1]!.key).toBe(first);
  });
  it("offers the template's suggested fields once, and adds one on a tap", () => {
    let p = sheet();
    const s = suggestedFor(p).map((f) => f.key);
    expect(s).toEqual(["coach", "equip"]);
    p = addSuggested(p, "coach");
    expect(p.fields.some((f) => f.key === "coach")).toBe(true);
    expect(suggestedFor(p).map((f) => f.key)).toEqual(["equip"]);
  });
});

describe("totals", () => {
  it("a session's minutes add up and read as words", () => {
    let p = bare();
    p = addRecord(p, { act: "A", min: "10" }).page;
    p = addRecord(p, { act: "B", min: "25" }).page;
    p = addRecord(p, { act: "C", min: "" }).page;
    expect(sumOf(p.records, "min")).toBe(35);
    expect(totalsLine(p)).toBe("35 Min");
    expect(num("$1,250.50")).toBe(1250.5);
    expect(pageSummary(p)).toBe("3 Activities");
  });
});

describe("my templates", () => {
  it("keep the structure and none of the rows, and start a fresh page", () => {
    let p = sheet();
    p = addSuggested(p, "coach");
    p = addRecord(p, { act: "Stretch", min: "10" }).page;
    p = { ...p, meta: { start: "18:00" } };
    const t = asMyTemplate(takeSnapshot(p, "manual", 1));
    expect(t.mine).toBe(true);
    expect(t.records).toEqual([]);
    expect(t.snapshots).toBeUndefined();
    expect(t.fields.map((f) => f.key)).toContain("coach");
    expect(pageSummary(t)).toBe("Your Template");
    const fresh = fromMyTemplate(t);
    expect(fresh.mine).toBeUndefined();
    expect(fresh.records).toEqual([]);
    expect(fresh.meta?.start).toBe("18:00");
  });
  it("sections, snapshots and duplicates carry the new structure", () => {
    let p = bare();
    const r = addRecord(p, { act: "X" }); p = setSection(r.page, r.id, p.sections![1]!.key);
    const snap = takeSnapshot(p, "manual", 5);
    const gone = { ...snap, sections: [], records: [] };
    const back = restoreSnapshot(gone, 5, 6);
    expect(back.sections).toHaveLength(4);
    expect(back.records[0]!.sec).toBe(p.sections![1]!.key);
    expect(duplicatePage(p).sections).toHaveLength(4);
  });
});

describe("pitching: rest follows from the pitches", () => {
  it("uses the common rest table", () => {
    expect([0, 20, 21, 35, 36, 50, 51, 65, 66, 90].map(restDaysFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it("says who is available today and when the others are", () => {
    let p = newTemplatePage("pitching");
    p = addRecord(p, { name: "Sam", date: "2026-10-12", pitches: "70" }).page; // 4 days: back on the 17th
    p = addRecord(p, { name: "Lee", date: "2026-10-12", pitches: "15" }).page;  // 0 days: back the 13th
    p = addRecord(p, { name: "Sam", date: "2026-10-01", pitches: "20" }).page;
    const s = pitcherStatuses(p, "2026-10-14");
    expect(s.map((x) => [x.name, x.availableNow, x.availableOn])).toEqual([["Lee", true, "2026-10-13"], ["Sam", false, "2026-10-17"]]);
    expect(s.find((x) => x.name === "Sam")!.total).toBe(90);
  });
});

describe("session: a start time puts a clock on every activity", () => {
  it("runs the minutes along the order the page is drawn in", () => {
    expect(clockAfter("18:30", 45)).toBe("7:15 PM");
    expect(clockAfter("00:10", 5)).toBe("12:15 AM");
    expect(clockAfter("", 5)).toBeNull();
    let p = bare();
    const a = addRecord(p, { act: "Drills", min: "20" }); p = setSection(a.page, a.id, p.sections![1]!.key);
    const b = addRecord(p, { act: "Stretch", min: "10" }); p = setSection(b.page, b.id, p.sections![0]!.key);
    expect(sessionClock(p).size).toBe(0);
    p = { ...p, meta: { start: "17:00" } };
    const clock = sessionClock(p);
    expect(clock.get(b.id)).toBe("5:00 PM");  // Warm-Up draws first
    expect(clock.get(a.id)).toBe("5:10 PM");
  });
});

describe("the Event Day Pack's timeline (the Running Order folded in, 2026-10-23)", () => {
  it("runs a clock over the Timeline alone: a checklist row has no time", () => {
    let p = newTemplatePage("eventday");
    expect(p.sections!.map((x) => x.label)).toEqual(["Before You Go", "Bring", "People", "Timeline"]);
    expect(sessionClock(p).size).toBe(0);
    p = { ...p, meta: { start: "17:00" } };
    const clock = sessionClock(p);
    const by = (item: string) => p.records.find((r) => r.v.item === item)!.id;
    expect(clock.has(by("Tickets"))).toBe(false);
    expect([clock.get(by("Arrive")), clock.get(by("Event Starts")), clock.get(by("Pack Up"))]).toEqual(["5:00 PM", "5:15 PM", "6:45 PM"]);
    expect(totalsLine(p)).toBe("120 Min");
  });
});

describe("the Team Sheet is also the group (the Group Manager folded in, 2026-10-23)", () => {
  const roster = () => { let p = newTeamPage(); for (const n of ["Ava", "Ben", "Cal"]) p = addRecord(p, { name: n }).page; return p; };
  it("offers fees, roles, who is coming and key dates in one tap, and adds nothing until asked", () => {
    const p = roster();
    expect(suggestedFor(p).map((f) => f.key)).toEqual(["role", "fee", "paid", "coming", "keydate"]);
    expect(p.fields.map((f) => f.key)).toEqual(["name", "number", "position", "contact"]);
    expect(addSuggested(p, "fee").fields.map((f) => f.key)).toContain("fee");
    expect(groupDues(p)).toBeNull();
  });
  it("works out what is owed, paid and still due, and names the unpaid", () => {
    let p = addSuggested(addSuggested(roster(), "fee"), "paid");
    p = { ...p, records: p.records.map((r, i) => ({ ...r, v: { ...r.v, fee: ["100", "100", "50"][i]!, ...(i === 0 ? { paid: "1" } : {}) } })) };
    expect(groupDues(p)).toEqual({ owed: 250, paid: 100, left: 150, unpaid: 2 });
  });
  it("lists the next key dates from today on, soonest first", () => {
    let p = addSuggested(roster(), "keydate");
    p = { ...p, records: p.records.map((r, i) => ({ ...r, v: { ...r.v, keydate: ["2026-11-02", "2026-10-01", "2026-10-30"][i]! } })) };
    expect(keyDates(p, "2026-10-23").map((d) => d.name)).toEqual(["Cal", "Ava"]);
  });
});

describe("league standings work themselves out", () => {
  it("from the games: wins, losses, ties, points for and against, in rank order", () => {
    let p = newTemplatePage("standings");
    const ids = ["Tigers", "Bears", "Owls"].map((n) => { const r = addRecord(p, { name: n }); p = r.page; return r.id; });
    p = addGame(p, { date: "2026-10-01", a: ids[0]!, b: ids[1]!, sa: 3, sb: 1 });
    p = addGame(p, { date: "2026-10-02", a: ids[1]!, b: ids[2]!, sa: 2, sb: 2 });
    p = addGame(p, { date: "2026-10-03", a: ids[2]!, b: ids[0]!, sa: 0, sb: 4 });
    const s = standingsOf(p);
    expect(s.map((x) => [x.name, x.w, x.l, x.t, x.pts])).toEqual([["Tigers", 2, 0, 0, 4], ["Bears", 0, 1, 1, 1], ["Owls", 0, 1, 1, 1]]);
    expect(s[0]!.pf).toBe(7);
    expect(s[0]!.pa).toBe(1);
    expect(gamesOfTeam(p, ids[0]!)).toBe(2);
    const without = removeTeamAndGames(p, ids[0]!);
    expect(without.games).toHaveLength(1);
    expect(standingsOf(without).every((x) => x.gp <= 1)).toBe(true);
  });
  it("a page with no games is all zeros, in name order", () => {
    let p = newTemplatePage("standings");
    p = addRecord(p, { name: "B" }).page;
    p = addRecord(p, { name: "A" }).page;
    expect(standingsOf(p).map((x) => x.name)).toEqual(["A", "B"]);
    expect(pageSummary(p)).toBe("2 Teams, 0 Games");
  });
});

describe("names", () => {
  it("a row is named by its template's headline", () => {
    let p = newTemplatePage("pitching");
    const r = addRecord(p, { name: "Sam" });
    expect(recordName(r.page, r.page.records[0]!)).toBe("Sam");
    expect(templateDef("pitching")!.noun).toBe("Outing");
  });
});

describe("what stops working, said before a field is removed (the 2026-10-13 spec's Customization, 2026-10-17)", () => {
  const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  const titleCased = (l: string) => l.split(/\s+/).every((w, i, ws) => !/^[a-z]/.test(w) || (i > 0 && i < ws.length - 1 && SMALL.has(w)));

  it("every field a template's arithmetic reads names what stops; every line is plain Title Case", () => {
    for (const k of TEMPLATE_KEYS) {
      const d = TEMPLATES[k];
      let p = newTemplatePage(k);
      const reads = new Set([...Object.keys(d.needs ?? {}), ...(d.totals ?? []).map((t) => t.key), ...(d.due ? [d.due.key] : [])]);
      for (const key of reads) {
        // A need names a field the template has, never a typo.
        expect([...d.fields, ...(d.suggested ?? [])].some((f) => f.key === key), `${k}.${key}`).toBe(true);
        // A field the page offers in one tap is put on first, as the person would, so the line says what the arithmetic loses.
        if (!p.fields.some((f) => f.key === key)) p = addSuggested(p, key);
        const lines = fieldConsequences(p, key);
        expect(lines.length, `${k}.${key}`).toBeGreaterThan(0);
        for (const l of lines) {
          expect(titleCased(l), `${k}: ${l}`).toBe(true);
          expect(l, `${k}: ${l}`).not.toMatch(/[—·]|\.$/);
        }
      }
    }
  });

  it("names the total, the clock, the due date, the payoff plan and the settle-up by what they are", () => {
    expect(fieldConsequences(newTemplatePage("session"), "min")).toEqual(["Clock Times From the Start Stop Working", "The Minutes Total Stops Adding Up"]);
    expect(fieldConsequences(newTemplatePage("runorder"), "min")).toEqual(["Clock Times From the Start Stop Working", "The Minutes Total Stops Adding Up"]);
    expect(fieldConsequences(newTemplatePage("pitching"), "pitches")).toEqual(["Pitch Counts, Rest Days and the Limit Stop Working"]);
    expect(fieldConsequences(newTemplatePage("pitching"), "date")).toEqual(["Rest Days and Who Is Available Stop Working"]);
    expect(fieldConsequences(newTemplatePage("debt"), "apr")).toEqual(["The Payoff Order and Interest Stop Working"]);
    expect(fieldConsequences(newTemplatePage("debt"), "balance")).toEqual(["Debts Not in Money Drop Out of the Payoff Plan"]);
    expect(fieldConsequences(newTemplatePage("poker"), "cashout")).toEqual(["Who Owes Whom Stops Adding Up"]);
    expect(fieldConsequences(newTemplatePage("insurance"), "renews")).toEqual(["Policies Stop Saying When They Are Due"]);
    expect(fieldConsequences(newTemplatePage("insurance"), "premium")).toEqual(["The Premium Total Stops Adding Up"]);
    expect(fieldConsequences(newTemplatePage("occasions"), "date")).toEqual(["Occasions Stop Saying When They Are Due", "Occasions Stop Sorting by Date"]);
    expect(fieldConsequences(newTemplatePage("giving"), "date")).toEqual(["Gifts Stop Sorting by Date"]);
    expect(fieldConsequences(newTemplatePage("giving"), "amount")).toEqual(["The Amount Total Stops Adding Up"]);
    expect(fieldConsequences(newTemplatePage("oneonone"), "actions")).toEqual(["Follow-Ups Stop Carrying Forward to the Next 1:1"]);
  });

  it("uses the field's own name as he set it, and a field nothing reads says nothing", () => {
    const p = newTemplatePage("session");
    p.fields = p.fields.map((f) => (f.key === "min" ? { ...f, label: "length" } : f));
    expect(fieldConsequences(p, "min")).toContain("The Length Total Stops Adding Up");
    expect(fieldConsequences(p, "notes")).toEqual([]);
    expect(fieldConsequences(newTemplatePage("scouting"), "team")).toEqual([]);
    expect(fieldConsequences(newTemplatePage("session"), "gone")).toEqual([]);
  });

  it("a sorted page with another date says its rows sort by that one instead", () => {
    const p = newTemplatePage("expenses");
    const more: PageData = { ...p, fields: [...p.fields, { key: "submittedOn", label: "Submitted On", type: "date" }] };
    expect(fieldConsequences(more, "date")).toEqual(["Expenses Sort by Submitted On Instead"]);
  });
});
