// @vitest-environment jsdom
// WHY THIS SECTION? ON A SECTION HEADING (issue 112 remainder, 2026-10-13). Each of the five sections, Mailing Lists and Other
// included, answers with its purpose and the rule and facts that put its loaded messages there, read from whySection itself.
// Other with nothing kept, and a section with nothing loaded, say so plainly in one line instead of naming a rule that never ran.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import SectionWhySheet, { sectionWhyRows } from "./SectionWhySheet";
import { sectionSummary, SECTION_KEYS, type SectionKey } from "./sections";
import { SECTION_PURPOSE, WHY_CAL, WHY_FACTS_NOT_KEPT, WHY_LIST, WHY_MONEY_AMBIGUOUS, WHY_RULE, WHY_SECTION, WHY_SECTION_NONE } from "./copy";
import type { AttachmentMeta, InboxRow } from "./emailClient";

const AMBIGUOUS_SUBJECT = "Both Templates Fit This Subject";
vi.mock("./moneyRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("./moneyRegistry")>();
  const matchMoney: typeof real.matchMoney = (r, registry) =>
    r.subject === AMBIGUOUS_SUBJECT ? { kind: "ambiguous", template_ids: ["fake.one", "fake.two"] } : real.matchMoney(r, registry);
  return { ...real, matchMoney };
});

const row = (id: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id, account_id: "a1", account: "dave@example.test", provider_id: "p" + id, thread_id: "t" + id, internal_date: "2026-10-03T10:00:00Z", from_address: "x@example.test", from_name: "X",
  subject: "Meeting about the invoice $40", snippet: "Unsubscribe here", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h", read: true, own_reply: false, ...o,
});
const ICS: AttachmentMeta = { filename: "invite.ics", mime: "application/octet-stream", attachmentId: "a", size: 1 };
const BILL = { from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Due" } as const;

const ROWS: InboxRow[] = [
  row("c1", { own_reply: true }),
  row("c2", { own_reply: true, account: "work@example.test" }),
  row("s1", { mime_type: "text/calendar" }),
  row("s2", { attachment_metadata: [ICS] }),
  row("m1", { ...BILL }),
  row("l1", { list_id: "<news.studio.test>" }),
  row("l2", { list_id: "<news.studio.test>", list_unsubscribe: "<mailto:off@studio.test>" }),
  row("o1"),
  row("o2", { subject: AMBIGUOUS_SUBJECT }),
];
const text = (rows: ReturnType<typeof sectionWhyRows>) => rows.map(([label, facts]) => [label, facts.map((f) => f.text).join(" · ")]);

afterEach(cleanup);

describe("every section answers from its own rule and facts", () => {
  it("Conversations: the sent-message rule and the mailboxes", () => {
    const s = sectionSummary("conversations", ROWS);
    expect(text(sectionWhyRows(s))).toEqual([
      ["For", SECTION_PURPOSE.conversations],
      ["Here Because", `${WHY_RULE.conversation} · 2 Messages`],
      ["Mailboxes", "dave@example.test · work@example.test"],
    ]);
  });

  it("Schedule: the calendar rule and which calendar fact each message carried", () => {
    const s = sectionSummary("schedule", ROWS);
    expect(text(sectionWhyRows(s))).toEqual([
      ["For", SECTION_PURPOSE.schedule],
      ["Here Because", `${WHY_RULE.calendar} · 2 Messages`],
      ["Read From", `${WHY_CAL.mime} · 1 Message`],
      ["", `${WHY_CAL.attachment} · 1 Message`],
    ]);
  });

  it("Money: the template rule and the registered sender", () => {
    const s = sectionSummary("money", ROWS);
    expect(s.issuers).toHaveLength(1);
    const t = text(sectionWhyRows(s));
    expect(t[0]).toEqual(["For", SECTION_PURPOSE.money]);
    expect(t[1]).toEqual(["Here Because", `${WHY_RULE.money} · 1 Message`]);
    expect(t[2]![0]).toBe("Senders");
    expect(t[2]![1]!.length).toBeGreaterThan(0);
  });

  it("Mailing Lists: the list rule and the headers it read", () => {
    const s = sectionSummary("lists", ROWS);
    expect(text(sectionWhyRows(s))).toEqual([
      ["For", SECTION_PURPOSE.lists],
      ["Here Because", `${WHY_RULE.list} · 2 Messages`],
      ["Read From", `${WHY_LIST.id} · 2 Messages`],
      ["", `${WHY_LIST.unsubscribe} · 1 Message`],
    ]);
  });

  it("Other: no rule matched, and two Money templates fitting is named", () => {
    const s = sectionSummary("other", ROWS);
    expect(text(sectionWhyRows(s))).toEqual([
      ["For", SECTION_PURPOSE.other],
      ["Here Because", `${WHY_RULE.other} · 2 Messages`],
      ["Read From", `${WHY_MONEY_AMBIGUOUS} · 1 Message`],
    ]);
  });

  it("Other with no facts kept says so plainly, and so does a section with nothing loaded", () => {
    const old = [row("x1", { own_reply: undefined }), row("x2", { own_reply: undefined })];
    expect(text(sectionWhyRows(sectionSummary("other", old)))).toEqual([["For", SECTION_PURPOSE.other], ["Here Because", WHY_SECTION_NONE]]);
    const mixed = [...old, row("o1")];
    expect(text(sectionWhyRows(sectionSummary("other", mixed)))).toContainEqual(["Read From", `${WHY_FACTS_NOT_KEPT} · 2 Messages`]);
    for (const k of SECTION_KEYS) expect(text(sectionWhyRows(sectionSummary(k as SectionKey, [])))).toEqual([["For", SECTION_PURPOSE[k]], ["Here Because", WHY_SECTION_NONE]]);
  });

  it("a person's move is named as the reason", () => {
    const s = sectionSummary("lists", ROWS, { o1: "lists" });
    expect(text(sectionWhyRows(s))[1]).toEqual(["Here Because", `${WHY_RULE.moved} · 1 Message`]);
  });
});

describe("the sheet", () => {
  it("is a dialog named Why This Section?, headed by the section, and Done closes it", () => {
    const onClose = vi.fn();
    render(<SectionWhySheet summary={sectionSummary("lists", ROWS)} onClose={onClose} />);
    const d = screen.getByRole("dialog", { name: WHY_SECTION });
    expect(d).toHaveTextContent("In Mailing Lists");
    expect(d).toHaveTextContent(SECTION_PURPOSE.lists);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
