import { describe, it, expect } from "vitest";
import { linksOf, resourceFor, groundingFor, contextFor, isGroupSend } from "./startGround";
import { startAction, type StartTarget } from "./startAction";
import type { TaskData } from "../notes/types";

const TODAY = "2026-09-16";
const task = (text: string, data: Partial<TaskData> = {}): StartTarget => ({
  kind: "task", id: "t1", title: text,
  data: { text, category: "life", done: false, ...data },
});

describe("startGround: only what the records really say", () => {
  it("reads the links a task actually claims", () => {
    expect(linksOf({ text: "", category: "", done: false, fromNote: "n1", eventId: "e1", personId: "p9" }))
      .toEqual({ noteId: "n1", eventId: "e1", personId: "p9" });
    expect(linksOf(undefined)).toEqual({});
  });

  it("a note beats an event, and a message task keeps its event as grounding rather than a destination", () => {
    const data = { text: "", category: "", done: false } as TaskData;
    const ev = { id: "e1", title: "Saturday practice", date: TODAY };
    expect(resourceFor(data, { event: ev }, false)).toEqual({ kind: "event", id: "e1", label: "Saturday practice" });
    // Same records, a message task: the event is facts for the draft, so the
    // screen must not send him to the calendar instead of writing.
    expect(resourceFor(data, { event: ev }, true)).toBeNull();
    expect(resourceFor(data, { note: { id: "n1", title: "Practice note" }, event: ev }, true))
      .toEqual({ kind: "note", id: "n1", label: "Practice note" });
  });

  it("a bill falls back to the pay page it already stored", () => {
    const data = { text: "", category: "", done: false, bill: { amount: 40, payUrl: "https://pay.example" } } as TaskData;
    expect(resourceFor(data, {}, false)).toEqual({ kind: "url", id: "https://pay.example", label: "The pay page" });
    // No pay link stored means no link invented.
    expect(resourceFor({ text: "", category: "", done: false, bill: { amount: 40 } } as TaskData, {}, false)).toBeNull();
  });

  it("the draft states the event's real day and time, and names the hole it cannot fill", () => {
    const g = groundingFor(
      task("Send team practice details"),
      { event: { id: "e1", title: "Practice", date: "2026-09-19", start: "14:00" } },
      TODAY,
    );
    expect(g.lines[0]).toBe("Hi everyone,");
    expect(g.lines[1]).toMatch(/^Practice is /);
    expect(g.lines[1]).toContain("2:00 PM");
    // The record carries no location, so the screen gets a named hole and
    // the message never invents "the usual place".
    expect(g.missing).toContain("Location still needed");
    expect(g.lines.join(" ")).not.toMatch(/usual|somewhere|TBD/i);
    expect(g.sources[0]!.label).toBe("Source: Practice");
  });

  it("a location the record does carry is stated, and stops being a hole", () => {
    const g = groundingFor(
      task("Send team practice details"),
      { event: { id: "e1", title: "Practice", date: "2026-09-19", start: "14:00", location: "North field" } },
      TODAY,
    );
    expect(g.lines).toContain("Where: North field");
    expect(g.missing).not.toContain("Location still needed");
  });

  it("a send to a group names the missing recipients instead of guessing a roster", () => {
    expect(isGroupSend("Send team practice details")).toBe(true);
    expect(isGroupSend("Email Nadia the invoice")).toBe(false);
    const group = groundingFor(task("Send team practice details"), {}, TODAY);
    expect(group.missing).toContain("Recipients still needed");
    // A real contact on the task is a real recipient, so nothing is missing.
    const one = groundingFor(task("Send team practice details"), { person: { id: "p1", name: "Nadia" } }, TODAY);
    expect(one.missing).not.toContain("Recipients still needed");
    expect(one.sources.some((s) => s.label === "To Nadia")).toBe(true);
  });

  it("contextFor feeds the resolver a draft that is grounded end to end", () => {
    const t = task("Send team practice details", { eventId: "e1" });
    const ctx = contextFor(t, {
      records: { event: { id: "e1", title: "Practice", date: "2026-09-19", start: "14:00" } },
      today: TODAY,
      shapeIsComms: true,
    });
    const a = startAction(t, ctx);
    expect(a.kind).toBe("prepare_draft");
    expect(a.ready).toBe("Editable message ready");
    expect(a.seed).toContain("2:00 PM");
    expect(a.missing).toContain("Location still needed");
    expect(a.completion.completesTask).toBe(false);
  });

  it("a dangling link is a hole, never a reason to invent a record", () => {
    // The task claims a note; the caller could not load it. Nothing is made
    // up: the resolver simply moves on to what it can honestly offer.
    const t = task("Finish Jarvis visuals", { fromNote: "gone" });
    const ctx = contextFor(t, { records: { note: null }, today: TODAY, shapeIsComms: false });
    expect(ctx.resource).toBeNull();
    const a = startAction(t, ctx);
    expect(a.kind).toBe("capture_next_action");
    expect(a.destination).toBeUndefined();
  });
});
