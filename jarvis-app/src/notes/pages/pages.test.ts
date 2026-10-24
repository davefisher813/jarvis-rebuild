// Template pages (issue #115, slice 1): the model, the tables in and out, the
// import with its uncertainty, and the reimport's three-way match.
import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { Store, InMemoryAdapter } from "@core";
import { NotesService } from "../NotesService";
import { noteBlockText } from "../../search/search";
import {
  newTeamPage, newScorecardPage, newLineupPage, newOutreachPage, addRecord, setValues, renameField, addField, removeField,
  fieldImpact, golfTotals, setScore, setHoles, holesImpact, scoreOf, rosterChanges, refreshFromRoster, takeSnapshot,
  restoreSnapshot, pageText, pageSummary, duplicatePage, markBase, type PageData,
} from "./pageModel";
import { parseDelimited, toCsv, writeXlsx, readXlsx, zipStore, detectDelimiter } from "./tabular";
import { proposeMapping, planImport, applyImport, reconcile, applyReconcile, conflictKey, T_ID, T_EXTRA, T_SKIP, ID_HEADER, mappingIsExact } from "./importMap";
import { pageTable, shareText, buildPageFile, onePagerOf, buildOnePager } from "./exportPage";
import { newTemplatePage } from "./templateDefs";

const team = (rows: [string, string, string][]): PageData => {
  let p = newTeamPage();
  for (const [name, number, position] of rows) p = addRecord(p, { name, number, position }).page;
  return p;
};

describe("the page model", () => {
  it("labels are free: renaming a field moves no value", () => {
    let p = team([["Ava Chen", "7", "Pitcher"]]);
    p = renameField(p, "number", "Jersey");
    expect(p.fields.find((f) => f.key === "number")!.label).toBe("Jersey");
    expect(p.records[0]!.v.number).toBe("7");
  });

  it("removing a field says its cost first and keeps the values in a snapshot", () => {
    let p = team([["Ava Chen", "7", "Pitcher"], ["Ben Ruiz", "", "Catcher"]]);
    expect(fieldImpact(p, "number")).toBe(1);
    p = removeField(p, "number", 1000);
    expect(p.fields.some((f) => f.key === "number")).toBe(false);
    expect(p.snapshots!.at(-1)!.records[0]!.v.number).toBe("7");
    const back = restoreSnapshot(p, 1000, 2000);
    expect(back.records[0]!.v.number).toBe("7");
    expect(back.snapshots!.at(-1)!.why).toBe("restore");
  });

  it("an added field is a new key; existing keys never change", () => {
    const { page, key } = addField(team([["A", "1", "P"]]), "Shirt Size");
    expect(key).not.toBe("name");
    expect(page.fields.map((f) => f.label)).toContain("Shirt Size");
  });

  it("golf: running totals and to par", () => {
    let p = newScorecardPage({ players: ["Dave", "Sam"], date: "2026-10-13", par: Array.from({ length: 18 }, () => 4) });
    const [d, s] = p.records;
    p = setScore(p, d!.id, 1, 3); // par 4: birdie
    p = setScore(p, d!.id, 2, 6);
    p = setScore(p, s!.id, 1, 4);
    const t = golfTotals(p, p.records[0]!);
    expect(t).toMatchObject({ thru: 2, total: 9, toPar: 1, played: 2 });
    expect(golfTotals(p, p.records[1]!).toPar).toBe(0);
  });

  it("golf: a new round has no pars, and a hole with no par is left out of to par instead of counted as a four", () => {
    let p = newScorecardPage({ players: ["Dave"], date: "2026-10-13" });
    expect(p.golf!.par.every((x) => x === 0)).toBe(true);
    p = setScore(p, p.records[0]!.id, 1, 7);
    expect(golfTotals(p, p.records[0]!)).toMatchObject({ total: 7, toPar: 0 });
  });

  it("golf: 18 to 9 hides back-nine scores and never discards them", () => {
    let p = newScorecardPage({ players: ["Dave"], date: "2026-10-13" });
    p = setScore(p, p.records[0]!.id, 12, 5);
    expect(holesImpact(p, 9)).toBe(1);
    p = setHoles(p, 9);
    expect(golfTotals(p, p.records[0]!).played).toBe(0);
    p = setHoles(p, 18);
    expect(scoreOf(p.records[0]!, 12)).toBe(5);
  });

  it("a lineup keeps its own copy: a roster edit never rewrites it, and says it changed", () => {
    let roster = team([["Ava Chen", "7", "Pitcher"], ["Ben Ruiz", "12", "Catcher"]]);
    const lineup = newLineupPage({ id: "team1", title: "Tigers", page: roster }, [{ playerId: roster.records[1]!.id }, { playerId: roster.records[0]!.id }], "2026-10-12", 1);
    expect(lineup.records.map((r) => r.v.name)).toEqual(["Ben Ruiz", "Ava Chen"]);
    roster = setValues(roster, roster.records[0]!.id, { name: "Ava Chen-Park", number: "8" });
    expect(lineup.records[1]!.v.name).toBe("Ava Chen");
    const ch = rosterChanges(lineup, roster);
    expect(ch).toHaveLength(1);
    expect(refreshFromRoster(lineup, roster, 2).records[1]!.v.name).toBe("Ava Chen-Park");
  });

  it("search reads record values, the course and the team", () => {
    const p = team([["Ava Chen", "7", "Pitcher"]]);
    expect(pageText(p)).toContain("Ava Chen");
    const g = newScorecardPage({ course: "Pebble Beach", players: ["Dave"], date: "2026-10-13" });
    expect(pageText(g)).toContain("Pebble Beach");
    expect(noteBlockText({ title: "T", category: "", blocks: [], connections: [], page: p })).toContain("Pitcher");
  });

  it("the row line says what the page holds, Title Case", () => {
    expect(pageSummary(team([["A", "1", "P"], ["B", "2", "C"]]))).toBe("2 Players");
    expect(pageSummary(newOutreachPage())).toBe("0 Contacts");
    expect(pageSummary(newScorecardPage({ players: ["Dave"], date: "2026-10-13" }))).toBe("18 Holes, 1 Player");
  });

  it("duplicate gives new record ids and leaves originals and snapshots behind", () => {
    const p = takeSnapshot({ ...team([["A", "1", "P"]]), originals: [{ at: 1, name: "r.csv", mime: "text/csv", bytes: 3, used: true }] }, "manual", 5);
    const d = duplicatePage(p);
    expect(d.records[0]!.id).not.toBe(p.records[0]!.id);
    expect(d.originals).toBeUndefined();
    expect(d.snapshots).toBeUndefined();
  });

  it("a page is a note: one store, created, found, written whole, duplicated", async () => {
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u1");
    const id = (await svc.createPage("Tigers", team([["Ava Chen", "7", "Pitcher"]])))!;
    const d = (await svc.note(id))!;
    expect(d.page!.records).toHaveLength(1);
    await svc.setPage(id, addRecord(d.page!, { name: "Ben" }).page);
    expect((await svc.note(id))!.page!.records).toHaveLength(2);
    const copy = (await svc.duplicatePage(id))!;
    expect((await svc.note(copy))!.title).toBe("Tigers Copy");
    expect((await svc.listNotes()).length).toBe(2);
  });
});

describe("tables in and out", () => {
  it("CSV round trip keeps commas, quotes, line breaks and accents", () => {
    const rows = [["Name", "Note"], ["Zoë \"Z\" Smith", "a, b\nc"], ["=SUM(A1)", "+2"]];
    const back = parseDelimited(toCsv(rows));
    expect(back).toEqual(rows);
    expect(toCsv(rows)).toContain("'=SUM(A1)");
    expect(toCsv(rows)).not.toContain("'+2");
  });

  it("detects tabs from a Sheets paste and semicolons from a European CSV", () => {
    expect(detectDelimiter("Name\tNumber\nAva\t7")).toBe("\t");
    expect(detectDelimiter("Name;Number\nAva;7")).toBe(";");
    expect(parseDelimited("Name\tNumber\nAva\t7\n\n")).toEqual([["Name", "Number"], ["Ava", "7"]]);
  });

  it("XLSX written here reads back cell for cell", async () => {
    const rows = [["JARVIS ID", "Name", "Number"], ["r_1", "Ava & Co <x>", "07"], ["r_2", "Ben", "12"]];
    const t = await readXlsx(writeXlsx(rows));
    expect(t.rows).toEqual(rows);
  });

  it("reads a deflated workbook with shared strings, and reports other sheets and formulas", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><f>3+4</f><v>7</v></c></row></sheetData></worksheet>`;
    const files = [
      { name: "xl/workbook.xml", data: enc(`<workbook><sheets><sheet name="Roster" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>`) },
      { name: "xl/_rels/workbook.xml.rels", data: enc(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`) },
      { name: "xl/sharedStrings.xml", data: enc(`<sst><si><t>Name</t></si><si><t>Number</t></si><si><r><t>Ava </t></r><r><t>Chen</t></r></si></sst>`) },
      { name: "xl/worksheets/sheet1.xml", data: enc(sheet) },
    ];
    // A real workbook is deflated; rebuild the stored zip with method 8 entries.
    const stored = zipStore(files);
    const deflated = await deflateZip(stored, files);
    const t = await readXlsx(deflated);
    expect(t.rows).toEqual([["Name", "Number"], ["Ava Chen", "7"]]);
    expect(t.notes.join(" ")).toMatch(/Only the First Sheet/);
    expect(t.notes.join(" ")).toMatch(/1 Formula/);
  });
});

// A minimal deflated zip, for the reader's inflate path.
async function deflateZip(_stored: Uint8Array, files: { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const comp = new Uint8Array(deflateRawSync(f.data));
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, off, true);
    ch.set(name, 46);
    parts.push(lh, comp); central.push(ch);
    off += lh.length + comp.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, off, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

describe("import: proposed mapping, uncertainty, nothing dropped", () => {
  const rows = [
    ["First Name", "Last Name", "Jersey #", "Pos", "Parent Phone", "Shirt Size"],
    ["Ava", "Chen", "7", "Pitcher", "555-0101", "M"],
    ["Ben", "Ruiz", "12?", "SS/2B", "", "L"],
    ["Cal", "Diaz", "#3", "Catcher", "", "S"],
  ];
  it("proposes every column a home, and an unknown column is kept as an extra field", () => {
    const p = newTeamPage();
    const map = proposeMapping(p, rows[0]!);
    expect(map.map((m) => m.target)).toEqual(["name", "name", "number", "position", "contact", T_EXTRA]);
  });

  it("flags what it is unsure of, tidies what it is sure of, and keeps the extra column", () => {
    const p = newTeamPage();
    const plan = planImport(p, rows.slice(1), proposeMapping(p, rows[0]!));
    expect(plan.records.map((r) => r.v.name)).toEqual(["Ava Chen", "Ben Ruiz", "Cal Diaz"]);
    expect(plan.records[1]!.flags).toEqual({ number: "Not One Clear Number", position: "More Than One Position" });
    expect(plan.records[2]!.v.number).toBe("3");
    expect(plan.records[2]!.flags).toBeUndefined();
    expect(plan.newFields.map((f) => f.label)).toEqual(["Shirt Size"]);
    const applied = applyImport(p, plan, 1);
    const shirt = applied.fields.find((f) => f.label === "Shirt Size")!.key;
    expect(applied.records[0]!.v[shirt]).toBe("M");
  });

  it("a column he leaves out is reported, never silently dropped", () => {
    const p = newTeamPage();
    const map = proposeMapping(p, rows[0]!).map((m) => (m.header === "Shirt Size" ? { ...m, target: T_SKIP } : m));
    expect(planImport(p, rows.slice(1), map).leftOut).toEqual(["Shirt Size"]);
  });
});

describe("reimport: matched by id, local edits kept, asked only on conflicts", () => {
  const setup = () => {
    let p = team([["Ava Chen", "7", "Pitcher"], ["Ben Ruiz", "12", "Catcher"], ["Cal Diaz", "3", "First"]]);
    p = markBase(p); // as at export
    return p;
  };
  it("our own export maps exactly, with no mapping to confirm", () => {
    const p = setup();
    const table = pageTable(p);
    expect(table[0]![0]).toBe(ID_HEADER);
    expect(mappingIsExact(p, proposeMapping(p, table[0]!))).toBe(true);
  });

  it("export, edit in Sheets, reimport: no duplicates, changes applied, local edits preserved, conflicts asked", () => {
    let p = setup();
    const file = parseDelimited(toCsv(pageTable(p)));
    // In Sheets: Ava's number changes, Ben's position changes, Cal is deleted, a new player is added.
    file[1]![2] = "8";
    file[2]![3] = "Shortstop";
    file.splice(3, 1);
    file.push(["", "Dee Park", "21", "Outfield", ""]);
    // Meanwhile on the phone: Ben's number is edited (kept), and Ben's position is edited too (a conflict).
    p = setValues(p, p.records[1]!.id, { number: "13", position: "Second" });
    const map = proposeMapping(p, file[0]!);
    expect(map[0]!.target).toBe(T_ID);
    const c = reconcile(p, file.slice(1), map);
    expect(c.changed.map((x) => x.name)).toEqual(["Ava Chen"]);
    expect(c.keptLocal[0]!.fields.map((f) => f.key)).toEqual(["number"]);
    expect(c.conflicts.map((x) => x.key)).toEqual(["position"]);
    expect(c.removed.map((x) => x.name)).toEqual(["Cal Diaz"]);
    expect(c.added.map((x) => x.v.name)).toEqual(["Dee Park"]);
    const next = applyReconcile(p, c, { [conflictKey(c.conflicts[0]!)]: "incoming" }, 10);
    expect(next.records.map((r) => r.v.name)).toEqual(["Ava Chen", "Ben Ruiz", "Dee Park"]);
    expect(new Set(next.records.map((r) => r.id)).size).toBe(3);
    expect(next.records[1]!.v).toMatchObject({ number: "13", position: "Shortstop" });
    expect(next.snapshots!.at(-1)!.why).toBe("reimport");
    // The same file again: nothing new, and Ben's local number still reads as his own edit.
    const again = reconcile(next, file.slice(1), proposeMapping(next, file[0]!));
    expect(again.added).toHaveLength(1); // the id-less row is new each time it comes without an id
    expect(again.changed).toHaveLength(0);
    expect(again.conflicts).toHaveLength(0);
    expect(again.keptLocal.map((k) => k.name)).toEqual(["Ben Ruiz"]);
  });
});

describe("export", () => {
  it("the scorecard exports a par row and totals, and a person gets only what was picked", () => {
    let p = newScorecardPage({ course: "Pebble", players: ["Dave", "Sam"], holes: 9, date: "2026-10-13", par: Array.from({ length: 18 }, () => 4) });
    p = setScore(p, p.records[0]!.id, 1, 5);
    const t = pageTable(p);
    expect(t[0]).toEqual([ID_HEADER, "Player", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Total", "To Par"]);
    expect(t[1]!.slice(0, 2)).toEqual(["par", "Par"]);
    expect(t[2]!.at(-1)).toBe("+1");
    const tm = team([["Ava Chen", "7", "Pitcher"], ["Ben Ruiz", "12", "Catcher"]]);
    const text = shareText("Tigers", tm, ["name", "position"], [tm.records[0]!.id]);
    expect(text).toContain("Ava Chen");
    expect(text).not.toContain("Ben");
    expect(text).not.toContain("7");
    expect(text).not.toContain("r_");
  });

  it("all three files are real: CSV text, an XLSX workbook, a PDF", async () => {
    const p = newScorecardPage({ course: "Pebble", players: ["Dave", "Sam"], date: "2026-10-13" });
    const csv = await buildPageFile("csv", "Round", p);
    expect(csv.type).toMatch(/text\/csv/);
    const xlsx = new Uint8Array(await (await buildPageFile("xlsx", "Round", p)).arrayBuffer());
    expect((await readXlsx(xlsx)).rows[0]![1]).toBe("Player");
    const pdf = await buildPageFile("pdf", "Round", p);
    const head = new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5));
    expect(head).toBe("%PDF-");
  });
});

describe("the one-pager is a printout of a Scouting Report (the Profile One-Pager folded in, 2026-10-23)", () => {
  it("one report row becomes a one-person page with only the fields that have words in them, and nothing is stored", async () => {
    let p = newTemplatePage("scouting");
    const made = addRecord(p, { name: "Sam Ortiz", team: "Hawks", strengths: "Arm, Speed", weaknesses: "" });
    p = made.page;
    const one = onePagerOf(p, made.id)!;
    expect(one.title).toBe("Sam Ortiz");
    expect(one.page.kind).toBe("profile");
    expect(one.page.fields.map((f) => f.label)).toEqual(["Name", "Team", "Strengths"]);
    expect(p.records).toHaveLength(1);
    const built = await buildOnePager(p, made.id);
    expect(new TextDecoder().decode(new Uint8Array(await built!.blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });
  it("a row with nothing in it has nothing to print", () => {
    const made = addRecord(newTemplatePage("scouting"), {});
    expect(onePagerOf(made.page, made.id)).toBeNull();
    expect(onePagerOf(made.page, "missing")).toBeNull();
  });
});
