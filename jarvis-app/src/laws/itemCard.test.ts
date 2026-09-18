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
const TYPES = read("categories/types.ts");

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

describe("the card is square, and the shelf runs sideways", () => {
  // THE SHELF (Dave 2026-09-18: "They can scroll laterally like Apple Music
  // to save vertical space. Just make sure there's an arrow so users know").
  // A grid of squares costs one row of height per two items; a shelf costs
  // one row full stop. The width is the tile's own, so aspect-ratio squares
  // it off that rather than off a column that no longer exists.
  // "They should all be organized by category in each row and scroll to the
  // right hand of the user." One shelf per area, out of the same buckets the
  // ruled list uses, so switching shape can never reorder the page.
  it("gives every area its own shelf, in the list's own order", () => {
    const view = PAGE.slice(PAGE.indexOf("{projectsLens && cardView ? ("), PAGE.indexOf(") : projectsLens ? ("));
    expect(view, "projects grouped by section").toMatch(
      /sections\.map\(\(c\) => \{[\s\S]{0,400}?<CardShelf key=\{c\.id\} title=\{c\.name\}/);
    expect(view, "goals grouped the same way").toMatch(
      /const mine = goalIdsHomed\(c\);[\s\S]{0,300}?<CardShelf key=\{c\.id\} title=\{c\.name\}/);
    expect(view, "and the two catch-alls keep their names")
      .toMatch(/<CardShelf title="More Work">/);
    expect(view).toMatch(/<CardShelf title="Working Toward">/);
    expect(view, "no card view left ungrouped").not.toMatch(/<CardGrid>/);
  });

  // "Reference the formatting of Apple Music it's perfect." Its shelf head is
  // a big bold name and a chevron -- no count, no colour dot. The chevron is
  // a promise, so the head is a button that cuts the page to that area, and
  // a shelf with no area to open carries no chevron rather than a dead one.
  it("heads each shelf the way Apple Music does", () => {
    expect(RULED).toMatch(/\.ruled \.bp-shelf-head \.t \{[\s\S]{0,200}?font-size: calc\(22px \* var\(--type-scale\)\)/);
    expect(RULED).toMatch(/\.ruled \.bp-shelf-head \.t \{[\s\S]{0,240}?font-weight: var\(--w-bold\)/);
    expect(CARD, "a chevron only where there is somewhere to go")
      .toMatch(/onOpen \? \(\s*<button type="button" className="bp-shelf-head"/);
    expect(CARD, "and no count on the head").not.toMatch(/bp-shelf-head[\s\S]{0,300}?\{n\}/);
  });

  // The head already says the area in full. Printing it again on every tile
  // gave "Elite Squ..." under a head reading "Elite Squad".
  it("does not repeat the area name inside the card", () => {
    expect(CARD).not.toMatch(/areaName/);
    expect(CARD).not.toMatch(/bp-card-area/);
    expect(PAGE).not.toMatch(/areaName=/);
  });

  // MEASURED. The title took whatever the card had left and clamped at three
  // lines -- but a 160pt tile has room for two, so the clamp never fired and
  // the browser sliced the third line through the middle of the letters. Two
  // lines of room, exactly, is what lets the ellipsis happen instead.
  it("gives the title exactly two lines, so it ellipses instead of slicing", () => {
    expect(RULED).toMatch(/\.ruled \.bp-card-title \{[\s\S]{0,400}?max-height: calc\(var\(--t-card-title\) \* 1\.12 \* 2\)/);
    expect(RULED).toMatch(/\.ruled \.bp-card-title \{[\s\S]{0,500}?-webkit-line-clamp: 2;/);
    expect(RULED, "and the foot anchors to the bottom whatever the title did")
      .toMatch(/\.ruled \.bp-card-foot \{[^{}]*margin-top: auto;/);
  });

  // "Black is not an option change it." A slot with no rule of its own left
  // --bp-a empty, the gradient dropped out, and the card was the page's own
  // ground with white text on it. The base rule carries the neutral pair now,
  // so a slot invented tomorrow still draws a card.
  it("can never draw a card with no colour at all", () => {
    expect(RULED).toMatch(/\.ruled \.bp-card \{[\s\S]{0,1600}?--bp-a: #6D6D73; --bp-b: #2E2E33;/);
  });

  it("lays the cards out as one sideways row", () => {
    expect(RULED).toMatch(/\.ruled \.bp-grid \{[^{}]*display: flex;[^{}]*overflow-x: auto;/);
    expect(RULED, "and it snaps, so a flick lands on a card")
      .toMatch(/\.ruled \.bp-grid \{[^{}]*scroll-snap-type: x/);
    expect(RULED, "the tile carries its own width").toMatch(/\.ruled \.bp-card \{[\s\S]{0,1600}?width: calc\(160px \* var\(--type-scale\)\)/);
  });

  // "Make them shorter too so there isn't a massive gap in the cards."
  // aspect-ratio held every tile at 160 tall whatever it held, so a card with
  // no next action carried 38px of hole between its title and its count.
  // MEASURED: the same shelf is 140 tall now, and the worst gap is one
  // missing line instead of a third of the tile.
  it("takes its height from what it holds, not from a square", () => {
    const card = RULED.slice(RULED.indexOf(".ruled .bp-card {"), RULED.indexOf(".ruled .bp-card::before"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(card, "no square to pad out").not.toMatch(/aspect-ratio/);
    expect(card, "and no floor to pad it out either").not.toMatch(/min-height/);
    expect(RULED, "a one-line title costs one line")
      .toMatch(/\.ruled \.bp-card-title \{[\s\S]{0,400}?max-height: calc\(var\(--t-card-title\) \* 1\.12 \* 2\)/);
  });

  // The peek is what tells you it scrolls, and max-width is what protects it:
  // at 1.4 text on a 320px phone the scaled width would otherwise fill the
  // screen and the next card would vanish.
  it("keeps the next card peeking at every text size", () => {
    expect(RULED).toMatch(/\.ruled \.bp-card \{[\s\S]{0,1600}?max-width: 76%;/);
  });

  // "Just make sure there's an arrow so users know." Not a painted chevron:
  // a button, labelled, and present only when there is room that way -- which
  // means it has to be measured rather than assumed from a count.
  it("puts a real arrow on the shelf, driven by what actually fits", () => {
    expect(CARD, "the arrow is a button").toMatch(/className="bp-shelf-arrow bp-shelf-arrow-r"/);
    expect(CARD, "and it says what it does").toMatch(/aria-label="Scroll for more"/);
    expect(CARD, "one back, once there is a back").toMatch(/aria-label="Scroll back"/);
    expect(CARD, "shown from measurement, not from item count")
      .toMatch(/el\.scrollWidth - el\.clientWidth/);
    expect(CARD, "and it moves the shelf").toMatch(/el\.scrollBy\(\{ left: dir/);
  });

  // EVERY COLOUR THE PICKER OFFERS GETS A CARD. The first draft wrote thirteen
  // rules against a twenty-four slot palette, so an area coloured violet or
  // mint drew a card with no gradient at all -- white text on nothing.
  it("gives every category slot its two stops", () => {
    const from = TYPES.indexOf("export const COLOR_SLOTS");
    const slots = TYPES.slice(from, TYPES.indexOf("];", from));
    const names = [...slots.matchAll(/"([a-z]+)",/g)].map((m) => m[1]);
    expect(names.length, "the palette is read from its own source").toBeGreaterThan(20);
    for (const s of [...names, "red"]) {
      expect(RULED, s + " has no card colour").toMatch(
        new RegExp("\\.ruled \\.bp-card-" + s + " \\{ --bp-a: #[0-9A-F]{6}; --bp-b: #[0-9A-F]{6}; \\}"),
      );
    }
  });

  // "I want the coloring and shading identical to the pic I sent." His four
  // areas were plane-fit off the image corner to corner; these are the numbers
  // that came back, and the axis with them. They are not derived from the
  // category tokens and cannot be -- his teal is H180 S37, the token is H189
  // S72 -- so nothing here may be "simplified" back into a color-mix.
  it("carries the sampled pairs exactly, on the sampled axis", () => {
    expect(RULED).toContain(".ruled .bp-card-teal { --bp-a: #4EABAB; --bp-b: #1C4744; }");
    expect(RULED).toContain(".ruled .bp-card-blue { --bp-a: #438AF8; --bp-b: #0E268D; }");
    expect(RULED).toContain(".ruled .bp-card-purple { --bp-a: #703EE5; --bp-b: #2E1171; }");
    expect(RULED).toContain(".ruled .bp-card-green { --bp-a: #58BF71; --bp-b: #1B452C; }");
    expect(RULED).toMatch(/linear-gradient\(153deg, var\(--bp-a\) 0%, var\(--bp-b\) 100%\)/);
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
