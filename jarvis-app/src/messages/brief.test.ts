// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { parseBrief, briefFor, saveBrief, loadBriefs, briefPrompt, BRIEF_SYSTEM } from "./brief";

describe("thread brief", () => {
  beforeEach(() => localStorage.clear());

  it("takes summary and replies from one answer", () => {
    const b = parseBrief('{"summary":"Matt wants a status update.","replies":["On it","Not yet","Closing it out"]}');
    expect(b).toEqual({ summary: "Matt wants a status update.", replies: ["On it", "Not yet", "Closing it out"] });
  });

  it("keeps the half that is usable when the other half is junk", () => {
    expect(parseBrief('{"summary":"He wants an update.","replies":"nope"}')).toEqual({ summary: "He wants an update.", replies: [] });
    expect(parseBrief('{"replies":["Yes","No","Later"]}')).toEqual({ summary: "", replies: ["Yes", "No", "Later"] });
  });

  it("returns nothing rather than inventing", () => {
    expect(parseBrief("I am not JSON")).toBeNull();
    expect(parseBrief('{"summary":"","replies":[]}')).toBeNull();
  });

  it("caps replies at three and drops empties", () => {
    const b = parseBrief('{"summary":"s","replies":["a","","b","c","d"]}');
    expect(b?.replies).toEqual(["a", "b", "c"]);
  });

  it("caches against the latest message, so a new reply invalidates it", () => {
    saveBrief("m2", { summary: "s", replies: ["a"] });
    expect(briefFor("m2")?.summary).toBe("s");
    expect(briefFor("m3")).toBeNull(); // someone wrote again: stale by construction
  });

  it("survives a corrupt cache", () => {
    localStorage.setItem("jarvis.mail.brief.v1", "[not an object");
    expect(loadBriefs()).toEqual({});
    expect(briefFor("m1")).toBeNull();
  });

  it("asks for both halves in one request", () => {
    const p = briefPrompt("Matt: any update?");
    expect(p).toContain("summary");
    expect(p).toContain("replies");
    expect(BRIEF_SYSTEM).toContain("JSON");
  });
});

// UP-MIND-19 (2026-09-05): where the thread stands, above the messages.
// Anything the pass could not establish is ABSENT: a card that hedges is a
// card you have to check, which is the trip it exists to save.
describe("the thread state card", () => {
  it("reads a whole state when the model gives one", () => {
    const b = parseBrief(JSON.stringify({
      summary: "Wants the roster", replies: ["Ok"],
      state: "waiting_on_you",
      agreed: ["Friday delivery", "Two coaches"],
      unresolved: ["Who pays the field fee"],
      deadline: "Friday",
      next: "Send the roster",
      decision: "We're going with Ridgeline for the fields.",
    }))!;
    expect(b.state).toBe("waiting_on_you");
    expect(b.agreed).toEqual(["Friday delivery", "Two coaches"]);
    expect(b.unresolved).toEqual(["Who pays the field fee"]);
    expect(b.deadline).toBe("Friday");
    expect(b.next).toBe("Send the roster");
    expect(b.decision).toBe("We're going with Ridgeline for the fields.");
  });

  it("leaves out everything it was not given, rather than filling it", () => {
    const b = parseBrief(JSON.stringify({ summary: "Wants the roster", replies: ["Ok"] }))!;
    expect(b.state).toBeUndefined();
    expect(b.agreed).toBeUndefined();
    expect(b.decision).toBeUndefined();
  });

  it("drops a state outside its own vocabulary", () => {
    const b = parseBrief(JSON.stringify({ summary: "s", replies: [], state: "on_fire" }))!;
    expect(b.state).toBeUndefined();
  });

  it("drops empty lists and caps the ones it keeps", () => {
    const b = parseBrief(JSON.stringify({
      summary: "s", replies: [], agreed: ["", "  "], unresolved: ["a", "b", "c", "d"],
    }))!;
    expect(b.agreed).toBeUndefined();
    expect(b.unresolved).toHaveLength(3);
  });

  it("still reads a brief with none of it, which is every cached one", () => {
    const b = parseBrief('{"summary":"Wants the roster","replies":["Ok","No"]}')!;
    expect(b.summary).toBe("Wants the roster");
    expect(b.replies).toHaveLength(2);
  });
});

// THE CONFIRMED MEETING (Dave 2026-09-16: "this should be EXTREMELY easy to
// add to the Jarvis calendar"). This one writes to a calendar, so the parser
// is strict: anything it cannot fully resolve is dropped whole rather than
// offered with a guessed date.
import { parseMeeting } from "./brief";
describe("parseMeeting", () => {
  const good = { title: "GM interview", date: "2026-09-21", start: "15:00", durationMin: 45 };

  it("takes a fully resolved time and computes its end", () => {
    expect(parseMeeting(good)).toEqual({ title: "GM interview", date: "2026-09-21", start: "15:00", end: "15:45" });
    // An unstated duration is an hour, which is the prompt's own default.
    expect(parseMeeting({ ...good, durationMin: undefined })?.end).toBe("16:00");
  });

  it("drops anything it cannot fully resolve, rather than guessing", () => {
    for (const bad of [
      null, undefined, "Monday at 3", [],
      { ...good, title: "" },
      { ...good, date: "Monday" },
      { ...good, date: "2026-9-21" },
      { ...good, start: "3pm" },
      { ...good, start: "25:00" },
      { ...good, date: undefined },
      { ...good, start: undefined },
    ]) {
      expect(parseMeeting(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("refuses a well-shaped string that is not a real day", () => {
    expect(parseMeeting({ ...good, date: "2026-02-31" })).toBeNull();
    expect(parseMeeting({ ...good, date: "2026-13-01" })).toBeNull();
  });

  it("clamps a runaway duration and never runs past midnight", () => {
    expect(parseMeeting({ ...good, durationMin: 99999 })?.end).toBe("23:59");
    expect(parseMeeting({ ...good, start: "23:30", durationMin: 120 })?.end).toBe("23:59");
    // A duration below the floor is raised rather than producing a zero-length event.
    expect(parseMeeting({ ...good, durationMin: 1 })?.end).toBe("15:15");
  });

  it("a brief with a malformed meeting still carries everything else", () => {
    const b = parseBrief(JSON.stringify({
      summary: "Interview confirmed", replies: ["Thanks"],
      state: "scheduled", agreed: ["Interview set for Monday at 3pm"],
      meeting: { title: "GM interview", date: "next Monday", start: "15:00" },
    }));
    expect(b?.summary).toBe("Interview confirmed");
    expect(b?.agreed).toEqual(["Interview set for Monday at 3pm"]);
    expect(b?.meeting, "an unresolvable date is not a calendar entry").toBeUndefined();
  });

  it("a brief with a good meeting carries it through", () => {
    const b = parseBrief(JSON.stringify({
      summary: "Interview confirmed", replies: [],
      meeting: good,
    }));
    expect(b?.meeting).toEqual({ title: "GM interview", date: "2026-09-21", start: "15:00", end: "15:45" });
  });

  it("the prompt asks only for a settled time, and says today so a weekday resolves", () => {
    const p = briefPrompt("AJ: Monday at 3pm works", "2026-09-16");
    expect(p).toContain("Today is 2026-09-16");
    expect(p).toMatch(/BOTH sides have settled on/);
    expect(p).toMatch(/Leave it out entirely if the time is only PROPOSED/);
  });
});

// ---------------------------------------------------------------------------
// THE MEETING THAT NEVER APPEARED EAST OF GREENWICH (2026-09-18).
//
// parseMeeting validated the day by parsing it at LOCAL midnight and
// comparing against toISOString(), which is UTC. Anywhere with a positive
// offset, local midnight is the PREVIOUS day in UTC, the round trip fails,
// and every confirmed meeting was dropped -- no card, no Add to Calendar, no
// error. Measured before the fix: America/New_York round-trips "2026-09-22"
// to itself; Europe/Berlin and Asia/Tokyo both return "2026-09-21".
//
// The check has no zone in it now. It still has to reject a well-shaped
// string that is not a day, which is the reason it existed.
describe("a confirmed meeting survives the reader's timezone", () => {
  const withTZ = (tz: string, run: () => void) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try { run(); } finally { process.env.TZ = prev; }
  };
  const meeting = (date: string) => parseMeeting({ title: "Interview", date, start: "15:00", durationMin: 30 });

  it("accepts a real day whatever the offset", () => {
    for (const tz of ["America/New_York", "UTC", "Europe/Berlin", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      withTZ(tz, () => {
        const m = meeting("2026-09-22");
        expect(m, tz + " dropped a real meeting").not.toBeNull();
        expect(m!.date, tz + " moved the day").toBe("2026-09-22");
        expect(m!.start).toBe("15:00");
        expect(m!.end).toBe("15:30");
      });
    }
  });

  it("still rejects a well-shaped string that is not a day", () => {
    for (const tz of ["America/New_York", "Asia/Tokyo"]) {
      withTZ(tz, () => {
        expect(meeting("2026-02-31"), "Feb 31 is not a date").toBeNull();
        expect(meeting("2026-13-01"), "there is no month 13").toBeNull();
      });
    }
  });
});
