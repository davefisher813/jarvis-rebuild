import { describe, it, expect, vi } from "vitest";
import { sourceOpener } from "./openSource";
import type { Source, SourceType } from "./provenance";

const src = (type: SourceType, ref?: string): Source => ({ type, ...(ref ? { ref } : {}), ts: 1 });

// ONLY MAIL GOES TO EMAIL (audit 2026-09-29). A source stamp opens the record it
// names: a task opens the task, an event the event, and only the two stamps
// that name a mail thread may land on the Email tab. Everything the app has no
// record behind stays a plain fact instead of a button that goes somewhere else.
describe("sourceOpener: a source opens what it names", () => {
  const opened = (type: SourceType, ref = "r1") => {
    const nav = vi.fn();
    const go = sourceOpener(nav)(src(type, ref));
    go?.();
    return { hasDoor: !!go, calls: nav.mock.calls };
  };

  it("a task source opens the task, not the inbox", () => {
    expect(opened("task", "t9")).toEqual({ hasDoor: true, calls: [["task", "t9"]] });
  });

  it("notes, events and files open their own page", () => {
    expect(opened("note", "n1").calls).toEqual([["note", "n1"]]);
    expect(opened("event", "e1").calls).toEqual([["event", "e1"]]);
    expect(opened("file", "f1").calls).toEqual([["file", "f1"]]);
  });

  it("only email and gmail stamps route to email", () => {
    const all: SourceType[] = ["paste", "note", "email", "recorder", "chat", "file", "plan", "event", "task", "sweep", "reflow", "google_calendar", "gmail", "apple_health", "health", "apple_calendar", "apple_reminders", "contacts"];
    const toEmail = all.filter((t) => opened(t).calls.some((c) => c[0] === "email"));
    expect(toEmail.sort()).toEqual(["email", "gmail"]);
  });

  it("a source with no ref, or with nothing behind it, has no door", () => {
    expect(sourceOpener(vi.fn())(src("task"))).toBeUndefined();
    expect(opened("paste").hasDoor).toBe(false);
    expect(opened("apple_reminders").hasDoor).toBe(false);
  });
});
