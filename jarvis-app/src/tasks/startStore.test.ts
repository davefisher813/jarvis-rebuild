import { describe, it, expect } from "vitest";
import {
  START_KEY, loadSessions, loadSession, saveSession, clearSession,
  sessionHasWork, newestSession, suggestStopPoint,
} from "./startStore";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    raw: m,
  };
}

describe("startStore: one workspace per thing, forever", () => {
  it("repeated Start reuses the one seat instead of stacking drafts", () => {
    const s = mem();
    saveSession("t1", { kind: "prepare_draft", draft: "first" }, 1, s);
    saveSession("t1", { kind: "prepare_draft", draft: "second" }, 2, s);
    saveSession("t1", { kind: "prepare_draft", draft: "third" }, 3, s);
    expect(Object.keys(loadSessions(s))).toEqual(["t1"]);
    expect(loadSession("t1", s)?.draft).toBe("third");
  });

  it("a workspace opened and left empty takes no seat at all", () => {
    const s = mem();
    saveSession("t1", { kind: "prepare_draft", draft: "" }, 1, s);
    expect(loadSession("t1", s)).toBeNull();
    // And words that arrive later do take one.
    saveSession("t1", { kind: "prepare_draft", draft: "now there are words" }, 2, s);
    expect(loadSession("t1", s)).not.toBeNull();
    // And emptying it again gives the seat back, so no stale Resume survives.
    saveSession("t1", { kind: "prepare_draft", draft: "  \n " }, 3, s);
    expect(loadSession("t1", s)).toBeNull();
  });

  it("survives a reload, and shrugs off junk", () => {
    const s = mem();
    saveSession("t1", { kind: "capture_next_action", draft: "a", stopPoint: "b" }, 7, s);
    // A fresh read of the same storage is what a reload is.
    expect(loadSession("t1", s)).toEqual({ entityId: "t1", kind: "capture_next_action", draft: "a", stopPoint: "b", savedAt: 7 });
    s.setItem(START_KEY, JSON.stringify({ bad: { kind: "nonsense", savedAt: 1 }, ok: { kind: "resume", savedAt: 2 } }));
    expect(Object.keys(loadSessions(s))).toEqual(["ok"]);
    s.setItem(START_KEY, "{not json");
    expect(loadSessions(s)).toEqual({});
  });

  it("clearing one seat leaves the others", () => {
    const s = mem();
    saveSession("t1", { kind: "prepare_draft", draft: "one" }, 1, s);
    saveSession("t2", { kind: "prepare_draft", draft: "two" }, 2, s);
    clearSession("t1", s);
    expect(Object.keys(loadSessions(s))).toEqual(["t2"]);
    clearSession("nothing-here", s);
    expect(Object.keys(loadSessions(s))).toEqual(["t2"]);
  });

  it("sessionHasWork and newestSession agree on what is worth resuming", () => {
    expect(sessionHasWork({ draft: "", stopPoint: "" })).toBe(false);
    expect(sessionHasWork({ stopPoint: "here" })).toBe(true);
    expect(newestSession({})).toBeNull();
    const all = {
      a: { entityId: "a", kind: "prepare_draft" as const, draft: "old", savedAt: 1 },
      b: { entityId: "b", kind: "prepare_draft" as const, draft: "new", savedAt: 9 },
      c: { entityId: "c", kind: "prepare_draft" as const, draft: " ", savedAt: 99 },
    };
    expect(newestSession(all)?.entityId).toBe("b");
  });

  it("the stopping point is suggested from the real last line, never demanded", () => {
    expect(suggestStopPoint("Hi everyone,\n\nPractice is Saturday at 2 PM.")).toBe("Practice is Saturday at 2 PM.");
    expect(suggestStopPoint("")).toBe("");
    expect(suggestStopPoint("x".repeat(80), 20)).toBe("x".repeat(19) + "…");
  });
});
