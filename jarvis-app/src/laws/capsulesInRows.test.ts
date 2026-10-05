// @vitest-environment jsdom
// THE LAW THAT KEEPS THE ROW MODEL CLEAN, PROVED ON HAND-BUILT MARKUP (Dave 2026-10-05, locked: "Clean rows, no pills
// anywhere"). laws/catalogSetup.ts runs `capsulesInRows` on everything every jsdom test draws and fails the test that
// draws a capsule in a list row or at the foot of a list card, unless the file is on the roster. This file shows the
// check itself still sees what it is for, and still leaves alone the settled homes, so a refactor of the selectors that
// quietly blinds it fails HERE and not in the next screen's pull request.
//
// The markup is built on a DETACHED element and never attached to the document, so the setup's observer (which watches
// document.body) does not see it: these violations are made on purpose and must not fail this file.
import { describe, it, expect } from "vitest";
import { capsuleSites, capsulesInRows, CAPSULE_HOMES, CAPSULE_ROW } from "./catalogCheck";
import { CAPSULE_ROSTER } from "./catalogRoster";

function tree(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}
const found = (html: string) => capsulesInRows(tree(html));

describe("capsulesInRows: no capsule in a list row, none at the foot of a list card", () => {
  it("fails a capsule inside every kind of list row", () => {
    for (const row of ["task-row", "rem-row", "rem-card", "sched-row", "lib-row", "conn", "msg-row", "anytime-row", "offer-row"]) {
      for (const cap of ["pill-act", "row-act", "btn-sm", "quiet-action"]) {
        expect(found(`<div class="card"><div class="${row}"><span>Title</span><button class="${cap}">Snooze</button></div></div>`),
          `a .${cap} inside .${row}`).toEqual([`Snooze @ ${row}`]);
      }
    }
  });

  it("fails a .row inside a .list-card-ruled, and only there", () => {
    expect(found(`<div class="card list-card-ruled"><div class="row"><button class="pill-act">Clear</button></div></div>`)).toEqual(["Clear @ row"]);
    // A bare .row in a plain .card is a settings-style row, which the wide net (capsulesInCards) covers, not this law.
    expect(found(`<div class="card"><div class="row"><button class="pill-act">Clear</button></div></div>`)).toEqual([]);
  });

  it("fails a capsule at the foot of a list card, outside any row", () => {
    expect(found(`<div class="card"><div class="task-row">One</div><div class="task-row">Two</div><button class="row-act">Add a Task</button></div>`))
      .toEqual(["Add a Task @ foot of card"]);
    expect(found(`<div class="card list-card-ruled"><div class="row">One</div><div class="row row-act"><span>Add Item</span></div></div>`))
      .toEqual(["Add Item @ row"]);
  });

  it("names the capsule by its aria-label when it has no words", () => {
    expect(found(`<div class="task-row"><button class="pill-act" aria-label="Open the thing"></button></div>`)).toEqual(["Open the thing @ task-row"]);
  });

  it("leaves a lone capsule in a card with no rows alone (that is the empty-box law's job)", () => {
    expect(found(`<div class="card"><button class="row-act">Add a Reminder</button></div>`)).toEqual([]);
  });

  it("leaves every settled home alone, even when a row is beside it or around it", () => {
    const homes: Array<[string, string]> = [
      ["a section head", `<div class="sh2"><span class="t">Tasks</span><button class="see-all pill-action pill-act">Add</button></div>`],
      ["a sheet bar", `<div class="sheet-bar"><button class="quiet-action">Cancel</button></div>`],
      ["a sheet foot", `<div class="sheet-foot"><button class="pill-act">Save</button></div>`],
      ["an action sheet", `<div class="action-sheet"><button class="pill-act">Snooze</button></div>`],
      ["a notice card", `<div class="card notice-card"><div class="row"><button class="pill-act">Allow</button></div></div>`],
      ["a notice card's action line", `<div class="notice-actions"><button class="pill-act">Keep</button></div>`],
      ["a promo card", `<div class="promo-card"><div class="row"><button class="pill-act">Try It</button></div></div>`],
      ["a toast", `<div class="toast"><button class="quiet-action">Undo</button></div>`],
      ["the goal check-in card", `<div class="card pad"><div class="dec-outcome-acts"><button class="pill-act">Ahead</button><button class="pill-act">Behind</button></div></div>`],
      ["the reminder Advice strip", `<div class="row xs-strip"><button class="pill-act">Change Time</button></div>`],
      ["the rest timer", `<div class="card pad"><div class="rest-acts"><button class="pill-act">Skip Rest</button></div></div>`],
      ["an empty state with its own title", `<div class="card"><div class="empty-state"><div class="empty-title">No Matches</div><button class="quiet-action">Clear the Search</button></div></div>`],
    ];
    for (const [what, html] of homes) {
      // The row beside the home is what would make a stray capsule at a foot a violation; the home must still pass.
      expect(found(`<div class="card list-card-ruled"><div class="task-row">Row</div>${html}</div>`), what).toEqual([]);
    }
  });

  it("a head's capsule next to rows is fine, and the same capsule on the row is not", () => {
    expect(found(`<div class="card list-card-ruled"><div class="sh2"><button class="pill-act">Add</button></div><div class="task-row">One</div></div>`)).toEqual([]);
    expect(found(`<div class="card list-card-ruled"><div class="task-row">One<button class="pill-act">Add</button></div></div>`)).toEqual(["Add @ task-row"]);
  });

  it("reports where a capsule sits, for the roster and the measurement", () => {
    const sites = capsuleSites(tree(`<div class="pad-x"><div class="card list-card-ruled"><div class="row"><button class="btn-sm">Yes</button></div></div></div>`));
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ label: "Yes", where: "row", box: "row" });
    expect(sites[0]!.chain.startsWith("row < card < pad-x")).toBe(true);
  });

  it("keeps the selectors it is documented to have", () => {
    for (const sel of [".task-row", ".rem-row", ".rem-card", ".sched-row", ".lib-row", ".conn", ".list-card-ruled .row"]) expect(CAPSULE_ROW).toContain(sel);
    for (const sel of [".sh2", ".sheet-bar", ".sheet-foot", ".action-sheet", ".notice-card", ".promo-card", ".toast"]) expect(CAPSULE_HOMES).toContain(sel);
  });

  it("every roster entry says why", () => {
    for (const [file, entries] of Object.entries(CAPSULE_ROSTER)) {
      for (const [finding, why] of Object.entries(entries)) {
        expect(why.length, `${file}: ${finding} needs a real reason`).toBeGreaterThan(30);
        expect(finding, `${file}: a finding reads "label @ where"`).toMatch(/ @ /);
      }
    }
  });
});
