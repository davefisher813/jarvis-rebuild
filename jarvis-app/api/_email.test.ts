// THE EMAIL ROUTES' SHARED HALF, THE PURE PARTS (docs/jarvis-unified, slice
// 05). Headers read without a DOM, addresses with the bidi marks taken out
// (13: neutralise bidi spoofing in address display), snippets with Gmail's
// entities decoded, attachment metadata and never bytes, Gmail's refusals
// as the vocabulary's codes, and the one order every list keeps.
import { describe, it, expect } from "vitest";
import { addressList, attachmentsOf, decodeEntities, fail, firstAddress, gmailFail, headerOf, newestFirst, toCachedRow } from "./_email";

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
