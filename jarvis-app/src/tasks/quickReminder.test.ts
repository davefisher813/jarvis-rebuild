// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readQuick, inMinutes, morningTime, setMorningTime } from "./quickReminder";

// QUICK CREATION (the reminders rebuild, 2026-09-15): the words are read
// deterministically, the read words leave the title, and a word that cannot
// be read is left alone.
const TODAY = "2026-09-15"; // a Tuesday

describe("readQuick", () => {
  it("reads a day, a time and a rhythm, and shows which words it took", () => {
    const q = readQuick("Remind me to call the pharmacy tomorrow at 10am every weekday", TODAY);
    expect(q.title).toBe("Call the pharmacy");
    expect(q.day).toBe("2026-09-16");
    expect(q.time).toBe("10:00");
    expect(q.repeat).toEqual({ kind: "weekdays", days: [1, 2, 3, 4, 5] });
    expect(q.matched.length).toBe(3);
  });
  it("a plain sentence reads nothing and keeps every word", () => {
    const q = readQuick("Call Mom later", TODAY);
    expect(q.title).toBe("Call Mom later");
    expect(q.day).toBeNull();
    expect(q.time).toBeNull();
    expect(q.repeat).toBeNull();
    expect(q.matched).toEqual([]);
  });
  it("a time alone is today's, and the lead-in is dropped either way", () => {
    const q = readQuick("remind me meds at 9pm", TODAY);
    expect(q.title).toBe("Meds");
    expect(q.time).toBe("21:00");
  });
  it("every day is a rhythm without a day", () => {
    const q = readQuick("Stretch every day at 7am", TODAY);
    expect(q.title).toBe("Stretch");
    expect(q.repeat).toEqual({ kind: "daily" });
    expect(q.time).toBe("07:00");
  });
});

describe("the shortcuts", () => {
  it("count minutes from the clock they are given, across midnight", () => {
    const now = new Date("2026-09-15T23:50:00").getTime();
    expect(inMinutes(now, 15)).toEqual({ day: "2026-09-16", time: "00:05" });
    expect(inMinutes(now, 60)).toEqual({ day: "2026-09-16", time: "00:50" });
  });
  describe("morning is one setting for the whole app", () => {
    beforeEach(() => { window.localStorage.removeItem("jarvis.reminders.morning.v1"); });
    it("defaults to eight and remembers what it is told", () => {
      expect(morningTime()).toBe("08:00");
      setMorningTime("06:30");
      expect(morningTime()).toBe("06:30");
    });
  });
});
