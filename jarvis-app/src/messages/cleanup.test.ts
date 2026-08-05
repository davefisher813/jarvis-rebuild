// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadMuted, mute, unmute, isMuted, dropMuted } from "./mute";
import { parseUnsub, unsubLabel, unsubLine } from "./unsubscribe";
import { saveRule, clearRule, loadRules } from "./rules";

describe("mute", () => {
  beforeEach(() => localStorage.clear());

  it("hides a thread from every surface without touching the mail", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const m = mute("b");
    expect(isMuted("b", m)).toBe(true);
    expect(dropMuted(rows, m).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("is reversible and never double-adds", () => {
    mute("a");
    mute("a");
    expect(loadMuted()).toEqual(["a"]);
    expect(unmute("a")).toEqual([]);
    expect(loadMuted()).toEqual([]);
  });

  it("costs nothing when nothing is muted", () => {
    const rows = [{ id: "a" }];
    expect(dropMuted(rows, [])).toBe(rows); // same reference, no work
  });
});

describe("unsubscribe", () => {
  it("prefers mailto, which is the unambiguous one", () => {
    const u = parseUnsub("<mailto:stop@x.com?subject=unsub%20me>, <https://x.com/u/1>");
    expect(u).toEqual({ kind: "mailto", target: "stop@x.com", subject: "unsub me", oneClick: false });
  });

  it("falls back to the web endpoint", () => {
    expect(parseUnsub("<https://x.com/u/1>")?.kind).toBe("http");
  });

  it("notices a genuine one-click sender", () => {
    const u = parseUnsub("<https://x.com/u/1>", "List-Unsubscribe=One-Click");
    expect(u?.oneClick).toBe(true);
  });

  it("returns nothing rather than guessing", () => {
    expect(parseUnsub("")).toBeNull();
    expect(parseUnsub("<tel:+15551234>")).toBeNull();
    expect(parseUnsub("<mailto:notanaddress>")).toBeNull();
  });

  it("never claims the sender actually stopped", () => {
    const line = unsubLine("Peloton").toLowerCase();
    expect(line).toContain("asked");
    for (const w of ["unsubscribed", "done", "removed", "you will no longer"]) {
      expect(line).not.toContain(w);
    }
    expect(unsubLabel("Peloton")).toBe("Unsubscribe from Peloton");
  });
});

describe("standing rules are undoable", () => {
  beforeEach(() => localStorage.clear());

  it("removes a filed sender and leaves the others alone", () => {
    saveRule("a@x.com", "noise");
    saveRule("b@x.com", "needs_you");
    expect(Object.keys(loadRules())).toHaveLength(2);
    const left = clearRule("A@X.com"); // case-insensitive, like saving
    expect(left["a@x.com"]).toBeUndefined();
    expect(left["b@x.com"]).toBe("needs_you");
    expect(loadRules()["a@x.com"]).toBeUndefined(); // persisted
  });

  it("is a no-op for a sender that was never filed", () => {
    saveRule("a@x.com", "noise");
    expect(Object.keys(clearRule("nobody@x.com"))).toEqual(["a@x.com"]);
  });
});
