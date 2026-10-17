import { describe, it, expect } from "vitest";
import { readQuickTask } from "./quickTask";

// THE LOGGING STANDARD, RULE 3 (2026-10-17): one line, read inline. The
// reminder field already read a day, a time and a rhythm; a task also carries
// how long it takes and which area it is for.
const TODAY = "2026-10-17";
const CATS = [{ id: "c1", name: "Work" }, { id: "c2", name: "Home Life" }];

describe("readQuickTask: one line names the whole task", () => {
  it("Call Nadia tomorrow 3pm 30 min #Work: due tomorrow, 3:00 PM, 30 Min, Work", () => {
    const r = readQuickTask("Call Nadia tomorrow 3pm 30 min #Work", TODAY, CATS);
    expect(r.title).toBe("Call Nadia");
    expect(r.day).toBe("2026-10-18");
    expect(r.time).toBe("15:00");
    expect(r.estimateMin).toBe(30);
    expect(r.categoryId).toBe("c1");
    expect(r.matched).toEqual(["3pm", "tomorrow", "30 min", "#Work"]);
  });

  it("reads hours, glued hours and minutes, and an hour with a unit on the minutes", () => {
    expect(readQuickTask("Write the report 1.5 hours", TODAY).estimateMin).toBe(90);
    expect(readQuickTask("Deep clean 1h30", TODAY).estimateMin).toBe(90);
    expect(readQuickTask("Deep clean 1h 15 min", TODAY).title).toBe("Deep clean");
    expect(readQuickTask("Deep clean 1h 15 min", TODAY).estimateMin).toBe(75);
    expect(readQuickTask("Stretch 45m", TODAY).estimateMin).toBe(45);
  });

  it("an hour followed by a bare count is one hour, and the count stays in the title", () => {
    const r = readQuickTask("Prep 1h 2 people", TODAY);
    expect(r.estimateMin).toBe(60);
    expect(r.title).toBe("Prep 2 people");
  });

  it("a #tag that names no area stays in the title, exactly as typed, and nothing is guessed", () => {
    const r = readQuickTask("Fix the shelf #Garage", TODAY, CATS);
    expect(r.categoryId).toBeNull();
    expect(r.title).toBe("Fix the shelf #Garage");
    expect(r.matched).toEqual([]);
  });

  it("a #tag matches an area name case-insensitively and without its spaces", () => {
    const r = readQuickTask("Plan the week #homelife", TODAY, CATS);
    expect(r.categoryId).toBe("c2");
    expect(r.title).toBe("Plan the week");
  });

  it("a plain line reads as itself: no day, no time, no length, no area", () => {
    const r = readQuickTask("Renew the domain", TODAY, CATS);
    expect(r).toMatchObject({ title: "Renew the domain", day: null, time: null, estimateMin: null, categoryId: null, matched: [] });
  });
});
