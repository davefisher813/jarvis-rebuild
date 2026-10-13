// THE SENDER'S CONTACT, RESOLVED EXACTLY OR NOT AT ALL (issue 112, item 14; Email v1 spec 4 and AC07, AC08, AC10).
// The rules under test, in the spec's own words: the address is compared trimmed and parsed, "Do not strip dots or plus
// suffixes", "Do not match names alone", own addresses excluded, "Multiple matching contacts show Choose contact; no silent
// winner". And the sheet's mail list is mail FROM exactly that address: the cached search also returns mail that merely
// mentions it, and none of that may be shown as theirs.
import { describe, it, expect } from "vitest";
import { addressKey, groupFacts, recentFrom, resolveSender } from "./contactResolve";
import type { Person, PersonData } from "../people/types";
import type { Category } from "../categories/types";
import type { InboxRow } from "./emailClient";

const person = (id: string, name: string, o: Partial<PersonData> = {}): Person => ({ id, data: { name, group: "contacts", ...o } });
const MAYA = person("p-maya", "Maya Chen", { email: "maya@example.test", emails: [{ value: "maya@example.test" }, { value: "maya.chen@work.test", label: "work" }] });
const OWN = ["dave@example.test", "Work@Example.Test"];

describe("addressKey: trimmed, parsed, lowercased, and nothing cleverer", () => {
  it("reads a bare address, a padded one and a Name <address> form to the same key", () => {
    expect(addressKey("maya@example.test")).toBe("maya@example.test");
    expect(addressKey("  Maya@Example.TEST \n")).toBe("maya@example.test");
    expect(addressKey("Maya Chen <maya@example.test>")).toBe("maya@example.test");
    expect(addressKey("<MAYA@example.test>")).toBe("maya@example.test");
    expect(addressKey("")).toBe("");
    expect(addressKey("   ")).toBe("");
  });

  it("never strips a dot or a plus tag: those are the person's own, and guessing them merges two real people", () => {
    expect(addressKey("dave.f@x.test")).toBe("dave.f@x.test");
    expect(addressKey("dave+news@x.test")).toBe("dave+news@x.test");
    expect(addressKey("dave.f@x.test")).not.toBe(addressKey("davef@x.test"));
    expect(addressKey("dave+news@x.test")).not.toBe(addressKey("dave@x.test"));
  });
});

describe("resolveSender: one contact, none, many, the person's own mailbox, or not known", () => {
  it("matches a contact on its primary address and on any of its other addresses", () => {
    expect(resolveSender("maya@example.test", [MAYA], OWN)).toEqual({ kind: "one", person: MAYA });
    expect(resolveSender("maya.chen@work.test", [MAYA], OWN)).toEqual({ kind: "one", person: MAYA });
  });

  it("matches across case, padding and the angle-bracket form, on both sides", () => {
    expect(resolveSender("  MAYA@Example.Test ", [MAYA], OWN).kind).toBe("one");
    expect(resolveSender("Maya Chen <maya@example.test>", [MAYA], OWN).kind).toBe("one");
    const saved = person("p-odd", "Odd Saved", { email: "Odd Saved <ODD@Example.Test>" });
    expect(resolveSender("odd@example.test", [saved], OWN).kind).toBe("one");
  });

  it("does not match a dotted or plus-tagged variant of a saved address", () => {
    const dave = person("p-dave", "Dave F", { email: "davef@x.test" });
    expect(resolveSender("dave.f@x.test", [dave], OWN).kind).toBe("none");
    const plain = person("p-plain", "Dave Plain", { email: "dave@x.test" });
    expect(resolveSender("dave+news@x.test", [plain], OWN).kind).toBe("none");
    expect(resolveSender("dave@x.test", [plain], OWN).kind).toBe("one");
  });

  it("never matches a name: the same display name at a different address is not the contact, and neither is an alias", () => {
    const named = person("p-name", "Maya Chen", { email: "maya@example.test", aliases: ["Mom", "stranger@elsewhere.test"] });
    // The sender calls themself Maya Chen, from another address: that is only what they wrote.
    expect(resolveSender("maya.chen@other.test", [named], OWN).kind).toBe("none");
    // An alias is a name, so even an alias that looks like an address is not read.
    expect(resolveSender("stranger@elsewhere.test", [named], OWN).kind).toBe("none");
  });

  it("two contacts that carry the address are Many, both, in the order given: there is no silent winner", () => {
    const twin = person("p-twin", "Maya C.", { emails: [{ value: "MAYA@example.test" }] });
    const r = resolveSender("maya@example.test", [MAYA, person("p-other", "Someone Else", { email: "else@example.test" }), twin], OWN);
    expect(r.kind).toBe("many");
    expect(r.kind === "many" && r.people.map((p) => p.id)).toEqual(["p-maya", "p-twin"]);
    // And the other order gives the other order: nothing ranks them.
    const flipped = resolveSender("maya@example.test", [twin, MAYA], OWN);
    expect(flipped.kind === "many" && flipped.people.map((p) => p.id)).toEqual(["p-twin", "p-maya"]);
  });

  it("the person's own mailbox is not a contact, even when one is saved as a contact", () => {
    const me = person("p-me", "Dave Fisher", { email: "dave@example.test" });
    expect(resolveSender("dave@example.test", [me], OWN)).toEqual({ kind: "own" });
    expect(resolveSender("work@example.test", [], OWN)).toEqual({ kind: "own" });
  });

  it("a People store that could not be read claims nothing; the person's own mailbox still needs no store", () => {
    expect(resolveSender("maya@example.test", null, OWN)).toEqual({ kind: "unknown" });
    expect(resolveSender("dave@example.test", null, OWN)).toEqual({ kind: "own" });
  });

  it("an empty address is nobody, and an empty list of contacts places no one", () => {
    expect(resolveSender("", [MAYA], OWN)).toEqual({ kind: "none" });
    expect(resolveSender("  ", null, OWN)).toEqual({ kind: "none" });
    expect(resolveSender("maya@example.test", [], OWN)).toEqual({ kind: "none" });
  });

  it("reads the store as it is handed over: a rename shows, and a deleted contact is simply not found (AC10)", () => {
    const renamed: Person = { ...MAYA, data: { ...MAYA.data, name: "Maya Chen-Ortiz" } };
    const r = resolveSender("maya@example.test", [renamed], OWN);
    expect(r.kind === "one" && r.person.data.name).toBe("Maya Chen-Ortiz");
    expect(resolveSender("maya@example.test", [], OWN).kind).toBe("none");
  });
});

describe("groupFacts: the saved groups, as the Areas the person made", () => {
  const cat = (id: string, name: string, color: Category["data"]["color"]): Category => ({ id, data: { name, color, order: 0 } });
  const AREAS = [cat("c-family", "Family", "green"), cat("c-bridge", "Bridge", "sky"), cat("c-money", "Money", "teal")];

  it("lists them in the order the contact saved them, each with its own colour", () => {
    const p = person("p", "Maya Chen", { categoryIds: ["c-bridge", "c-family"] });
    expect(groupFacts(p, AREAS)).toEqual([{ text: "Bridge", cat: "sky" }, { text: "Family", cat: "green" }]);
  });

  it("skips an Area that no longer exists, collapses a repeated one, and says nothing for a contact with no groups", () => {
    expect(groupFacts(person("p", "A", { categoryIds: ["c-gone", "c-family", "c-family"] }), AREAS)).toEqual([{ text: "Family", cat: "green" }]);
    expect(groupFacts(person("p", "A", { categoryIds: [] }), AREAS)).toEqual([]);
    expect(groupFacts(person("p", "A"), AREAS)).toEqual([]);
    expect(groupFacts(person("p", "A", { categoryIds: ["c-family"] }), [])).toEqual([]);
  });
});

describe("recentFrom: mail from exactly this address, newest first, one per thread, at most five", () => {
  const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
    id: `u-${id}`, account_id: "acct-1", account: "dave@example.test", provider_id: id, thread_id: `t-${id}`, internal_date: iso, from_address: "maya@example.test", from_name: "Maya Chen",
    subject: `Subject ${id}`, snippet: "", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true, ...o,
  });
  const ids = (list: InboxRow[]) => list.map((r) => r.provider_id);

  it("keeps only mail whose sender is the address: mail that merely names it in its subject or words is not theirs", () => {
    const mine = row("a", "2026-10-13T10:00:00Z");
    const mentions = row("b", "2026-10-13T11:00:00Z", { from_address: "boss@example.test", from_name: "Boss", subject: "Please reply to maya@example.test", snippet: "cc maya@example.test" });
    const lookalike = row("c", "2026-10-13T12:00:00Z", { from_address: "xmaya@example.test" });
    const dotted = row("d", "2026-10-13T12:30:00Z", { from_address: "maya.chen@example.test" });
    expect(ids(recentFrom("maya@example.test", [[mine, mentions, lookalike, dotted]]))).toEqual(["a"]);
  });

  it("reads the sender the way a contact is read: case, padding and the angle-bracket form on either side", () => {
    const mixed = row("a", "2026-10-13T10:00:00Z", { from_address: " Maya@Example.TEST " });
    expect(ids(recentFrom("Maya Chen <maya@example.test>", [[mixed]]))).toEqual(["a"]);
  });

  it("drops Trash and Spam, which the person has already sent away", () => {
    const list = [row("a", "2026-10-13T10:00:00Z"), row("t", "2026-10-13T11:00:00Z", { provider_labels: ["TRASH"] }), row("s", "2026-10-13T12:00:00Z", { provider_labels: ["SPAM", "UNREAD"] })];
    expect(ids(recentFrom("maya@example.test", [list]))).toEqual(["a"]);
  });

  it("is one message per thread, the newest of that sender's in it, and two accounts' threads with one id are two threads", () => {
    const list = [
      row("old", "2026-10-10T10:00:00Z", { thread_id: "shared" }),
      row("new", "2026-10-12T10:00:00Z", { thread_id: "shared" }),
      row("mid", "2026-10-11T10:00:00Z", { thread_id: "shared" }),
      row("other-acct", "2026-10-09T10:00:00Z", { thread_id: "shared", account_id: "acct-2", account: "work@example.test" }),
    ];
    expect(ids(recentFrom("maya@example.test", [list]))).toEqual(["new", "other-acct"]);
  });

  it("a message with no thread id stands alone", () => {
    const list = [row("a", "2026-10-13T10:00:00Z", { thread_id: "" }), row("b", "2026-10-13T09:00:00Z", { thread_id: "" })];
    expect(ids(recentFrom("maya@example.test", [list]))).toEqual(["a", "b"]);
  });

  it("is newest first, with the provider id as the tiebreak the whole tab uses, and capped at five", () => {
    const same = "2026-10-13T10:00:00Z";
    const list = [row("a", same), row("c", same), row("b", same), ...[1, 2, 3, 4].map((n) => row(`z${n}`, `2026-10-0${n}T10:00:00Z`))];
    expect(ids(recentFrom("maya@example.test", [list]))).toEqual(["c", "b", "a", "z4", "z3"]);
    expect(recentFrom("maya@example.test", [list], 2)).toHaveLength(2);
  });

  it("merges two pools without a duplicate, and keeps the first pool's copy (the loaded row carries the read state just changed)", () => {
    const loaded = row("a", "2026-10-13T10:00:00Z", { read: true });
    const staleCopy = row("a", "2026-10-13T10:00:00Z", { read: false });
    const onlyFound = row("b", "2026-10-12T10:00:00Z");
    const out = recentFrom("maya@example.test", [[loaded], [staleCopy, onlyFound]]);
    expect(ids(out)).toEqual(["a", "b"]);
    expect(out[0]!.read).toBe(true);
  });

  it("an empty address, or no mail, is an empty list", () => {
    expect(recentFrom("", [[row("a", "2026-10-13T10:00:00Z", { from_address: "" })]])).toEqual([]);
    expect(recentFrom("maya@example.test", [])).toEqual([]);
    expect(recentFrom("maya@example.test", [[]])).toEqual([]);
  });
});
