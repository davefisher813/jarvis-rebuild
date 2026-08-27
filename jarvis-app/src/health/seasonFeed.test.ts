import { describe, it, expect } from "vitest";
import { parseSeasonExtract } from "./seasonFeed";

describe("parseSeasonExtract", () => {
  it("parses a clean JSON reply into a draft", () => {
    const raw = JSON.stringify({
      org: "Travel Team",
      events: [{ title: "Practice", date: "2026-09-02", start: "17:30", end: "19:00" }],
    });
    const draft = parseSeasonExtract(raw);
    expect(draft?.org).toBe("Travel Team");
    expect(draft?.events).toHaveLength(1);
    expect(draft?.events[0]).toEqual({ title: "Practice", date: "2026-09-02", start: "17:30", end: "19:00" });
  });

  it("strips a code fence around the JSON", () => {
    const raw = "```json\n" + JSON.stringify({ org: "T", events: [{ title: "Game", date: "2026-09-03", start: "10:00" }] }) + "\n```";
    expect(parseSeasonExtract(raw)?.events).toHaveLength(1);
  });

  it("drops a row with an unreadable date or time rather than guessing", () => {
    const raw = JSON.stringify({
      org: "T",
      events: [
        { title: "Practice", date: "not-a-date", start: "17:30" },
        { title: "Game", date: "2026-09-03", start: "10:00" },
      ],
    });
    const draft = parseSeasonExtract(raw);
    expect(draft?.events).toHaveLength(1);
    expect(draft?.events[0]!.title).toBe("Game");
  });

  it("returns null for garbage input", () => {
    expect(parseSeasonExtract("not json at all")).toBeNull();
  });

  it("returns null when every row was dropped", () => {
    const raw = JSON.stringify({ org: "T", events: [{ title: "Bad", date: "bad", start: "bad" }] });
    expect(parseSeasonExtract(raw)).toBeNull();
  });

  it("never invents an event not present in the content (caps at MAX_EVENTS, does not pad)", () => {
    const events = Array.from({ length: 5 }, (_, i) => ({ title: "Practice " + i, date: "2026-09-0" + (i + 1), start: "17:00" }));
    const draft = parseSeasonExtract(JSON.stringify({ org: "T", events }));
    expect(draft?.events).toHaveLength(5);
  });
});
