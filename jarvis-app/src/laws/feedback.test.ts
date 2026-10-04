import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// FEEDBACK GUARDRAILS (ADHD Reward Design Brief, Dave-approved 2026-10-04).
//
// The feedback system is a motivation-and-feedback layer, not a reward
// economy. These are the things it must never become, held where a future
// edit cannot drift into them quietly:
//   - no score, level, points, badge, leaderboard or ranking
//   - no counter that resets to zero, and no decay
//   - no surprise or mystery reward (nothing random in the feedback path)
//   - no shame in the words (overdue, behind, failed, give up)
//   - a celebration never blocks the next action
//   - the plain confirmation of a changed state is not behind any setting
const SRC = join(__dirname, "..");
const FILES = [
  ...readdirSync(join(SRC, "encourage")).filter((f) => !/\.test\./.test(f)).map((f) => join("encourage", f)),
  "tasks/progress.ts",
  "settings/FeedbackStylePage.tsx",
];
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
// Comments describe the rule and may name what is forbidden.
const code = (f: string) => read(f).split("\n").filter((l) => { const t = l.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); }).join("\n");

describe("feedback guardrails", () => {
  it("has files to guard", () => {
    expect(FILES.length).toBeGreaterThan(5);
    for (const f of FILES) expect(statSync(join(SRC, f)).isFile()).toBe(true);
  });

  it("no score, level, points, badge, leaderboard or rank in the feedback code", () => {
    const bad = /\b(score|points?|badges?|leaderboard|ranking|xp|levelUp|achievement|trophy|coins?)\b/i;
    for (const f of FILES) expect(code(f), f).not.toMatch(bad);
  });

  it("nothing resets to zero or decays", () => {
    const bad = /\b(resetStreak|resetCount|decay|expire[sd]?Streak|runLen|bestRun)\b/i;
    for (const f of FILES) expect(code(f), f).not.toMatch(bad);
  });

  it("nothing is random: no mystery or surprise reward can exist", () => {
    for (const f of FILES) {
      expect(code(f), f).not.toMatch(/Math\.random|crypto\.getRandomValues|randomUUID|\b(mystery|surprise|lottery|loot|jackpot)\b/i);
    }
  });

  it("the words carry no shame", () => {
    const bad = /\b(overdue|behind|failed|failure|give up|gave up|lazy|slacking|missed|unfinished|incomplete)\b/i;
    for (const f of ["encourage/messages.ts", "settings/FeedbackStylePage.tsx"]) expect(code(f), f).not.toMatch(bad);
  });

  it("no timer holds a celebration over the next action", () => {
    for (const f of FILES) {
      expect(code(f), f).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|await\s+new Promise/);
    }
  });

  it("the sentence saying what changed does not read any setting", () => {
    // messages.ts takes the tone as an argument and never reads the
    // celebration or quiet state, so no switch can silence the state line.
    const m = code("encourage/messages.ts");
    expect(m).not.toMatch(/readFeedback|isQuietToday|celebrat|effectiveFeedback/);
  });

  it("accountability is private and cannot be set to anything else in v1", () => {
    expect(code("encourage/prefs.ts")).toMatch(/accountability: "private"/);
    expect(code("settings/FeedbackStylePage.tsx")).not.toMatch(/accountability:\s*["'](?!private)/);
  });
});
