// WHY A MESSAGE SITS WHERE IT DOES (issue 112, item 15; Email v1 spec 3.2: "Click Why this section? for the rule and evidence").
// The reason is the resolver's own: sectionOf and whySection are defined from the same two steps, so what the sheet says can never
// disagree with where the row is drawn. This pins four things:
//   - the invariant: for every combination of facts the key whySection gives is the key sectionOf gives and the key groupSections
//     draws the row under, and the evidence is the rule the spec's order says decided it (an independent oracle below);
//   - the evidence per rule is a fact the rule really read, and nothing else (no subject word, no amount, no named message);
//   - a person's move says what the message would be without it, and an invalid move is ignored;
//   - the honest cases: a row cached before the facts were kept, and two Money templates at once.
import { describe, it, expect, vi } from "vitest";
import { groupSections, sectionOf, whySection, SECTION_KEYS, type Overrides, type SectionKey, type SectionWhy } from "./sections";
import type { AttachmentMeta, InboxRow } from "./emailClient";

// The real registry's entries never overlap, so two templates fitting one message cannot be built from it. The registry's answer is
// faked for ONE subject; every other message goes through the real matchMoney.
const AMBIGUOUS_SUBJECT = "Both Templates Fit This Subject";
vi.mock("./moneyRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("./moneyRegistry")>();
  const matchMoney: typeof real.matchMoney = (r, registry) =>
    r.subject === AMBIGUOUS_SUBJECT ? { kind: "ambiguous", template_ids: ["fake.one", "fake.two"] } : real.matchMoney(r, registry);
  return { ...real, matchMoney };
});

const row = (id: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id, account_id: "a1", account: "dave@example.test", provider_id: "p" + id, thread_id: "t" + id, internal_date: "2026-10-03T10:00:00Z", from_address: "x@example.test", from_name: "X",
  subject: "Meeting about the invoice $40", snippet: "Unsubscribe here", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h", read: true, ...o,
});
const ICS: AttachmentMeta = { filename: "invite.ics", mime: "application/octet-stream", attachmentId: "a", size: 1 };
const PDF: AttachmentMeta = { filename: "bill.pdf", mime: "application/pdf", attachmentId: "b", size: 1 };
const BILL = { from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Due" } as const;

describe("the invariant: the key whySection gives is the key sectionOf gives, and the evidence is the rule that decided it", () => {
  // The spec's order, written out again here on purpose: if the resolver's order or its evidence moves, this says so.
  const oracle = (r: InboxRow, o: Overrides): SectionWhy["evidence"]["kind"] => {
    const moved = o[r.id];
    if (moved && (SECTION_KEYS as readonly string[]).includes(moved)) return "moved";
    if (r.own_reply === true) return "conversation";
    if (r.mime_type?.toLowerCase() === "text/calendar" || /calendarmessage/i.test(r.content_class ?? "") || r.attachment_metadata.some((a) => /\.ics$/i.test(a.filename))) return "calendar";
    if (r.subject === BILL.subject && r.from_address === BILL.from_address) return "money";
    if ((r.list_id ?? "").trim() || (r.list_unsubscribe ?? "").trim()) return "list";
    return "other";
  };
  const KEY_OF = { moved: null, conversation: "conversations", calendar: "schedule", money: "money", list: "lists", other: "other" } as const;

  const OVERRIDES: Overrides[] = [{}, { m: "money" }, { m: "bogus" as SectionKey }];
  const combos: Array<[string, InboxRow, Overrides]> = [];
  for (const own_reply of [true, false, undefined])
    for (const mime_type of [undefined, "text/calendar"])
      for (const content_class of [undefined, "urn:content-classes:calendarmessage"])
        for (const attachment_metadata of [[], [ICS]])
          for (const list_id of [undefined, "", "<l>"])
            for (const list_unsubscribe of [undefined, "<u>"])
              for (const who of [{}, BILL, { subject: AMBIGUOUS_SUBJECT, from_address: "x@example.test" }])
                for (const overrides of OVERRIDES) {
                  const r = row("m", { own_reply, mime_type, content_class, attachment_metadata, list_id, list_unsubscribe, ...who });
                  combos.push([JSON.stringify({ own_reply, mime_type, content_class, att: attachment_metadata.length, list_id, list_unsubscribe, who, overrides }), r, overrides]);
                }

  it("holds for every combination of facts, with and without a move (and the matrix is not an empty one)", () => {
    expect(combos.length).toBe(3 * 2 * 2 * 2 * 3 * 2 * 3 * 3);
    const seen = new Set<string>();
    for (const [name, r, o] of combos) {
      const why = whySection(r, o);
      expect(why.key, name).toBe(sectionOf(r, o));
      const kind = oracle(r, o);
      expect(why.evidence.kind, name).toBe(kind);
      if (kind !== "moved") expect(why.key, name).toBe(KEY_OF[kind]);
      else expect(why.key, name).toBe("money");
      seen.add(kind);
    }
    expect([...seen].sort()).toEqual(["calendar", "conversation", "list", "money", "moved", "other"]);
  });

  it("groupSections draws each row under the section whySection names", () => {
    const rows = combos.slice(0, 200).map(([, r], i) => ({ ...r, id: "g" + i, provider_id: "pg" + i }));
    for (const g of groupSections(rows)) for (const r of g.rows) expect(whySection(r).key).toBe(g.key);
    const overrides: Overrides = { g1: "lists", g2: "schedule" };
    for (const g of groupSections(rows, overrides)) for (const r of g.rows) expect(whySection(r, overrides).key).toBe(g.key);
  });
});

describe("each rule's evidence is a fact it read", () => {
  it("Conversations: own_reply true, and the evidence names no message, because own_reply is one yes or no for the thread", () => {
    const why = whySection(row("1", { own_reply: true }));
    expect(why).toEqual({ key: "conversations", evidence: { kind: "conversation" } });
    expect(Object.keys(why.evidence)).toEqual(["kind"]);
    for (const own_reply of [false, null, undefined] as const) expect(whySection(row("1", { own_reply })).evidence.kind).toBe("other");
  });

  it("Schedule: names the first calendar test the row passed, in the resolver's own order", () => {
    expect(whySection(row("1", { mime_type: "text/calendar" })).evidence).toEqual({ kind: "calendar", hit: "mime" });
    expect(whySection(row("1", { mime_type: "application/ICS" })).evidence).toEqual({ kind: "calendar", hit: "mime" });
    expect(whySection(row("1", { content_class: "urn:content-classes:calendarmessage" })).evidence).toEqual({ kind: "calendar", hit: "content_class" });
    expect(whySection(row("1", { attachment_metadata: [ICS] })).evidence).toEqual({ kind: "calendar", hit: "attachment" });
    expect(whySection(row("1", { attachment_metadata: [{ ...PDF, mime: "text/calendar" }] })).evidence).toEqual({ kind: "calendar", hit: "attachment" });
    // Several at once: the message's own type, then its Content-Class, then a part (isCalendar's order).
    const all = { mime_type: "text/calendar", content_class: "urn:content-classes:calendarmessage", attachment_metadata: [ICS] };
    expect(whySection(row("1", all)).evidence).toEqual({ kind: "calendar", hit: "mime" });
    expect(whySection(row("1", { ...all, mime_type: "multipart/mixed" })).evidence).toEqual({ kind: "calendar", hit: "content_class" });
    expect(whySection(row("1", { ...all, mime_type: null, content_class: null })).evidence).toEqual({ kind: "calendar", hit: "attachment" });
  });

  it("Money: the registered sender, the issuer and the registry's word for the message, from the sender and subject alone", () => {
    expect(whySection(row("1", BILL))).toEqual({ key: "money", evidence: { kind: "money", issuer: "Con Edison", semantics: "invoice", sender: "noreply@billing.coned.com" } });
    expect(whySection(row("1", { from_address: "no_reply@email.apple.com", subject: "Your receipt from Apple." })).evidence).toMatchObject({ kind: "money", issuer: "Apple", semantics: "receipt" });
    expect(whySection(row("1", { from_address: "no.reply.alerts@chase.com", subject: "Your latest statement is now available" })).evidence).toMatchObject({ kind: "money", issuer: "Chase", semantics: "statement" });
    // The issuer is the one the registry read out of the subject when the subject names it (Stripe receipts name the merchant).
    expect(whySection(row("1", { from_address: "receipts+acct_1AbC@stripe.com", subject: "Your receipt from Example Hosting Ltd #1234-5678" })).evidence)
      .toEqual({ kind: "money", issuer: "Example Hosting Ltd", semantics: "receipt", sender: "receipts+acct_1AbC@stripe.com" });
  });

  it("Money is never claimed from a lookalike sender, a registered sender's marketing, a forward, an amount, an invoice word or a filename", () => {
    const notMoney: Array<Partial<InboxRow>> = [
      { from_address: "noreply@billing.coned.com.example.test", subject: "Your Con Edison Bill Is Due" },
      { from_address: "noreply@billing.coned.com", subject: "Save energy this summer with Con Edison" },
      { from_address: "dave@example.test", subject: "Fwd: Your Con Edison Bill Is Due" },
      { subject: "Invoice #42 for the meeting: $142.30 due Friday", attachment_metadata: [PDF] },
    ];
    for (const o of notMoney) expect(whySection(row("1", o)).evidence.kind, JSON.stringify(o)).toBe("other");
  });

  it("Mailing Lists: says which header is there, and a blank header is not one", () => {
    expect(whySection(row("1", { list_id: "<news.example.test>" })).evidence).toEqual({ kind: "list", listId: true, unsubscribe: false });
    expect(whySection(row("1", { list_unsubscribe: "<mailto:off@example.test>" })).evidence).toEqual({ kind: "list", listId: false, unsubscribe: true });
    expect(whySection(row("1", { list_id: "<l>", list_unsubscribe: "<u>" })).evidence).toEqual({ kind: "list", listId: true, unsubscribe: true });
    expect(whySection(row("1", { list_id: "   ", list_unsubscribe: "" })).evidence.kind).toBe("other");
  });

  it("no word in the subject or snippet, and no amount, ever changes the reason", () => {
    // Subject "Meeting about the invoice $40", snippet "Unsubscribe here": every word a naive classifier would take.
    const plain = whySection(row("1", { own_reply: null, list_id: null, list_unsubscribe: null, mime_type: null, content_class: null }));
    expect(plain).toEqual({ key: "other", evidence: { kind: "other", factsKept: true, moneyAmbiguous: false } });
    expect(whySection(row("2", { subject: "Calendar invite: lunch meeting", snippet: "Join the call", own_reply: null, list_id: null, list_unsubscribe: null, mime_type: null, content_class: null })))
      .toEqual(plain);
  });
});

describe("a person's move", () => {
  it("is the reason, and carries what the message's own facts would have given", () => {
    const r = row("1", { list_id: "<l>" });
    expect(whySection(r, { "1": "money" })).toEqual({
      key: "money",
      evidence: { kind: "moved", natural: { key: "lists", evidence: { kind: "list", listId: true, unsubscribe: false } } },
    });
    // Moved to the section it would be in anyway: still the person's move, and the natural answer says the same.
    const same = whySection(r, { "1": "lists" });
    expect(same.evidence).toMatchObject({ kind: "moved", natural: { key: "lists" } });
    expect(same.key).toBe("lists");
  });

  it("beats every rule, including Conversations, and the natural answer is computed with the move ignored", () => {
    const r = row("1", { own_reply: true, mime_type: "text/calendar", list_id: "<l>", ...BILL });
    const why = whySection(r, { "1": "other" });
    expect(why.key).toBe("other");
    expect(why.evidence).toMatchObject({ kind: "moved", natural: { key: "conversations", evidence: { kind: "conversation" } } });
    expect(sectionOf(r, { "1": "other" })).toBe("other");
  });

  it("another message's move, and a move naming a section that does not exist, change nothing", () => {
    const r = row("1", { list_id: "<l>" });
    expect(whySection(r, { "2": "money" })).toEqual(whySection(r));
    expect(whySection(r, { "1": "bogus" as SectionKey })).toEqual(whySection(r));
    expect(whySection(r, { "1": "bogus" as SectionKey }).evidence.kind).toBe("list");
  });
});

describe("the honest cases", () => {
  it("a row cached before the facts were kept says so: every fact undefined means facts not kept", () => {
    expect(whySection(row("1")).evidence).toEqual({ kind: "other", factsKept: false, moneyAmbiguous: false });
    // One fact present is enough to say the row went through the server's page after migration 0067.
    for (const kept of [{ own_reply: false }, { own_reply: null }, { list_id: null }, { list_unsubscribe: "" }, { mime_type: "text/plain" }, { content_class: null }] as Array<Partial<InboxRow>>)
      expect(whySection(row("1", kept)).evidence, JSON.stringify(kept)).toEqual({ kind: "other", factsKept: true, moneyAmbiguous: false });
  });

  it("a moved row whose own facts are not kept carries that in what it would have been", () => {
    expect(whySection(row("1"), { "1": "money" }).evidence).toEqual({ kind: "moved", natural: { key: "other", evidence: { kind: "other", factsKept: false, moneyAmbiguous: false } } });
  });

  it("two Money templates at once is Other, and says so rather than guessing between them", () => {
    const why = whySection(row("1", { subject: AMBIGUOUS_SUBJECT, own_reply: null, list_id: null, list_unsubscribe: null, mime_type: null, content_class: null }));
    expect(why).toEqual({ key: "other", evidence: { kind: "other", factsKept: true, moneyAmbiguous: true } });
    // A list header outranks the leftover: the row is a Mailing List, and nothing about Money is said.
    expect(whySection(row("1", { subject: AMBIGUOUS_SUBJECT, list_id: "<l>" })).evidence).toEqual({ kind: "list", listId: true, unsubscribe: false });
  });
});
