import { describe, it, expect } from "vitest";
import { DRAFT_KEY, draftKey, loadLocalDrafts, loadLocalDraft, saveLocalDraft, clearLocalDraft, continuableReply, restoreInto, draftHasWords } from "./composeDraft";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, raw: m };
}

// E-26 / E-25 (Push F): the local compose autosave.
describe("composeDraft", () => {
  it("keys on the Gmail draft being edited, or new", () => {
    expect(draftKey(null)).toBe("new");
    expect(draftKey(undefined)).toBe("new");
    expect(draftKey("r-123")).toBe("r-123");
  });

  it("saves, reads back, and drops a draft with no words in it", () => {
    const s = mem();
    saveLocalDraft("new", { to: "wei@x.com", subject: "PO", body: "Tuesday works.", threadId: "t1", account: "dave@x.com", inReplyTo: "<m1>" }, 1000, s);
    expect(loadLocalDraft("new", s)).toEqual({ to: "wei@x.com", subject: "PO", body: "Tuesday works.", threadId: "t1", account: "dave@x.com", inReplyTo: "<m1>", savedAt: 1000 });
    saveLocalDraft("new", { to: "", subject: " ", body: "\n" }, 2000, s);
    expect(loadLocalDraft("new", s)).toBeNull();
    expect(draftHasWords({ to: "", subject: "", body: "x" })).toBe(true);
    expect(draftHasWords({ to: "", cc: " ", subject: "", body: "" })).toBe(false);
  });

  it("keeps an empty Cc as a Cc row and survives junk", () => {
    const s = mem();
    saveLocalDraft("new", { to: "a@x.com", cc: "", subject: "s", body: "b" }, 1, s);
    expect(loadLocalDraft("new", s)?.cc).toBe("");
    s.setItem(DRAFT_KEY, JSON.stringify({ bad: { to: 1 }, ok: { to: "a", subject: "s", body: "b", savedAt: 5 } }));
    expect(Object.keys(loadLocalDrafts(s))).toEqual(["ok"]);
    s.setItem(DRAFT_KEY, "{nope");
    expect(loadLocalDrafts(s)).toEqual({});
  });

  it("clearLocalDraft removes one seat and leaves the rest", () => {
    const s = mem();
    saveLocalDraft("new", { to: "a@x.com", subject: "", body: "one" }, 1, s);
    saveLocalDraft("r-9", { to: "b@x.com", subject: "", body: "two" }, 2, s);
    clearLocalDraft("new", s);
    expect(Object.keys(loadLocalDrafts(s))).toEqual(["r-9"]);
    clearLocalDraft("nothing", s);
    expect(Object.keys(loadLocalDrafts(s))).toEqual(["r-9"]);
  });

  it("continuableReply is the newest draft with a thread and words, or null", () => {
    expect(continuableReply({})).toBeNull();
    expect(continuableReply({ new: { to: "a", subject: "", body: "hi", savedAt: 1 } })).toBeNull(); // no thread
    expect(continuableReply({ new: { to: "a", subject: "", body: "  ", threadId: "t", savedAt: 1 } })).toBeNull(); // no words
    const r = continuableReply({
      new: { to: "a", subject: "", body: "older", threadId: "t1", savedAt: 1 },
      "r-2": { to: "b", subject: "", body: "newer", threadId: "t2", savedAt: 2 },
    });
    expect(r?.key).toBe("r-2");
  });

  it("restoreInto brings back a saved draft only for the same conversation", () => {
    const fresh = { to: "wei@x.com", subject: "Re: PO", body: "", threadId: "t1", inReplyTo: "<m1>" };
    const saved = { to: "wei@x.com", subject: "Re: PO", body: "Tuesday works.", threadId: "t1", account: "dave@x.com", savedAt: 5 };
    expect(restoreInto(fresh, saved)).toEqual({ ...fresh, body: "Tuesday works.", account: "dave@x.com" });
    // A saved reply never leaks into a fresh compose, nor the reverse.
    expect(restoreInto({ to: "", subject: "", body: "" }, saved)).toEqual({ to: "", subject: "", body: "" });
    expect(restoreInto(fresh, { to: "x", subject: "y", body: "z", savedAt: 1 })).toEqual(fresh);
    expect(restoreInto(fresh, null)).toEqual(fresh);
  });
});
