import { describe, it, expect } from "vitest";
import { mapGoogleEvent, mapGmailMessage } from "./map";

describe("google mappers", () => {
  it("maps a timed event to its local wall-clock date/time", () => {
    const m = mapGoogleEvent({ id: "g1", summary: "Standup", location: "Room 4",
      start: { dateTime: "2026-06-01T09:30:00-07:00" }, end: { dateTime: "2026-06-01T10:00:00-07:00" } })!;
    expect(m).toEqual({ title: "Standup", date: "2026-06-01", start: "09:30", end: "10:00", location: "Room 4", gcalId: "g1" });
  });
  it("maps an all-day event to 00:00", () => {
    const m = mapGoogleEvent({ id: "g2", summary: "Holiday", start: { date: "2026-07-04" } })!;
    expect(m.date).toBe("2026-07-04");
    expect(m.start).toBe("00:00");
  });
  it("returns null without an id or a start", () => {
    expect(mapGoogleEvent({ id: "", start: { dateTime: "2026-06-01T09:30:00Z" } })).toBeNull();
    expect(mapGoogleEvent({ id: "g3" })).toBeNull();
  });
  it("falls back to (no title)", () => {
    expect(mapGoogleEvent({ id: "g4", start: { date: "2026-06-01" } })!.title).toBe("(no title)");
  });
  it("maps a gmail message and cleans the From name", () => {
    const r = mapGmailMessage({ id: "m1", snippet: "hi there",
      payload: { headers: [{ name: "From", value: "Sam Lee <sam@x.com>" }, { name: "Subject", value: "Lunch?" }] } });
    expect(r).toEqual({ id: "m1", from: "Sam Lee", subject: "Lunch?", snippet: "hi there" });
  });
  it("uses fallbacks for missing gmail headers", () => {
    const r = mapGmailMessage({ id: "m2" });
    expect(r.subject).toBe("(no subject)");
    expect(r.from).toBe("(unknown)");
  });
});

import { mapInboxMessage, mapGmailFull, buildReply, buildReplyAll, encodeEmail } from "./map";

describe("gmail read + send mappers", () => {
  it("flags unread and parses the timestamp", () => {
    const r = mapInboxMessage({ id: "m1", snippet: "hi", labelIds: ["INBOX", "UNREAD"], internalDate: "1700000000000",
      payload: { headers: [{ name: "From", value: "Sam <s@x.com>" }, { name: "Subject", value: "Hello" }] } });
    expect(r.unread).toBe(true);
    expect(r.from).toBe("Sam");
    expect(r.dateMs).toBe(1700000000000);
  });
  it("decodes a plain-text body and the sender address", () => {
    const full = mapGmailFull({ id: "m1", threadId: "t", payload: { mimeType: "text/plain",
      body: { data: btoa("Hey there") }, headers: [{ name: "From", value: "A <a@x.com>" }, { name: "Subject", value: "S" }] } });
    expect(full.body).toBe("Hey there");
    expect(full.fromEmail).toBe("a@x.com");
  });
  it("builds a threaded reply and encodes valid RFC822", () => {
    const full = mapGmailFull({ id: "m1", threadId: "t9", payload: { mimeType: "text/plain", body: { data: btoa("hi") },
      headers: [{ name: "From", value: "A <a@x.com>" }, { name: "Subject", value: "Plan" }, { name: "Message-ID", value: "<abc>" }] } });
    const r = buildReply(full, "ok");
    expect(r.to).toBe("a@x.com");
    expect(r.subject).toBe("Re: Plan");
    expect(r.threadId).toBe("t9");
    const raw = encodeEmail({ to: r.to, subject: r.subject, body: "ok", inReplyTo: r.inReplyTo });
    const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded).toContain("To: a@x.com");
    expect(decoded).toContain("Subject: Re: Plan");
    expect(decoded).toContain("In-Reply-To: <abc>");
  });

  it("parses Cc and Reply-To off a message", () => {
    const full = mapGmailFull({ id: "m1", threadId: "t", payload: { mimeType: "text/plain", body: { data: btoa("hi") },
      headers: [
        { name: "From", value: "A <a@x.com>" }, { name: "To", value: "Dave <d@x.com>, Bob <bob@x.com>" },
        { name: "Cc", value: "Cara <cara@x.com>" }, { name: "Reply-To", value: "support@x.com" },
        { name: "Subject", value: "S" },
      ] } });
    expect(full.cc).toBe("Cara <cara@x.com>");
    expect(full.replyTo).toBe("support@x.com");
  });

  it("leaves cc and replyTo empty when the headers are absent", () => {
    const full = mapGmailFull({ id: "m1", threadId: "t", payload: { mimeType: "text/plain", body: { data: btoa("hi") },
      headers: [{ name: "From", value: "A <a@x.com>" }] } });
    expect(full.cc).toBe("");
    expect(full.replyTo).toBe("");
  });
});

// S2-4 (2026-09-04): "Reply drops everyone except the last sender." A plain
// Reply is still correct for a one-on-one thread; Reply All is the one that
// has to actually keep everyone who was on it.
describe("buildReplyAll", () => {
  it("replies to the sender and ccs everyone else on the thread, minus the user", () => {
    const m = mapGmailFull({ id: "m1", threadId: "t9", payload: { mimeType: "text/plain", body: { data: btoa("hi") },
      headers: [
        { name: "From", value: "Ridgeley <ridgeley@x.com>" },
        { name: "To", value: "Dave <dave@x.com>, Bob <bob@x.com>" },
        { name: "Cc", value: "Cara <cara@x.com>" },
        { name: "Subject", value: "Waiver" }, { name: "Message-ID", value: "<abc>" },
      ] } });
    const r = buildReplyAll(m, "dave@x.com", "ok");
    expect(r.to).toBe("ridgeley@x.com");
    expect(r.cc).toBe("bob@x.com, cara@x.com");
  });

  it("prefers Reply-To over From when the sender named one", () => {
    const m = mapGmailFull({ id: "m1", threadId: "t9", payload: { mimeType: "text/plain", body: { data: btoa("hi") },
      headers: [
        { name: "From", value: "List Bot <bot@list.com>" }, { name: "Reply-To", value: "person@x.com" },
        { name: "To", value: "Dave <dave@x.com>" }, { name: "Subject", value: "S" }, { name: "Message-ID", value: "<x>" },
      ] } });
    expect(buildReplyAll(m, "dave@x.com", "ok").to).toBe("person@x.com");
  });

  it("never ccs the user their own address, case-insensitively", () => {
    const m = mapGmailFull({ id: "m1", threadId: "t9", payload: { mimeType: "text/plain", body: { data: btoa("hi") },
      headers: [
        { name: "From", value: "Ridgeley <ridgeley@x.com>" },
        { name: "To", value: "Dave@X.com, Ridgeley <ridgeley@x.com>" },
        { name: "Subject", value: "S" }, { name: "Message-ID", value: "<x>" },
      ] } });
    expect(buildReplyAll(m, "dave@x.com", "ok").cc).toBe("");
  });

  it("splits a display name's own comma correctly (\"Doe, Jane\" <jane@x.com>)", () => {
    const m = mapGmailFull({ id: "m1", threadId: "t9", payload: { mimeType: "text/plain", body: { data: btoa("hi") },
      headers: [
        { name: "From", value: "Ridgeley <ridgeley@x.com>" },
        { name: "To", value: '"Doe, Jane" <jane@x.com>, Dave <dave@x.com>' },
        { name: "Subject", value: "S" }, { name: "Message-ID", value: "<x>" },
      ] } });
    expect(buildReplyAll(m, "dave@x.com", "ok").cc).toBe("jane@x.com");
  });

  it("with no one else on the thread, cc is simply empty -- Reply All degrades to Reply", () => {
    const m = mapGmailFull({ id: "m1", threadId: "t9", payload: { mimeType: "text/plain", body: { data: btoa("hi") },
      headers: [
        { name: "From", value: "Ridgeley <ridgeley@x.com>" }, { name: "To", value: "Dave <dave@x.com>" },
        { name: "Subject", value: "S" }, { name: "Message-ID", value: "<x>" },
      ] } });
    expect(buildReplyAll(m, "dave@x.com", "ok").cc).toBe("");
  });
});

describe("encodeEmail with Cc", () => {
  it("adds a Cc header, between To and Subject, only when one is given", () => {
    const raw = encodeEmail({ to: "a@x.com", cc: "b@x.com, c@x.com", subject: "S", body: "hi" });
    const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded).toContain("Cc: b@x.com, c@x.com");
    expect(decoded.indexOf("To:")).toBeLessThan(decoded.indexOf("Cc:"));
    expect(decoded.indexOf("Cc:")).toBeLessThan(decoded.indexOf("Subject:"));
  });

  it("omits Cc entirely when there is none, blank, or whitespace-only", () => {
    for (const cc of [undefined, "", "   "]) {
      const raw = encodeEmail({ to: "a@x.com", cc, subject: "S", body: "hi" });
      const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
      expect(decoded).not.toContain("Cc:");
    }
  });
});

// HTML IS NEVER TEXT (2026-09-02, the TikTok mail that rendered as markup).
describe("extractBody and extractHtml on HTML mail", () => {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  it("a single-part text/html message reads as words, and keeps its markup for the reader", async () => {
    const { extractBody, extractHtml } = await import("./map");
    const html = "<html><head><meta charset=\"utf-8\"></head><body><p>Hola <b>Dave</b></p><img src=\"https://x/y.png\"></body></html>";
    const payload = { mimeType: "text/html", body: { data: b64(html) } } as never;
    expect(extractBody(payload)).toBe("Hola Dave");
    expect(extractHtml(payload)).toBe(html);
  });
  it("a plain part that is really markup is stripped too", async () => {
    const { extractBody, extractHtml } = await import("./map");
    const html = "<!DOCTYPE html><html><body><div>Suele pasar</div></body></html>";
    const payload = { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64(html) } }] } as never;
    expect(extractBody(payload)).toBe("Suele pasar");
    expect(extractHtml(payload)).toBe(html);
  });
  it("the stylesheet and the head are never words; block ends become lines", async () => {
    const { extractBody } = await import("./map");
    // The shape of the TikTok mail that rendered as CSS on 2026-09-02.
    const html = "<!DOCTYPE html><html><head><title>TikTok</title><style>@import 'x'; body, html { margin: 0 auto !important; } @media (max-width: 600px) { .pc { display: none; } }</style></head>"
      + "<body><!-- pre --><table><tr><td><h1>Watch reposted videos from your TikTok community</h1></td></tr><tr><td><a href=\"https://t\">Go to TikTok</a></td></tr></table>"
      + "<script>track()</script><p>anessajuleisy &middot; Reposted</p><p>Hi babyyyy&nbsp;JAJAJSJS suele pasar</p></body></html>";
    const payload = { mimeType: "text/html", body: { data: b64(html) } } as never;
    const body = extractBody(payload);
    expect(body).not.toMatch(/@import|margin|display|track\(|TikTok<|pre/);
    expect(body.split("\n")[0]).toBe("Watch reposted videos from your TikTok community");
    expect(body).toContain("Go to TikTok\n");
    expect(body).toContain("anessajuleisy \u00b7 Reposted\nHi babyyyy JAJAJSJS suele pasar");
  });
  it("real plain text stays plain and has no html", async () => {
    const { extractBody, extractHtml } = await import("./map");
    const payload = { mimeType: "text/plain", body: { data: b64("Just words. <3") } } as never;
    expect(extractBody(payload)).toBe("Just words. <3");
    expect(extractHtml(payload)).toBeNull();
  });
});
