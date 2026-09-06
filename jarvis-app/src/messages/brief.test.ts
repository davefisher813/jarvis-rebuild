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
