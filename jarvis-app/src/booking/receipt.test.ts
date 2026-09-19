import { describe, it, expect } from "vitest";
import { escapeIcsText, foldIcsLine, icsStamp, buildIcs, safeZone, receiptWords, buildReceipt } from "./receipt";

const START = Date.parse("2026-09-22T18:00:00.000Z"); // 2pm New York, 11am Los Angeles
const END = Date.parse("2026-09-22T18:30:00.000Z");

const input = {
  typeName: "Meeting",
  startMs: START,
  endMs: END,
  guestName: "Ada Lovelace",
  guestZone: "America/Los_Angeles",
  hostZone: "America/New_York",
  hostEmail: "dave@example.com",
  guestEmail: "ada@example.com",
  bookingId: "b-1",
  stampMs: Date.parse("2026-09-19T12:00:00.000Z"),
};

describe("escapeIcsText", () => {
  it("escapes the characters that would end a property early", () => {
    expect(escapeIcsText("Coffee, tea; or milk\\cream")).toBe("Coffee\\, tea\\; or milk\\\\cream");
  });
  it("turns real newlines into the calendar's own escape", () => {
    expect(escapeIcsText("one\r\ntwo\nthree")).toBe("one\\ntwo\\nthree");
  });
});

describe("foldIcsLine", () => {
  it("leaves a short line exactly as it is", () => {
    expect(foldIcsLine("SUMMARY:Coffee")).toBe("SUMMARY:Coffee");
  });
  it("folds a long line, and every piece fits in 75 octets", () => {
    const folded = foldIcsLine("DESCRIPTION:" + "x".repeat(300));
    for (const piece of folded.split("\r\n")) {
      expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(75);
    }
  });
  it("continuations begin with a space, which is what makes them continuations", () => {
    const pieces = foldIcsLine("DESCRIPTION:" + "y".repeat(200)).split("\r\n");
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces.slice(1)) expect(p.startsWith(" ")).toBe(true);
  });
  it("rejoining the pieces gives back the original text", () => {
    const line = "SUMMARY:" + "z".repeat(240);
    const back = foldIcsLine(line).split("\r\n").map((p, n) => (n === 0 ? p : p.slice(1))).join("");
    expect(back).toBe(line);
  });
  it("never splits a multi-byte character down the middle", () => {
    // Every character here is 3 octets, so a fold measured in characters
    // lands inside one and the line arrives as mojibake.
    const folded = foldIcsLine("SUMMARY:" + "日".repeat(60));
    expect(folded).not.toContain("�");
    const back = folded.split("\r\n").map((p, n) => (n === 0 ? p : p.slice(1))).join("");
    expect(back).toBe("SUMMARY:" + "日".repeat(60));
  });
});

describe("icsStamp", () => {
  it("is a UTC instant with no punctuation and no milliseconds", () => {
    expect(icsStamp(START)).toBe("20260922T180000Z");
  });
});

describe("buildIcs", () => {
  const ics = buildIcs({
    uid: "u-1", startMs: START, endMs: END, summary: "Meeting with Ada",
    hostEmail: "dave@example.com", guestEmail: "ada@example.com", guestName: "Ada Lovelace",
    stampMs: input.stampMs,
  });

  it("is a complete calendar, opened and closed", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });
  it("uses CRLF throughout, because a bare newline is not a calendar", () => {
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });
  it("carries the times the booking was made for", () => {
    expect(ics).toContain("DTSTART:20260922T180000Z");
    expect(ics).toContain("DTEND:20260922T183000Z");
  });
  it("publishes rather than requesting, so no client offers an RSVP nobody reads", () => {
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).not.toContain("METHOD:REQUEST");
  });
  it("names both people, so the event is not anonymous in a calendar", () => {
    expect(ics).toContain("mailto:dave@example.com");
    expect(ics).toContain("mailto:ada@example.com");
  });
});

describe("safeZone", () => {
  it("accepts a real zone", () => {
    expect(safeZone("Europe/Dublin", "UTC")).toBe("Europe/Dublin");
  });
  it("falls back rather than throwing on anything a stranger's browser sends", () => {
    expect(safeZone("Mars/Olympus", "America/New_York")).toBe("America/New_York");
    expect(safeZone("", "UTC")).toBe("UTC");
    expect(safeZone(undefined, "UTC")).toBe("UTC");
  });
});

describe("receiptWords", () => {
  it("states the time in the visitor's zone, not the host's", () => {
    const { body } = receiptWords(input);
    expect(body).toContain("11:00 AM to 11:30 AM");
    expect(body).toContain("America/Los_Angeles");
  });
  it("states the host's clock once as well, when the two differ", () => {
    const { body } = receiptWords(input);
    expect(body).toContain("2:00 PM in America/New_York");
  });
  it("says it once when both people are on the same clock", () => {
    const { body } = receiptWords({ ...input, guestZone: "America/New_York" });
    expect(body).toContain("2:00 PM to 2:30 PM");
    expect(body.match(/America\/New_York/g)).toHaveLength(1);
  });
  it("puts the day and the time in the subject, so an inbox shows the booking", () => {
    const { subject } = receiptWords(input);
    expect(subject).toBe("Confirmed: Meeting, Tuesday, September 22 at 11:00 AM");
  });
  it("names the address a reply reaches, because a reply is how a meeting moves", () => {
    expect(receiptWords(input).body).toContain("dave@example.com");
  });
});

describe("buildReceipt", () => {
  const r = buildReceipt(input);

  it("is addressed to the visitor and to nobody else", () => {
    expect(r.to).toBe("ada@example.com");
  });
  it("attaches a calendar file a client will offer to add", () => {
    expect(r.attachment.filename).toBe("invite.ics");
    expect(r.attachment.mimeType).toContain("text/calendar");
    expect(r.attachment.content).toContain("BEGIN:VEVENT");
  });
  it("gives the event a stable id, so sending it twice does not make two events", () => {
    expect(r.attachment.content).toContain("UID:b-1@jarvis.booking");
    expect(buildReceipt(input).attachment.content).toBe(r.attachment.content);
  });
  it("carries no unescaped line break into the calendar's description", () => {
    const desc = /DESCRIPTION:[\s\S]*?\r\n(?![ ])/.exec(r.attachment.content)![0];
    expect(desc).toContain("\\n");
  });
});
