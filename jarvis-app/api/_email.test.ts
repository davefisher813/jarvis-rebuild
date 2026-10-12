// THE EMAIL ROUTES' SHARED HALF, THE PURE PARTS (docs/jarvis-unified, slice
// 05). Headers read without a DOM, addresses with the bidi marks taken out
// (13: neutralise bidi spoofing in address display), snippets with Gmail's
// entities decoded, attachment metadata and never bytes, Gmail's refusals
// as the vocabulary's codes, and the one order every list keeps.
import { afterEach, describe, it, expect, vi } from "vitest";
import { addressList, attachmentsOf, calendarProbeAttachments, decodeEntities, fail, fetchMetas, firstAddress, gmailFail, headerOf, isGoogleCalendarMessageId, newestFirst, PARTS_FIELDS, toCachedRow } from "./_email";
import { isCalendar } from "../src/email/sections";

describe("addresses", () => {
  it("splits a header into parts, lowercases the address and keeps the name", () => {
    expect(addressList('Con Edison <Billing@ConEdison.test>, "Miller, Coach" <coach@example.test>, plain@x.test')).toEqual([
      { name: "Con Edison", address: "billing@conedison.test" },
      { name: "Miller, Coach", address: "coach@example.test" },
      { name: "", address: "plain@x.test" },
    ]);
  });
  it("removes bidi override marks so a spoofed name cannot reverse on screen", () => {
    const [a] = addressList("‮tset.elgoog@evad‬ <dave@example.test>");
    expect(a!.name).toBe("tset.elgoog@evad");
    expect(a!.name).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(a!.address).toBe("dave@example.test");
  });
  it("an empty header is nobody", () => {
    expect(addressList("")).toEqual([]);
    expect(firstAddress("")).toEqual({ address: "", name: "" });
  });
});

describe("headers and snippets", () => {
  it("reads a header by name, case blind", () => {
    expect(headerOf([{ name: "subject", value: "Hello" }], "Subject")).toBe("Hello");
    expect(headerOf(undefined, "Subject")).toBe("");
  });
  it("decodes the entities Gmail puts in snippets", () => {
    expect(decodeEntities("Tom &amp; Jerry &#39;quoted&#39; &lt;b&gt; &#x41;&nbsp;x")).toBe("Tom & Jerry 'quoted' <b> A x");
  });
});

describe("attachments", () => {
  it("collects nested parts as metadata only, with control characters out of the name", () => {
    const part = { mimeType: "multipart/mixed", parts: [
      { mimeType: "text/plain", body: { data: "aGk" } },
      { mimeType: "application/pdf", filename: "bill\u0000.pdf", body: { attachmentId: "att1", size: 12345 } },
      { mimeType: "multipart/alternative", parts: [{ mimeType: "image/png", filename: "a.png", body: { attachmentId: "att2", size: 10 } }] },
    ] };
    expect(attachmentsOf(part)).toEqual([
      { filename: "bill.pdf", mime: "application/pdf", attachmentId: "att1", size: 12345 },
      { filename: "a.png", mime: "image/png", attachmentId: "att2", size: 10 },
    ]);
  });
});

describe("a cached row", () => {
  it("takes the provider's facts: time from internalDate, labels, thread, the headers", () => {
    const row = toCachedRow({
      id: "m1", threadId: "t1", historyId: "h9", internalDate: "1790000000000", snippet: "Amount &amp; due", labelIds: ["INBOX", "UNREAD"],
      payload: { headers: [{ name: "From", value: "Con Edison <billing@conedison.test>" }, { name: "To", value: "dave@example.test" }, { name: "Subject", value: "Your bill" }] },
    });
    expect(row).toMatchObject({ provider_id: "m1", thread_id: "t1", history_id: "h9", internal_date: new Date(1790000000000).toISOString(), from_address: "billing@conedison.test", from_name: "Con Edison", subject: "Your bill", snippet: "Amount & due", labels: ["INBOX", "UNREAD"], attachments: [] });
    expect(row.to_addresses).toEqual([{ name: "", address: "dave@example.test" }]);
  });
  it("keeps the mail home's facts as sent (migration 0067): Message-ID, List-Id, List-Unsubscribe, the MIME type, Content-Class", () => {
    const row = toCachedRow({
      id: "m3", threadId: "t3", internalDate: "1790000000000",
      payload: { mimeType: "Text/Calendar", headers: [
        { name: "From", value: "list@news.test" }, { name: "Message-Id", value: " <abc@mail.test> " }, { name: "List-ID", value: "<news.list.test>" },
        { name: "List-Unsubscribe", value: "<mailto:off@news.test>" }, { name: "Content-Class", value: "urn:content-classes:CalendarMessage" },
      ] },
    } as Parameters<typeof toCachedRow>[0]);
    expect(row).toMatchObject({ rfc_message_id: "<abc@mail.test>", list_id: "<news.list.test>", list_unsubscribe: "<mailto:off@news.test>", mime_type: "text/calendar", content_class: "urn:content-classes:calendarmessage" });
    // Absent headers are null, never an empty string the resolver could mistake for a fact.
    expect(toCachedRow({ id: "m4" })).toMatchObject({ rfc_message_id: null, list_id: null, list_unsubscribe: null, mime_type: null, content_class: null });
  });
  it("falls back to the message id for the thread and to now for a missing time", () => {
    const before = Date.now();
    const row = toCachedRow({ id: "m2" });
    expect(row.thread_id).toBe("m2");
    expect(Date.parse(row.internal_date)).toBeGreaterThanOrEqual(before);
  });
});

describe("the vocabulary", () => {
  it("maps Gmail's statuses to codes and statuses", () => {
    expect(gmailFail({ ok: false, status: 401, body: null }).code).toBe("PROVIDER_AUTH");
    expect(gmailFail({ ok: false, status: 403, body: null }).code).toBe("PROVIDER_AUTH");
    expect(gmailFail({ ok: false, status: 404, body: null }).code).toBe("NOT_FOUND");
    expect(gmailFail({ ok: false, status: 500, body: null }).code).toBe("UNAVAILABLE");
    const limited = gmailFail({ ok: false, status: 429, body: null, retryAfter: 7 });
    expect(limited).toMatchObject({ code: "RATE_LIMITED", status: 429, retry_after: 7, retryable: true });
  });
  it("every code has one safe line and no line names a token or a message", () => {
    for (const code of ["AUTH_REQUIRED", "PROVIDER_AUTH", "RATE_LIMITED", "UNAVAILABLE", "NOT_FOUND", "INVALID_PAYLOAD", "STORAGE_LIMIT"] as const) {
      const f = fail(code);
      expect(f.safe_message.length).toBeGreaterThan(0);
      expect(f.safe_message).not.toMatch(/token|bearer|ya29/i);
    }
    expect(fail("PROVIDER_AUTH").status).toBe(410);
    expect(fail("STORAGE_LIMIT").status).toBe(413);
  });
});

describe("the one order", () => {
  it("is newest first, then id descending, so equal timestamps never swap", () => {
    const rows = [
      { internal_date: "2026-10-03T10:00:00.000Z", provider_id: "a" },
      { internal_date: "2026-10-03T10:00:00.000Z", provider_id: "c" },
      { internal_date: "2026-10-03T11:00:00.000Z", provider_id: "b" },
    ];
    expect([...rows].sort(newestFirst).map((r) => r.provider_id)).toEqual(["b", "c", "a"]);
  });
});

describe("the calendar probe (spec 3.2 rule 3: a Google invite is Schedule on arrival, by its parts)", () => {
  const INVITE_ID = "<calendar-0a1b2c3d-1111-4222-8333-444455556666@google.com>";
  const meta = (id: string, messageId: string) => ({ id, threadId: "t-" + id, internalDate: "1790000000000", payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: "Pat Example <pat@example.test>" }, { name: "Subject", value: "Invitation: Team sync" }, { name: "Message-ID", value: messageId }] } });
  const inviteParts = { payload: { mimeType: "multipart/mixed", filename: "", body: { size: 0 }, parts: [
    { mimeType: "multipart/alternative", filename: "", body: { size: 0 }, parts: [
      { mimeType: "text/plain", filename: "", body: { size: 120 } },
      { mimeType: "text/html", filename: "", body: { size: 900 } },
      { mimeType: "text/calendar; method=REQUEST", filename: "invite.ics", body: { attachmentId: "cal-1", size: 1500 } },
    ] },
    { mimeType: "application/ics", filename: "invite.ics", body: { attachmentId: "ics-1", size: 1500 } },
  ] } };

  function stub(answers: Record<string, unknown>) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const key = Object.keys(answers).find((k) => url.includes(k));
      const body = key ? answers[key] : null;
      return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { "content-type": "application/json" } });
    }));
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("recognises only Google Calendar's own Message-ID shape", () => {
    expect(isGoogleCalendarMessageId(INVITE_ID)).toBe(true);
    expect(isGoogleCalendarMessageId("calendar-0a1b2c3d-1111-4222-8333-444455556666@google.com")).toBe(true);
    expect(isGoogleCalendarMessageId("<calendar-0a1b2c3d-1111-4222-8333-444455556666@google.com.example.test>")).toBe(false);
    expect(isGoogleCalendarMessageId("<CAH+abc@mail.gmail.com>")).toBe(false);
    expect(isGoogleCalendarMessageId("<calendar-notes@example.test>")).toBe(false);
    expect(isGoogleCalendarMessageId(null)).toBe(false);
  });

  it("asks Gmail for the part tree's types, names, ids and sizes only, never body data", () => {
    const f = decodeURIComponent(PARTS_FIELDS);
    expect(f).toMatch(/^format=full&fields=payload\(/);
    expect(f).not.toMatch(/\bdata\b/);
    expect(f).not.toMatch(/headers|snippet|raw/);
  });

  it("an invite: one extra parts-only read, and its calendar parts land in the cached row, so the resolver says Schedule", async () => {
    const calls = stub({ "/messages/inv1?format=metadata": meta("inv1", INVITE_ID), "/messages/inv1?format=full": inviteParts });
    const { rows } = await fetchMetas("tok", ["inv1"]);
    expect(calls.length).toBe(2);
    expect(rows[0]!.attachments.map((a) => a.mime)).toEqual(["text/calendar; method=REQUEST", "application/ics"]);
    expect(isCalendar({ attachment_metadata: rows[0]!.attachments, mime_type: rows[0]!.mime_type, content_class: null, list_id: null, list_unsubscribe: null, own_reply: null })).toBe(true);
  });

  it("normal mail costs no extra read, and a subject saying Invitation proves nothing", async () => {
    const calls = stub({ "/messages/m1?format=metadata": meta("m1", "<CAH+abc@mail.gmail.com>") });
    const { rows } = await fetchMetas("tok", ["m1"]);
    expect(calls.length).toBe(1);
    expect(rows[0]!.attachments).toEqual([]);
  });

  it("a Google Message-ID without a calendar part (or a failed probe) leaves the row as metadata gave it", async () => {
    const calls = stub({ "/messages/x1?format=metadata": meta("x1", INVITE_ID), "/messages/x1?format=full": { payload: { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", filename: "", body: { size: 3 } }, { mimeType: "application/pdf", filename: "notes.pdf", body: { attachmentId: "p", size: 9 } }] } } });
    const { rows } = await fetchMetas("tok", ["x1"]);
    expect(calls.length).toBe(2);
    expect(rows[0]!.attachments).toEqual([]);
    stub({ "/messages/x2?format=metadata": meta("x2", INVITE_ID) });
    const second = await fetchMetas("tok", ["x2"]);
    expect(second.rows[0]!.attachments).toEqual([]);
    expect(second.failed).toBeNull();
  });

  it("keeps the whole attachment list when a calendar part is there, the same list opening stores", () => {
    const tree = { mimeType: "multipart/mixed", parts: [{ mimeType: "application/pdf", filename: "agenda.pdf", body: { attachmentId: "p", size: 9 } }, { mimeType: "application/octet-stream", filename: "invite.ics", body: { attachmentId: "i", size: 9 } }] };
    expect(calendarProbeAttachments(tree as never).map((a) => a.filename)).toEqual(["agenda.pdf", "invite.ics"]);
    expect(calendarProbeAttachments({ mimeType: "multipart/mixed", parts: [{ mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "p", size: 9 } }] } as never)).toEqual([]);
  });
});
