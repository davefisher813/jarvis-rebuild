import { describe, it, expect } from "vitest";
import {
  SECTION_ERRORS, SECTION_LIMITS, addSectionBlock, filterBySection, foldText, isCapError, matchesSection,
  newSectionId, normalizeSection, readEmailSections, removeSection, restoreSection, upsertSection, validateSection,
  type EmailSection, type SectionThread,
} from "./emailSections";

const sec = (name: string, ...m: [("sender" | "subject"), string][]): EmailSection => ({
  id: newSectionId(), name, matchers: m.map(([field, text]) => ({ field, text })),
});
const th = (o: Partial<SectionThread> = {}): SectionThread => ({
  from: "Marco Rossi", fromEmail: "marco@northlake.org", subject: "Waiver for Friday", snippet: "Please send it by noon", ...o,
});

describe("normalization", () => {
  it("trims a name and every matcher, and keeps what was typed otherwise", () => {
    const n = normalizeSection({ id: "a", name: "  Team  Mail ", matchers: [{ field: "sender", text: "  Marco Rossi  " }] });
    expect(n).toEqual({ id: "a", name: "Team  Mail", matchers: [{ field: "sender", text: "Marco Rossi" }] });
  });
  it("folds by NFKC and case: full-width and compatibility forms are the same text", () => {
    expect(foldText("Ｍａｒｃｏ")).toBe("marco");
    expect(foldText("ﬁnal")).toBe("final"); // the fi ligature
    expect(foldText("CAFÉ")).toBe(foldText("café"));
  });
  it("never truncates: an over-long name survives normalization to be reported", () => {
    const long = "x".repeat(200);
    expect(normalizeSection({ id: "a", name: long, matchers: [{ field: "subject", text: long }] })).toEqual({ id: "a", name: long, matchers: [{ field: "subject", text: long }] });
  });
});

describe("matching is a literal, case-insensitive substring", () => {
  it("Sender Contains matches the display name or the email address", () => {
    expect(matchesSection(th(), sec("A", ["sender", "marco"]))).toBe(true);
    expect(matchesSection(th(), sec("A", ["sender", "ROSSI"]))).toBe(true);
    expect(matchesSection(th(), sec("A", ["sender", "@northlake.org"]))).toBe(true);
    expect(matchesSection(th(), sec("A", ["sender", "waiver"]))).toBe(false);
  });
  it("Subject or Preview Contains matches the decoded subject or the snippet", () => {
    expect(matchesSection(th(), sec("A", ["subject", "waiver"]))).toBe(true);
    expect(matchesSection(th(), sec("A", ["subject", "BY NOON"]))).toBe(true);
    expect(matchesSection(th(), sec("A", ["subject", "marco"]))).toBe(false);
  });
  it("decodes the entities Gmail leaves in a snippet before matching", () => {
    const t = th({ snippet: "Don&#39;t miss Sarah &amp; Co" });
    expect(matchesSection(t, sec("A", ["subject", "don't miss"]))).toBe(true);
    expect(matchesSection(t, sec("A", ["subject", "sarah & co"]))).toBe(true);
    expect(matchesSection(t, sec("A", ["subject", "&#39;"]))).toBe(false);
  });
  it("is Unicode-normalized on both sides", () => {
    expect(matchesSection(th({ from: "Renée" }), sec("A", ["sender", "renée"]))).toBe(true);
    expect(matchesSection(th({ subject: "ＦＩＮＡＬ" }), sec("A", ["subject", "final"]))).toBe(true);
  });
  it("trims the needle but not the meaning: inner spaces are literal", () => {
    expect(matchesSection(th(), sec("A", ["subject", "  waiver for  "]))).toBe(true);
    expect(matchesSection(th(), sec("A", ["subject", "waiver  for"]))).toBe(false);
  });
  it("treats regex characters and wildcards as plain characters", () => {
    const t = th({ subject: "Invoice (June) [2] a.c $5 + tax? ^start end$ | pipe \\ back" });
    for (const lit of ["(june)", "[2]", "a.c", "$5", "+ tax?", "^start", "end$", "| pipe", "\\ back"]) {
      expect(matchesSection(t, sec("A", ["subject", lit])), lit).toBe(true);
    }
    // ...and they never act as patterns.
    expect(matchesSection(th({ subject: "abc" }), sec("A", ["subject", "a.c"]))).toBe(false);
    expect(matchesSection(th({ subject: "anything" }), sec("A", ["subject", "*"]))).toBe(false);
    expect(matchesSection(th({ subject: "anything" }), sec("A", ["subject", ".*"]))).toBe(false);
    expect(matchesSection(th({ subject: "ac" }), sec("A", ["subject", "a?c"]))).toBe(false);
    expect(matchesSection(th({ subject: "june" }), sec("A", ["subject", "(june|july)"]))).toBe(false);
    expect(matchesSection(th({ subject: "x" }), sec("A", ["subject", "["]))).toBe(false);
    expect(matchesSection(th({ subject: "has * star" }), sec("A", ["subject", "*"]))).toBe(true);
  });
  it("does no synonym matching", () => {
    expect(matchesSection(th({ subject: "Invoice" }), sec("A", ["subject", "bill"]))).toBe(false);
    expect(matchesSection(th({ subject: "Invoices" }), sec("A", ["subject", "invoice"]))).toBe(true); // a substring, by design
  });
  it("several matchers are ANY: one is enough, across both fields", () => {
    const s = sec("A", ["sender", "nobody"], ["subject", "waiver"]);
    expect(matchesSection(th(), s)).toBe(true);
    expect(matchesSection(th({ subject: "Lunch", snippet: "" }), s)).toBe(false);
  });
  it("an empty matcher matches nothing, never everything", () => {
    expect(matchesSection(th(), sec("A", ["sender", ""]))).toBe(false);
    expect(matchesSection(th(), sec("A", ["subject", "   "]))).toBe(false);
    expect(matchesSection(th(), sec("A"))).toBe(false);
    // ...and does not spoil a real matcher beside it.
    expect(matchesSection(th(), sec("A", ["sender", ""], ["subject", "waiver"]))).toBe(true);
    expect(filterBySection([th(), th({ from: "X", fromEmail: "x@y.z" })], sec("A", ["sender", ""]))).toEqual([]);
  });
});

describe("filtering the list", () => {
  type Row = SectionThread & { id: string; bucket: string };
  const rows: Row[] = [
    { id: "1", bucket: "needs_you", ...th({ from: "Marco", fromEmail: "m@a.org", subject: "Waiver" }) },
    { id: "2", bucket: "noise", ...th({ from: "Store", fromEmail: "s@b.com", subject: "Sale", snippet: "waiver of fees" }) },
    { id: "3", bucket: "worth_knowing", ...th({ from: "Marco", fromEmail: "m@a.org", subject: "Lunch", snippet: "" }) },
  ];
  it("null is All and returns every row", () => {
    expect(filterBySection(rows, null).map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
  it("keeps the input order and hands back the SAME rows, so each keeps its bucket", () => {
    const out = filterBySection(rows, sec("A", ["sender", "marco"], ["subject", "waiver"]));
    expect(out.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(out[0]).toBe(rows[0]);
    expect(out.map((r) => r.bucket)).toEqual(["needs_you", "noise", "worth_knowing"]);
  });
  it("a thread that matches several matchers, or several sections, appears once per list", () => {
    const both = sec("A", ["sender", "marco"], ["subject", "waiver"]);
    expect(filterBySection(rows, both).filter((r) => r.id === "1")).toHaveLength(1);
    const a = filterBySection(rows, sec("A", ["sender", "marco"]));
    const b = filterBySection(rows, sec("B", ["subject", "waiver"]));
    expect(a.map((r) => r.id)).toEqual(["1", "3"]);
    expect(b.map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("does not mutate the rows or the section", () => {
    const s = sec("A", ["sender", "marco"]);
    const before = JSON.stringify([rows, s]);
    filterBySection(rows, s);
    expect(JSON.stringify([rows, s])).toBe(before);
  });
});

describe("validation", () => {
  const ok = (name = "Team") => sec(name, ["sender", "marco"]);
  it("accepts a well-formed section", () => {
    expect(validateSection(ok(), [])).toMatchObject({ ok: true, matchers: [undefined] });
  });
  it("an empty or blank name is an error", () => {
    expect(validateSection(ok(""), []).name).toBe(SECTION_ERRORS.nameEmpty);
    expect(validateSection(ok("   "), []).name).toBe(SECTION_ERRORS.nameEmpty);
  });
  it("names are unique after case folding and trimming, against OTHER sections only", () => {
    const other = ok("Team");
    expect(validateSection(ok("team"), [other]).name).toBe(SECTION_ERRORS.nameTaken);
    expect(validateSection(ok("  TEAM "), [other]).name).toBe(SECTION_ERRORS.nameTaken);
    expect(validateSection(ok("Tｅam"), [other]).name).toBe(SECTION_ERRORS.nameTaken); // full-width e, NFKC
    expect(validateSection(ok("Teams"), [other]).ok).toBe(true);
    // Editing a section against itself is not a clash.
    expect(validateSection({ ...other, name: "TEAM" }, [other]).ok).toBe(true);
  });
  it("an empty matcher is an error and names which one", () => {
    const v = validateSection(sec("A", ["sender", "marco"], ["subject", "  "]), []);
    expect(v.ok).toBe(false);
    expect(v.matchers).toEqual([undefined, SECTION_ERRORS.matcherEmpty]);
  });
  it("no matchers is an error", () => {
    expect(validateSection(sec("A"), []).section).toBe(SECTION_ERRORS.noMatchers);
  });
  it("caps: the name at 60, a matcher at 200, matchers at 50, sections at 50, each an error and none applied", () => {
    expect(validateSection(ok("n".repeat(60)), []).ok).toBe(true);
    expect(validateSection(ok("n".repeat(61)), []).name).toBe(SECTION_ERRORS.nameLong);
    expect(validateSection(sec("A", ["sender", "m".repeat(200)]), []).ok).toBe(true);
    expect(validateSection(sec("A", ["sender", "m".repeat(201)]), []).matchers[0]).toBe(SECTION_ERRORS.matcherLong);
    const fifty = sec("A", ...Array.from({ length: 50 }, (_, i) => ["sender", "m" + i] as ["sender", string]));
    expect(validateSection(fifty, []).ok).toBe(true);
    const fiftyOne = sec("A", ...Array.from({ length: 51 }, (_, i) => ["sender", "m" + i] as ["sender", string]));
    expect(validateSection(fiftyOne, []).section).toBe(SECTION_ERRORS.tooManyMatchers);
    const list = Array.from({ length: SECTION_LIMITS.sections }, (_, i) => ok("S" + i));
    expect(addSectionBlock(list.slice(0, 49))).toBeNull();
    expect(addSectionBlock(list)).toBe(SECTION_ERRORS.tooManySections);
  });
  it("counts characters, not UTF-16 units: 60 astral characters fit", () => {
    expect(validateSection(ok("\u{1F600}".repeat(60)), []).ok).toBe(true);
    expect(validateSection(ok("\u{1F600}".repeat(61)), []).name).toBe(SECTION_ERRORS.nameLong);
  });
  it("says which errors are about a cap", () => {
    expect(isCapError(SECTION_ERRORS.nameLong)).toBe(true);
    expect(isCapError(SECTION_ERRORS.tooManySections)).toBe(true);
    expect(isCapError(SECTION_ERRORS.nameEmpty)).toBe(false);
    expect(isCapError(undefined)).toBe(false);
  });
});

describe("ids and list operations", () => {
  it("ids are unique and stable across a rename", () => {
    const a = sec("A", ["sender", "x"]);
    expect(newSectionId()).not.toBe(newSectionId());
    expect(upsertSection([a], { ...a, name: "  Renamed " })).toEqual([{ ...a, name: "Renamed" }]);
  });
  it("upsert appends a new section and replaces an existing one in place", () => {
    const a = sec("A", ["sender", "x"]);
    const b = sec("B", ["sender", "y"]);
    expect(upsertSection([a], b).map((s) => s.name)).toEqual(["A", "B"]);
    expect(upsertSection([a, b], { ...a, name: "A2" }).map((s) => s.name)).toEqual(["A2", "B"]);
  });
  it("remove then restore puts the section back where it was", () => {
    const [a, b, c] = [sec("A", ["sender", "x"]), sec("B", ["sender", "y"]), sec("C", ["sender", "z"])] as const;
    const without = removeSection([a, b, c], b.id);
    expect(without.map((s) => s.name)).toEqual(["A", "C"]);
    expect(restoreSection(without, b, 1).map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(restoreSection(without, b, 99).map((s) => s.name)).toEqual(["A", "C", "B"]);
    // Undo twice is one section, not two.
    expect(restoreSection(restoreSection(without, b, 1), b, 1)).toHaveLength(3);
  });
});

describe("reading what the profile holds", () => {
  it("returns nothing for anything that is not a list", () => {
    for (const bad of [undefined, null, "x", 3, {}]) expect(readEmailSections(bad)).toEqual([]);
  });
  it("drops entries that are not sections and keeps the rest untouched", () => {
    const good = { id: "s1", name: "Team", matchers: [{ field: "sender", text: "marco" }, { field: "nope", text: "x" }, { field: "subject", text: 3 }] };
    const out = readEmailSections([null, 4, { id: "", name: "x", matchers: [] }, { id: "s2", name: 5, matchers: [] }, good, { ...good }]);
    expect(out).toEqual([{ id: "s1", name: "Team", matchers: [{ field: "sender", text: "marco" }] }]);
  });
  it("does not cap or trim on the way in", () => {
    const long = "y".repeat(500);
    expect(readEmailSections([{ id: "s1", name: long, matchers: [{ field: "sender", text: "  " + long }] }])[0]).toEqual({ id: "s1", name: long, matchers: [{ field: "sender", text: "  " + long }] });
  });
});
