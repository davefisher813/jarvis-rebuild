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
