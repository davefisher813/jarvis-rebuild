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

import { mapInboxMessage, mapGmailFull, buildReply, encodeEmail } from "./map";

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
  it("real plain text stays plain and has no html", async () => {
    const { extractBody, extractHtml } = await import("./map");
    const payload = { mimeType: "text/plain", body: { data: b64("Just words. <3") } } as never;
    expect(extractBody(payload)).toBe("Just words. <3");
    expect(extractHtml(payload)).toBeNull();
  });
});
