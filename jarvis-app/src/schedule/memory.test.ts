import { describe, it, expect } from "vitest";
import { suggestTitles, suggestLocations, suggestCategory, repeatCandidate } from "./memory";
import type { EventItem } from "./types";

let seq = 0;
function evt(title: string, over: Partial<EventItem["data"]> = {}): EventItem {
  return { id: "e" + ++seq, data: { title, date: "2026-07-01", start: "09:00", category: "", ...over } };
}

describe("suggestTitles", () => {
  const hist = [
    evt("Gym Session", { category: "health", location: "Anytime Fitness", start: "17:30", end: "18:30", date: "2026-07-20" }),
    evt("Gym Session", { category: "health", start: "17:30", end: "18:30", date: "2026-07-13" }),
    evt("Gym Session", { category: "health", start: "17:00", end: "18:00", date: "2026-07-06" }),
    evt("Grocery Run", { category: "family", date: "2026-07-19" }),
  ];

  it("offers a past event whole from a couple of typed letters", () => {
    const s = suggestTitles(hist, "gy");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ title: "Gym Session", category: "health", location: "Anytime Fitness", start: "17:30", durationMin: 60, timesUsed: 3 });
  });

  it("matches on any word start and ranks by frequency", () => {
    const s = suggestTitles(hist, "se");
    expect(s[0]!.title).toBe("Gym Session");
  });

  it("stays quiet under 2 chars, on no match, and on an exact title", () => {
    expect(suggestTitles(hist, "g")).toHaveLength(0);
    expect(suggestTitles(hist, "zz")).toHaveLength(0);
    expect(suggestTitles(hist, "Gym Session")).toHaveLength(0);
  });
});

describe("suggestLocations", () => {
  const hist = [
    evt("Lunch", { location: "Blue Bottle" }),
    evt("Lunch", { location: "Blue Bottle" }),
    evt("Coffee", { location: "Blue Bottle" }),
    evt("Gym Session", { location: "Anytime Fitness" }),
  ];
  it("ranks same-title locations first, then overall frequency", () => {
    expect(suggestLocations(hist, "Gym Session")).toEqual(["Anytime Fitness", "Blue Bottle"]);
    expect(suggestLocations(hist, "Dinner")).toEqual(["Blue Bottle", "Anytime Fitness"]);
  });
});

describe("suggestCategory", () => {
  const hist = [evt("Send invoice to Northlake", { category: "money" }), evt("Team standup", { category: "work" })];
  const tasks = [{ text: "Chase invoice payment", category: "money" }];
  it("uses an exact title match first", () => {
    expect(suggestCategory(hist, [], "team standup")).toBe("work");
  });
  it("votes by shared significant words across events and tasks", () => {
    expect(suggestCategory(hist, tasks, "prepare invoice draft")).toBe("money");
  });
  it("returns null with no signal", () => {
    expect(suggestCategory(hist, tasks, "water the plants")).toBeNull();
    expect(suggestCategory([], [], "")).toBeNull();
  });
  // 2026-09-02, Dave: three pasted tasks with no goal chosen got silently
  // tied to a goal that had nothing to do with them. Root cause: generic
  // verbs ("call", "send", "text"...) were treated as significant words, so
  // any two past tasks that merely shared a common verb outvoted the real
  // content into a category, and from there the upward-look picked up
  // whatever goal that category happened to be tagged to.
  it("does not let a shared generic verb outvote into an unrelated category", () => {
    const noisyHist = [evt("Call the plumber", { category: "money" })];
    const noisyTasks = [{ text: "Call Grandma", category: "money" }];
    expect(suggestCategory(noisyHist, noisyTasks, "Call insurance")).toBeNull();
  });
  it("still learns from a real content word repeated across history", () => {
    const realHist = [evt("Renew car insurance", { category: "money" })];
    const realTasks = [{ text: "Check insurance policy", category: "money" }];
    expect(suggestCategory(realHist, realTasks, "Call insurance")).toBe("money");
  });
});

describe("repeatCandidate", () => {
  // 2026-07-07, 14, 21 are consecutive Tuesdays.
  const hist = [
    evt("Piano Lesson", { date: "2026-07-07" }),
    evt("Piano Lesson", { date: "2026-07-14" }),
  ];
  it("fires on the third consecutive same weekday", () => {
    const r = repeatCandidate(hist, { title: "Piano Lesson", date: "2026-07-21" });
    expect(r).toMatchObject({ title: "Piano Lesson", weekday: 2, count: 3 });
  });
  it("does not fire at two weeks, for recurring saves, or broken runs", () => {
    expect(repeatCandidate([hist[0]!], { title: "Piano Lesson", date: "2026-07-14" })).toBeNull();
    expect(repeatCandidate(hist, { title: "Piano Lesson", date: "2026-07-21", recurrence: "weekly" })).toBeNull();
    expect(repeatCandidate(hist, { title: "Piano Lesson", date: "2026-07-28" })).toBeNull();
  });
});
