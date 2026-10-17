// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { nowDraftStore, readNowDraft, writeNowDraft, receiptDraftStore, voiceDraftStore, clearSessionDrafts } from "./sessionDrafts";
import { clearLive, writeLive } from "./liveSession";

// NOTHING TYPED IS LOST (Logging Standard rule 8, 2026-10-17). The gym's
// two drafts are keyed per session and exercise, read back as what was
// written, and swept by clearLive on every way out of a session.
beforeEach(() => localStorage.clear());

describe("the session drafts", () => {
  it("round-trips the Now card's strings per session and exercise", () => {
    const a = nowDraftStore(1000, "e1");
    writeNowDraft(a, { w: "23", r: "5", warm: false });
    expect(readNowDraft(a)).toEqual({ w: "23", r: "5", warm: false });
    expect(readNowDraft(nowDraftStore(1000, "e2")), "another exercise has its own").toBeNull();
    expect(readNowDraft(nowDraftStore(2000, "e1")), "another session has its own").toBeNull();
    writeNowDraft(a, null);
    expect(readNowDraft(a)).toBeNull();
  });
  it("drops a stored shape it did not write", () => {
    localStorage.setItem("jarvis.gym.now.draft.v1:1:e1", "{\"w\":225}");
    expect(readNowDraft(nowDraftStore(1, "e1"))).toBeNull();
    localStorage.setItem("jarvis.gym.now.draft.v1:1:e1", "not json");
    expect(readNowDraft(nowDraftStore(1, "e1"))).toBeNull();
  });
  it("clearLive sweeps every gym draft, the Now card's and the receipt's, and nothing else", () => {
    writeLive({ programId: "p", dayId: "d", dayName: "Pull", date: "2026-10-17", startedAt: 1000, idx: 0, exercises: [] });
    writeNowDraft(nowDraftStore(1000, "e1"), { w: "23", r: "5" });
    writeNowDraft(nowDraftStore(1000, "e2"), { w: "", r: "12" });
    receiptDraftStore(1000).write("Left shoulder pinched");
    localStorage.setItem("jarvis.task.draft.v1", "Buy milk");
    clearLive();
    expect(readNowDraft(nowDraftStore(1000, "e1"))).toBeNull();
    expect(readNowDraft(nowDraftStore(1000, "e2"))).toBeNull();
    expect(receiptDraftStore(1000).read()).toBe("");
    expect(localStorage.getItem("jarvis.task.draft.v1"), "another composer's draft is not the gym's to clear").toBe("Buy milk");
  });
  it("clearSessionDrafts on its own leaves nothing of the gym's behind", () => {
    writeNowDraft(nowDraftStore(5, "x"), { w: "1", r: "1" });
    receiptDraftStore(5).write("note");
    voiceDraftStore(5, "x").write("Log 225 for 5");
    clearSessionDrafts();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("jarvis.gym."))).toEqual([]);
  });
});
