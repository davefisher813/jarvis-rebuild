// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { putComposeDraft, takeComposeDraft } from "./composeDraft";

// UP-MIND-22. One pending compose, read once and gone: a composer that
// reopens tomorrow over words already sent is the failure this shape exists
// to prevent.
beforeEach(() => localStorage.clear());

describe("the draft Chat wrote", () => {
  it("comes back exactly as it was written", () => {
    putComposeDraft({ to: "sarah@example.com", subject: "Roster", body: "Sending it Friday." });
    expect(takeComposeDraft()).toMatchObject({ to: "sarah@example.com", subject: "Roster", body: "Sending it Friday." });
  });

  it("is gone after it is read", () => {
    putComposeDraft({ to: "a@b.c", subject: "", body: "Hello." });
    takeComposeDraft();
    expect(takeComposeDraft()).toBeNull();
  });

  it("expires rather than opening a composer hours later", () => {
    const now = Date.now();
    putComposeDraft({ to: "a@b.c", subject: "", body: "Hello." }, now);
    expect(takeComposeDraft(now + 11 * 60e3)).toBeNull();
  });

  it("refuses an empty body and anything unreadable", () => {
    putComposeDraft({ to: "a@b.c", subject: "", body: "   " });
    expect(takeComposeDraft()).toBeNull();
    localStorage.setItem("jarvis.chat.compose.v1", "{not json");
    expect(takeComposeDraft()).toBeNull();
  });
});
