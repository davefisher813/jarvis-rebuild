import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// THE PROJECT / GOAL CARD (Dave 2026-09-18, with an approved mockup).
//
// Most of that handoff is a look, and a look is held by the render. These are
// the parts that are not a look, and would go quietly wrong.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const CARD = read("bigger/ItemCard.tsx");
const PAGE = read("bigger/BiggerPicturePage.tsx");
const RULED = read("styles/ruled.css");

describe("a goal's bar is its outcome, never its paperwork", () => {
  // THE ONE RULE IN THE HANDOFF THAT IS ABOUT TRUTH:
  //
  //   "Do not treat linked task completion as outcome progress. For example,
  //    finishing fundraising tasks does not mean money has been raised."
  //
  // The ruled row beside the card does exactly that as a fallback -- it draws
  // reach.progress, the completion of the tasks filed under the goal, when
  // there is no measure. On a row carrying a status capsule and a line that
  // says what it is, that reads as "how the work is going". On a card whose
  // whole face is a title and a bar it reads as "$100K is 80% raised" when
  // what is 80% done is the paperwork. The card must not inherit it.
  it("draws a goal's bar only from a Measure", () => {
    const fn = PAGE.slice(PAGE.indexOf("const goalCard ="), PAGE.indexOf("// Goals lens:"));
    expect(fn, "the goal card exists").toBeTruthy();
    expect(fn, "the bar comes from the measure").toMatch(/progress=\{ms \? \{ done: ms\.done, total: ms\.target, pct: ms\.pct \} : null\}/);
    expect(fn, "and never from the goal's reach, which is task completion")
      .not.toMatch(/progress=\{[^}]*reachOfGoal/);
    expect(fn, "nor from reach.progress by any other route").not.toMatch(/r\.progress/);
  });

  // A project's bar IS its task count, and that is honest: a project is a
  // bag of tasks, so finishing them is finishing it. The distinction is the
  // whole point, so both halves are pinned.
  it("still draws a project's bar from its real task count", () => {
    const fn = PAGE.slice(PAGE.indexOf("const projCard ="), PAGE.indexOf("/** A GOAL'S BAR"));
    expect(fn).toMatch(/progress=\{progress\}/);
    expect(fn, "and says the count in words beside it").toMatch(/\$\{progress\.done\} of \$\{progress\.total\} tasks/);
  });

  // "Do not add a percentage beside a count that already communicates
  // progress." The count and the bar already say it twice.
  it("prints no percentage on any card", () => {
    expect(CARD).not.toMatch(/\{[^}]*pct[^}]*\}%|`\$\{[^}]*pct[^}]*\}%`/);
    expect(PAGE.slice(PAGE.indexOf("const projCard =")), "nor in what the page hands it")
      .not.toMatch(/foot=\{[^}]*%/);
  });
});

describe("the card is square, and yields only to large text", () => {
  it("takes its square from its own column", () => {
    expect(RULED).toMatch(/\.ruled \.bp-grid \{[^{}]*grid-template-columns: 1fr 1fr/);
    expect(RULED).toMatch(/\.ruled \.bp-card \{[\s\S]{0,600}?aspect-ratio: 1;/);
  });

  // MEASURED, because this one is a trap. With aspect-ratio set, a min-height
  // that exceeds the square recomputes the WIDTH from it: at 1.4 text scale
  // the cards grew to 184.8px inside a 174.5px track and overlapped their
  // neighbours. max-width pins the width to the track so min-height can do
  // its job -- the card stops being square and grows DOWN, which is the
  // adaptation the handoff asks for ("at larger accessibility sizes, allow
  // the layout to adapt to preserve readability").
  it("pins its width to the track so a tall card cannot overlap its neighbour", () => {
    expect(RULED).toMatch(/\.ruled \.bp-card \{[\s\S]{0,600}?max-width: 100%;/);
    expect(RULED).toMatch(/\.ruled \.bp-card \{[\s\S]{0,700}?min-height: calc\(132px \* var\(--type-scale\)\)/);
  });

  // Every colour slot gets a card. The gradient is mixed from the one
  // category token, so a slot added later needs no new rule beyond its name.
  it("gives every category slot a gradient", () => {
    const slots = ["red", "orange", "sky", "pink", "yellow", "green", "blue", "teal", "graphite", "purple", "indigo", "magenta", "lime"];
    for (const s of slots) {
      expect(RULED, s + " has no card colour").toContain(`.ruled .bp-card-${s} { --bp-hue: var(--cat-${s}); }`);
    }
    expect(RULED, "and the two stops are mixed from that one token")
      .toMatch(/color-mix\(in oklab, var\(--bp-hue\)/);
  });
});

describe("the cards kept what the list had", () => {
  // The folded receipt is the ONLY door to a finished project or goal, and
  // the Add row ends the page. Both were written inside the ruled list, so
  // the first draft of the card view silently dropped them -- four tests in
  // LifeFlow went red, which is how it was found rather than shipped.
  it("renders the same tail under the grid as under the list", () => {
    expect(PAGE, "one definition of the projects tail").toMatch(/const projectTail = doneRows\.length > 0/);
    expect(PAGE, "one definition of the goals tail").toMatch(/const goalTail = doneGoals\.length > 0/);
    expect(PAGE.match(/\{projectTail\}/g)?.length, "under the grid and under the list").toBe(2);
    expect(PAGE.match(/\{goalTail\}/g)?.length, "under the grid and under the list").toBe(2);
  });

  it("keeps the overflow on the actions the row already had", () => {
    const sheet = PAGE.slice(PAGE.indexOf("{cardMenu && (()"), PAGE.indexOf("{/* MOVE TO GOAL"));
    expect(sheet, "Close It, where the row would offer it").toMatch(/closable\(row\) && onCloseProject/);
    expect(sheet, "Move to Goal, where the row would").toMatch(/onMoveProject \? \[\{ label: "Move to Goal"/);
  });

  it("leaves a way back to the list", () => {
    expect(PAGE).toMatch(/aria-label=\{cardView \? "Show as a list" : "Show as cards"\}/);
  });
});
