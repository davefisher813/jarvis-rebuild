import { describe, it, expect } from "vitest";
import { mentions, namePatterns, openWith } from "./mentions";

describe("who a piece of work is about", () => {
  it("matches the full name", () => {
    expect(mentions("Call Mike Ridgeley about the field", "Mike Ridgeley")).toBe(true);
  });

  it("matches a first name that cannot be mistaken for a word", () => {
    expect(mentions("Reply to Nadia re: invoice", "Nadia Sorensen")).toBe(true);
  });

  // A wrong link attaches someone else's work to a person's name, which is
  // worse than no link at all.
  it("refuses a first name that is an ordinary word", () => {
    expect(mentions("Mark done the invoice", "Mark Delaney")).toBe(false);
    expect(mentions("Will need to book travel", "Will Harper")).toBe(false);
    expect(mentions("Rob the fund of nothing", "Rob Calder")).toBe(false);
  });

  it("still matches those people by their full name", () => {
    expect(mentions("Email Mark Delaney the invoice", "Mark Delaney")).toBe(true);
  });

  it("gives up entirely on a one-word ambiguous name", () => {
    expect(namePatterns("Mark")).toEqual([]);
    expect(mentions("Mark done", "Mark")).toBe(false);
  });

  it("matches whole words and possessives, not fragments", () => {
    expect(mentions("Nadia's invoice", "Nadia Sorensen")).toBe(true);
    expect(mentions("Nadiaville planning", "Nadia Sorensen")).toBe(false);
  });
});

describe("what is still open with them", () => {
  const today = "2026-08-21";
  const tasks = [
    { id: "t1", text: "Call Nadia about the invoice" },
    { id: "t2", text: "Nadia signed off already", done: true },
    { id: "t3", text: "Buy milk" },
  ];
  const events = [
    { id: "e1", title: "Call With Nadia", date: "2026-08-21" },
    { id: "e2", title: "Call With Nadia", date: "2026-08-01" },
    { id: "e3", title: "Gym", date: "2026-08-22" },
  ];

  it("is what is still between you, not a history", () => {
    const out = openWith({ name: "Nadia Sorensen" }, tasks, events, today);
    expect(out.map((m) => m.id)).toEqual(["t1", "e1"]);
  });

  it("says nothing at all when the name is not safe to match", () => {
    expect(openWith({ name: "Mark" }, tasks, events, today)).toEqual([]);
  });

  it("reads the location too", () => {
    const out = openWith({ name: "Nadia Sorensen" }, [], [{ id: "e9", title: "Lunch", date: today, location: "Nadia's office" }], today);
    expect(out.map((m) => m.id)).toEqual(["e9"]);
  });
});
