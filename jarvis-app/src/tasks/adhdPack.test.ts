import { describe, it, expect } from "vitest";
import { rungsFor, ladderBody, buildLadder, LADDER } from "../schedule/countdown";
import { padMinutes, estimateFor, padNote, learnedNote, PAD_FACTOR } from "../schedule/padding";
import { automaticityOf, automaticityLine, countEnactment, AUTOMATIC_MEDIAN, MIN_TO_SHOW } from "./automaticity";
import { welcomeBack, markSeen, loadLastSeen, AWAY_DAYS } from "../today/welcomeBack";
import { theOneThing, loadOverwhelmed, setOverwhelmed } from "./overwhelmed";
import type { TaskItem } from "./TasksService";

describe("B1 · the countdown ladder", () => {
  it("skips rungs that have already passed rather than stacking them", () => {
    expect(rungsFor(20)).toEqual([15, 5]);
    expect(rungsFor(90)).toEqual([...LADDER]);
    expect(rungsFor(3)).toEqual([]);
  });

  it("never fires an 'in an hour' alert for something happening in twenty minutes", () => {
    const alerts = buildLadder("Board call", Date.now() + 20 * 60000, Date.now());
    expect(alerts.some((a) => a.leadMin === 60)).toBe(false);
  });

  it("changes tone as it closes: information, then instruction", () => {
    expect(ladderBody(60)).toBe("In an hour");
    expect(ladderBody(30)).toBe("In half an hour");
    expect(ladderBody(5)).toBe("Leave what you're doing");
    expect(ladderBody(15)).not.toBe(ladderBody(5)); // identical copy trains you to ignore it
  });

  it("carries the place when there is one", () => {
    expect(ladderBody(30, "Zoom")).toBe("In half an hour · Zoom");
    expect(ladderBody(30, "   ")).toBe("In half an hour");
  });

  it("puts each alert at the right moment", () => {
    const start = Date.now() + 90 * 60000;
    const a = buildLadder("X", start, Date.now()).find((x) => x.leadMin === 30)!;
    expect(a.atMs).toBe(start - 30 * 60000);
  });
});

describe("B3 · padding an unlearned guess", () => {
  it("pads by half and snaps to the quarter hour", () => {
    expect(PAD_FACTOR).toBe(1.5);
    expect(padMinutes(30)).toBe(45);
    expect(padMinutes(20)).toBe(30);
  });

  it("a measurement always beats a pad", () => {
    const learned = { Work: 40 };
    expect(estimateFor("Work", learned, 30)).toEqual({ minutes: 40, learned: true });
    expect(estimateFor("Family", learned, 30)).toEqual({ minutes: 45, learned: false });
  });

  it("snaps a pad to a real chip, so the row never looks unset", () => {
    const chips = [15, 30, 45, 60, 90, 120];
    // 45 padded is 75, which is not a chip; 60 is the nearest one he can tap.
    expect(estimateFor("New", {}, 45, chips)).toEqual({ minutes: 60, learned: false });
  });

  it("never presents a pad as a measurement", () => {
    expect(padNote({ minutes: 45, learned: false })).toBe("Padded · No history yet");
    expect(padNote({ minutes: 40, learned: true })).toBeNull();
    expect(learnedNote({ minutes: 40, learned: true })).toBe("Your usual");
  });

  it("never pads to zero", () => {
    expect(padMinutes(1)).toBeGreaterThanOrEqual(15);
  });
});

describe("D1 · repetitions, not streaks", () => {
  it("counts what he DID and never resets", () => {
    expect(automaticityOf(41).done).toBe(41);
    expect(automaticityOf(41).automatic).toBe(false);
    expect(automaticityOf(AUTOMATIC_MEDIAN).automatic).toBe(true);
  });

  it("is silent while the count is still noise", () => {
    expect(automaticityLine(automaticityOf(MIN_TO_SHOW - 1))).toBeNull();
    expect(automaticityLine(automaticityOf(41))).toBe("Done 41 times · Most people are automatic around 59");
  });

  it("says it is automatic once it is", () => {
    expect(automaticityLine(automaticityOf(70))).toContain("automatic");
  });

  it("never mentions misses: a miss count is a streak in disguise", () => {
    const line = automaticityLine(automaticityOf(41))!;
    expect(line).not.toMatch(/miss|skip|broke|lost/i);
  });

  it("cannot be farmed by ticking and unticking", () => {
    const first = countEnactment(10, "2026-08-19", "2026-08-20");
    expect(first.doneCount).toBe(11);
    const again = countEnactment(first.doneCount, first.lastCounted, "2026-08-20");
    expect(again.doneCount).toBe(11);
  });

  it("progress is a fraction, never over one", () => {
    expect(automaticityOf(200).progress).toBe(1);
  });
});

describe("E1 · the return", () => {
  it("says nothing to someone who was here yesterday", () => {
    expect(welcomeBack("2026-08-19", "2026-08-20", 0)).toBeNull();
  });

  it("says nothing on a first run: that would be a lie in the first second", () => {
    expect(welcomeBack(null, "2026-08-20", 0)).toBeNull();
  });

  it("greets a real absence without a count of the pile", () => {
    const w = welcomeBack("2026-08-01", "2026-08-20", 6)!;
    expect(w.days).toBe(19);
    expect(w.title).toBe("Welcome Back");
    expect(w.sub).toBe("6 things aged out on their own · Start with one?");
    expect(w.sub).not.toMatch(/overdue|behind|missed/i);
  });

  it("says nothing was lost when nothing aged out", () => {
    expect(welcomeBack("2026-08-01", "2026-08-20", 0)!.sub).toContain("Nothing was lost");
  });

  it("triggers only past the away threshold", () => {
    expect(welcomeBack("2026-08-20", "2026-08-20", 0)).toBeNull();
    expect(welcomeBack("2026-08-15", "2026-08-15", 0)).toBeNull();
    expect(AWAY_DAYS).toBeGreaterThan(1);
  });

  it("round-trips the last-seen stamp", () => {
    let v: string | null = null;
    const st = { getItem: () => v, setItem: (_k: string, s: string) => { v = s; } };
    markSeen("2026-08-20", st);
    expect(loadLastSeen(st)).toBe("2026-08-20");
  });
});

describe("F1 · I'm overwhelmed", () => {
  const task = (id: string, over: Partial<TaskItem["data"]> = {}): TaskItem =>
    ({ id, data: { text: id, category: "", done: false, ...over } }) as TaskItem;

  it("picks the SMALLEST real thing, not the most important", () => {
    const tasks = [task("big"), task("small")];
    const est = (t: TaskItem) => (t.id === "small" ? 10 : 90);
    expect(theOneThing(tasks, est)?.id).toBe("small");
  });

  it("breaks a tie toward what has been waiting", () => {
    const tasks = [task("new", { due: "2026-09-01" }), task("old", { due: "2026-08-01" })];
    expect(theOneThing(tasks, () => 30)?.id).toBe("old");
  });

  it("never offers a reminder or something already done", () => {
    const tasks = [task("rem", { reminder: { time: "08:00" } }), task("done", { done: true })];
    expect(theOneThing(tasks, () => 30)).toBeNull();
  });

  it("is same-day only: an overwhelmed Tuesday must not hide Wednesday", () => {
    let v: string | null = null;
    const st = {
      getItem: () => v,
      setItem: (_k: string, s: string) => { v = s; },
      removeItem: () => { v = null; },
    };
    setOverwhelmed(true, "2026-08-20", st);
    expect(loadOverwhelmed("2026-08-20", st)).toBe(true);
    expect(loadOverwhelmed("2026-08-21", st)).toBe(false);
    setOverwhelmed(false, "2026-08-20", st);
    expect(loadOverwhelmed("2026-08-20", st)).toBe(false);
  });
});
