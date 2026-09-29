import { describe, it, expect } from "vitest";
import { DRAFT_KEY, draftKey, loadLocalDrafts, loadLocalDraft, saveLocalDraft, clearLocalDraft, continuableReply, restoreInto, draftHasWords, carriedOverrides } from "./composeDraft";
import { replySourceOf } from "./useReplyRequirements";

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

// REPLY COVERAGE (2026-09-29): a reply carries the revision it was started
// against and the marks the person made by hand. The marks belong to that
// revision; the words never do.
describe("composeDraft: source revision and manual marks", () => {
  const MARKS = { rr_a: "addressed", rr_b: "open" } as const;
  type Fresh = { to: string; subject: string; body: string; threadId: string; inReplyTo: string; sourceRevision: string; overrides?: Record<string, "addressed" | "open"> };

  it("saves the revision and the marks with the draft, and reads them back", () => {
    const s = mem();
    saveLocalDraft("new", { to: "wei@x.com", subject: "Re: PO", body: "Tuesday works.", threadId: "t1", inReplyTo: "<m1>", sourceRevision: "m7", overrides: { ...MARKS } }, 1, s);
    expect(loadLocalDraft("new", s)).toMatchObject({ sourceRevision: "m7", overrides: MARKS });
  });

  it("a mark that is not addressed or open is thrown away on load, and a junk value does not lose the draft", () => {
    const s = mem();
    s.setItem(DRAFT_KEY, JSON.stringify({ new: { to: "a", subject: "s", body: "kept", savedAt: 5, overrides: { x: "maybe", y: "addressed", z: 3 }, sourceRevision: 7 } }));
    const d = loadLocalDraft("new", s)!;
    expect(d.body).toBe("kept");
    expect(d.overrides).toEqual({ y: "addressed" });
    expect(d.sourceRevision).toBeUndefined();
  });

  it("restoring on the SAME revision brings the marks back with the words", () => {
    const fresh: Fresh = { to: "wei@x.com", subject: "Re: PO", body: "", threadId: "t1", inReplyTo: "<m1>", sourceRevision: "m7" };
    const saved = { to: "wei@x.com", subject: "Re: PO", body: "Tuesday works.", threadId: "t1", sourceRevision: "m7", overrides: { ...MARKS }, savedAt: 5 };
    expect(restoreInto(fresh, saved)).toMatchObject({ body: "Tuesday works.", sourceRevision: "m7", overrides: MARKS });
  });

  it("restoring on a NEWER revision resets the marks and keeps the draft", () => {
    const fresh: Fresh = { to: "wei@x.com", subject: "Re: PO", body: "", threadId: "t1", inReplyTo: "<m1>", sourceRevision: "m9" };
    const saved = { to: "wei@x.com", subject: "Re: PO", body: "Tuesday works, four players.", threadId: "t1", sourceRevision: "m7", overrides: { ...MARKS }, savedAt: 5 };
    const r = restoreInto(fresh, saved);
    expect(r.body).toBe("Tuesday works, four players.");
    expect(r.sourceRevision).toBe("m9");
    expect(r.overrides).toBeUndefined();
    // A draft saved before this existed has no revision to match, so no marks come back either.
    expect(restoreInto(fresh, { ...saved, sourceRevision: undefined }).overrides).toBeUndefined();
  });

  it("carriedOverrides: kept while the conversation is where the draft left it, reset when it moved, kept when it cannot tell", () => {
    const saved = { sourceRevision: "m7", overrides: { ...MARKS } };
    expect(carriedOverrides(saved, "m7")).toEqual({ sourceRevision: "m7", overrides: MARKS });
    expect(carriedOverrides(saved, "m9")).toEqual({ sourceRevision: "m9" });
    expect(carriedOverrides(saved, undefined)).toEqual({ sourceRevision: "m7", overrides: MARKS });
    expect(carriedOverrides({}, "m9")).toEqual({ sourceRevision: "m9" });
    expect(carriedOverrides({}, undefined)).toEqual({});
  });

  it("only a reply has a source: account, thread and revision travel; a new compose and a forward have none", () => {
    const fallback = { account: "dave@x.com", revision: "m7" };
    expect(replySourceOf({ threadId: "t1", inReplyTo: "<m1>", account: "dave@x.com", sourceRevision: "m7" }, fallback)).toEqual({ account: "dave@x.com", threadId: "t1", revision: "m7" });
    // The revision and account fall back to what the inbox knows.
    expect(replySourceOf({ threadId: "t1", inReplyTo: "<m1>" }, fallback)).toEqual({ account: "dave@x.com", threadId: "t1", revision: "m7" });
    // The draft's own account beats the fallback: switching mailboxes is a different source.
    expect(replySourceOf({ threadId: "t1", inReplyTo: "<m1>", account: "other@x.com", sourceRevision: "m7" }, fallback)?.account).toBe("other@x.com");
    // New compose: no thread. Forward: no inReplyTo.
    expect(replySourceOf({}, fallback)).toBeNull();
    expect(replySourceOf({ threadId: "t1" }, fallback)).toBeNull();
    // A reply whose revision nobody knows has nothing to look up.
    expect(replySourceOf({ threadId: "t1", inReplyTo: "<m1>" }, { account: "dave@x.com" })).toBeNull();
  });
});
