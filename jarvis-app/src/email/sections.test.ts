// THE FIVE SECTIONS' RESOLVER (Email v1 spec 3.2, 3.3; Dave 2026-10-12). Each
// rule on its own, the order between them, the fall to Other when a fact is
// missing, and the exact-Message-ID label that never merges.
import { describe, it, expect } from "vitest";
import { dedupeRows, groupSections, isCalendar, isMailingList, loadOverrides, loadView, loadedWord, moveToSection, sameContent, saveView, sectionOf, threadCounts, threadWord } from "./sections";
import type { InboxRow } from "./emailClient";

const row = (id: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id, account_id: "a1", account: "dave@example.test", provider_id: "p" + id, thread_id: "t" + id, internal_date: "2026-10-03T10:00:00Z", from_address: "x@example.test", from_name: "X",
  subject: "Meeting about the invoice $40", snippet: "Unsubscribe here", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h", read: true, ...o,
});

function mem(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe("the resolver, rule by rule", () => {
  it("Other when the row carries no facts: words in the subject or snippet never decide (no meeting, no amount, no unsubscribe text)", () => {
    expect(sectionOf(row("1"))).toBe("other");
    // A row cached before migration 0067: every fact absent.
    expect(sectionOf(row("2", { own_reply: undefined, list_id: undefined, mime_type: undefined }))).toBe("other");
  });

  it("Conversations: this account's thread holds a message Dave sent (own_reply), never a contact match", () => {
    expect(sectionOf(row("1", { own_reply: true }))).toBe("conversations");
    expect(sectionOf(row("1", { own_reply: false }))).toBe("other");
    expect(sectionOf(row("1", { own_reply: null }))).toBe("other");
  });

  it("Schedule: calendar MIME structure only: a text/calendar message, a calendar Content-Class, or a text/calendar or .ics part", () => {
    expect(sectionOf(row("1", { mime_type: "text/calendar" }))).toBe("schedule");
    expect(sectionOf(row("1", { content_class: "urn:content-classes:calendarmessage" }))).toBe("schedule");
    expect(sectionOf(row("1", { attachment_metadata: [{ filename: "invite.ics", mime: "application/octet-stream", attachmentId: "a", size: 1 }] }))).toBe("schedule");
    expect(sectionOf(row("1", { attachment_metadata: [{ filename: "x", mime: "text/calendar", attachmentId: "a", size: 1 }] }))).toBe("schedule");
    expect(isCalendar(row("1", { mime_type: "multipart/mixed", subject: "Calendar invite: meeting" }))).toBe(false);
    expect(isCalendar(row("1", { attachment_metadata: [{ filename: "bill.pdf", mime: "application/pdf", attachmentId: "a", size: 1 }] }))).toBe(false);
  });

  it("Money: an exact registered sender and subject format, from list-time metadata alone; an amount, a filename or an invoice word from anyone else is not enough", () => {
    expect(sectionOf(row("1", { subject: "Invoice #42 · $142.30", attachment_metadata: [{ filename: "invoice.pdf", mime: "application/pdf", attachmentId: "a", size: 1 }] }))).toBe("other");
    // Unopened (has_body false, no attachments): the registered sender and its bill format are enough.
    expect(sectionOf(row("1", { from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Due" }))).toBe("money");
    expect(sectionOf(row("1", { from_address: "no_reply@email.apple.com", subject: "Your receipt from Apple." }))).toBe("money");
    // The same sender's marketing is not Money; with a List-Unsubscribe it is a Mailing List.
    expect(sectionOf(row("1", { from_address: "no_reply@email.apple.com", subject: "Your Subscription Price Increase" }))).toBe("other");
    expect(sectionOf(row("1", { from_address: "no_reply@email.apple.com", subject: "Your Subscription Price Increase", list_unsubscribe: "<u>" }))).toBe("lists");
    // The registered format from a lookalike sender, or forwarded by a person, is not Money.
    expect(sectionOf(row("1", { from_address: "noreply@billing.coned.com.example.test", subject: "Your Con Edison Bill Is Due" }))).toBe("other");
    expect(sectionOf(row("1", { from_address: "dave@example.test", subject: "Fwd: Your Con Edison Bill Is Due" }))).toBe("other");
  });

  it("Mailing Lists: a List-ID or List-Unsubscribe header with something in it", () => {
    expect(sectionOf(row("1", { list_id: "<news.example.test>" }))).toBe("lists");
    expect(sectionOf(row("1", { list_unsubscribe: "<mailto:off@example.test>" }))).toBe("lists");
    expect(isMailingList(row("1", { list_id: "  ", list_unsubscribe: "" }))).toBe(false);
  });
});

describe("the resolver's order (3.2: one primary section, the first rule that matches)", () => {
  const everything: Partial<InboxRow> = { own_reply: true, mime_type: "text/calendar", list_id: "<l>", list_unsubscribe: "<u>" };
  it("a person's own Move to Section beats every rule; then Conversations, Schedule, Mailing Lists, Other", () => {
    expect(sectionOf(row("1", everything), { "1": "other" })).toBe("other");
    expect(sectionOf(row("1", everything))).toBe("conversations");
    expect(sectionOf(row("1", { ...everything, own_reply: false }))).toBe("schedule");
    expect(sectionOf(row("1", { ...everything, own_reply: false, mime_type: null }))).toBe("lists");
    // Money sits after Schedule and before Mailing Lists.
    const bill: Partial<InboxRow> = { from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Ready" };
    expect(sectionOf(row("1", { ...everything, ...bill }))).toBe("conversations");
    expect(sectionOf(row("1", { ...everything, ...bill, own_reply: false }))).toBe("schedule");
    expect(sectionOf(row("1", { ...everything, ...bill, own_reply: false, mime_type: null }))).toBe("money");
    expect(sectionOf(row("1", { ...everything, ...bill, own_reply: false, mime_type: null }), { "1": "lists" })).toBe("lists");
    // A Conversation that is also a list is still one row, in Conversations.
    expect(sectionOf(row("1", { own_reply: true, list_id: "<l>" }))).toBe("conversations");
  });
  it("an override naming a section that does not exist is ignored", () => {
    expect(sectionOf(row("1", { list_id: "<l>" }), { "1": "bogus" as never })).toBe("lists");
  });
});

describe("grouping the loaded page", () => {
  it("is the fixed order, each section newest first as given, empty sections omitted, every row in exactly one", () => {
    const rows = [row("a", { list_id: "<l>" }), row("b", { own_reply: true }), row("c"), row("d", { mime_type: "text/calendar" }), row("e", { own_reply: true })];
    const g = groupSections(rows);
    expect(g.map((s) => s.key)).toEqual(["conversations", "schedule", "lists", "other"]);
    expect(g[0]!.rows.map((r) => r.id)).toEqual(["b", "e"]);
    expect(g.flatMap((s) => s.rows).length).toBe(rows.length);
    expect(groupSections([])).toEqual([]);
    expect(loadedWord(12)).toBe("12 Loaded");
  });
});

describe("Same Content (3.3): an exact Message-ID in two connected mailboxes is a label, never a merge", () => {
  it("labels both copies with the other account, and matches nothing fuzzy", () => {
    const rows = [
      row("1", { account: "dave@example.test", rfc_message_id: "<abc@mail.test>" }),
      row("2", { account: "work@example.test", rfc_message_id: "abc@mail.test" }),
      // Same subject, sender and minute but a different Message-ID: not the same.
      row("3", { account: "work@example.test", rfc_message_id: "<other@mail.test>" }),
      // No Message-ID cached: never matched.
      row("4", { account: "work@example.test", rfc_message_id: null }),
      row("5", { account: "dave@example.test" }),
    ];
    expect(sameContent(rows)).toEqual({ "1": ["work@example.test"], "2": ["dave@example.test"] });
  });
  it("two deliveries in the same mailbox are not another account's copy", () => {
    expect(sameContent([row("1", { rfc_message_id: "<x>" }), row("2", { rfc_message_id: "<x>" })])).toEqual({});
  });
});

describe("what the device remembers", () => {
  it("Grouped by default; All by Date once chosen, per user; a broken store falls back to Grouped", () => {
    const s = mem();
    expect(loadView("u1", s)).toBe("grouped");
    saveView("u1", "date", s);
    expect(loadView("u1", s)).toBe("date");
    expect(loadView("u2", s)).toBe("grouped");
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadView("u1", broken)).toBe("grouped");
    expect(() => saveView("u1", "date", broken)).not.toThrow();
  });
  it("Move to Section is per message, kept, and put back", () => {
    const s = mem();
    expect(moveToSection("u1", "m1", "money", s)).toEqual({ m1: "money" });
    expect(loadOverrides("u1", s)).toEqual({ m1: "money" });
    expect(moveToSection("u1", "m1", null, s)).toEqual({});
    s.setItem("jarvis.email.sectionOverride.v1:u1", JSON.stringify({ m2: "nowhere", m3: "lists" }));
    expect(loadOverrides("u1", s)).toEqual({ m3: "lists" });
  });
});

describe("one row per message in Grouped, and the thread count (Dave via Alfred, issue 103)", () => {
  it("the same message under two row ids (a stale snapshot) is one row, keyed on the id and on account plus provider id", () => {
    const rows = [row("1"), row("1"), row("9", { account_id: "a1", provider_id: "p1" }), row("2")];
    expect(dedupeRows(rows).map((r) => r.id)).toEqual(["1", "2"]);
    const sections = groupSections(rows);
    expect(sections.flatMap((s) => s.rows.map((r) => r.id))).toEqual(["1", "2"]);
  });
  it("two connected mailboxes holding the same provider id are two messages, never collapsed", () => {
    const rows = [row("1", { account_id: "a1", provider_id: "same" }), row("2", { account_id: "a2", provider_id: "same" })];
    expect(dedupeRows(rows)).toHaveLength(2);
  });
  it("a thread of two or more loaded messages counts on each of its rows; a lone message and another account's thread do not", () => {
    const rows = [
      row("1", { thread_id: "T" }), row("2", { thread_id: "T" }), row("3", { thread_id: "T" }),
      row("4", { thread_id: "U" }),
      row("5", { account_id: "a2", thread_id: "T" }),
      row("6", { thread_id: "" }), row("7", { thread_id: "" }),
    ];
    expect(threadCounts(rows)).toEqual({ "1": 3, "2": 3, "3": 3 });
  });
  it("the count reads as a number, then a capitalized word", () => {
    expect(threadWord(3)).toBe("3 Messages");
  });
  it("a thread split by sections keeps one row per message, each in exactly one section", () => {
    const rows = [row("1", { thread_id: "T", own_reply: true }), row("2", { thread_id: "T", list_unsubscribe: "<u>" }), row("3", { thread_id: "T", mime_type: "text/calendar" })];
    const ids = groupSections(rows).flatMap((s) => s.rows.map((r) => r.id)).sort();
    expect(ids).toEqual(["1", "2", "3"]);
  });
});
