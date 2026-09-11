import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slidingLine, SLIDING_TAG } from "./lifecycle";

// THE KEEPS SLIDING ROW (Fewer Buttons, Dave 2026-09-02: "I don't like all
// those floating buttons"). The First Step offer was a card floating above
// the list (08-31: "the big task up top actually doesn't render as such");
// it became the list's first row, the notice row the one ask on Goals
// wears. Then the second half (Dave 2026-09-02, same day: "'email Danielle'
// shows up twice, kill the bug"): a notice row ABOUT the task beside the
// task's own row is the task twice. The offer is the task's own row now,
// hoisted first (TasksPage `stalled`), the sliding line in the warning ink
// and First Step in place of Start. Only the ANSWER state keeps a notice
// row, because the drafted step is a new thing, not the task. Source-pinned
// because the flow needs a provider stack to mount.
describe("The Keeps Sliding row", () => {
  const src = readFileSync(join(__dirname, "TasksFlow.tsx"), "utf8");
  const notice = src.slice(src.indexOf("const fsNotice"), src.indexOf(") : null;", src.indexOf("const fsNotice")));
  const stalled = src.slice(src.indexOf("const fsStalled"), src.indexOf(": null;", src.indexOf("const fsStalled")));

  it("the offer is the task's own row: its id, the sliding line, First Step as the pill", () => {
    expect(stalled).toContain("id: fsCandidate.id");
    expect(stalled).toContain("tag: SLIDING_TAG");
    expect(stalled).toContain("line: slidingLine(fsCandidate, today)");
    expect(stalled).toMatch(/label: fsBusy \? "Thinking\.\.\." : "First Step"/);
    expect(stalled, "the offer never renders as a notice row").not.toContain("<NoticeCard");
    expect(src).toContain("stalled={fsStalled}");
  });

  it("only the answer state is a notice row, in the stalled tone, leading with the step", () => {
    expect(notice.match(/<NoticeCard/g)?.length).toBe(1);
    expect(notice).toContain('form="card"');
    expect(notice).toContain('tone="cat-fg-orange"');
    expect(notice).toContain("onDismiss={fsDismiss}");
    expect(notice).toContain("title={fsStep.step}");
    expect(notice).toContain('sub={"First step for: " + fsCandidate.data.text}');
    expect(notice, "the offer state is gone from the notice").not.toContain("title={fsCandidate.data.text}");
  });

  it("the page pulls the stalled task out of its group and renders it once, first", () => {
    const page = readFileSync(join(__dirname, "screens", "TasksPage.tsx"), "utf8");
    expect(page).toMatch(/groupItems\(stalledItem \? items\.filter\(\(it\) => it\.id !== stalledItem\.id\) : items/);
    expect(page).toMatch(/\{gi === 0 && stalledRow\}/);
    expect(page).toMatch(/tag=\{stalled\.tag\} kicker=\{stalled\.line\} kickerTone="stalled" action=\{stalled\.action\}/);
  });

  it("the old card anatomy stays gone, and the row is the page's notice", () => {
    expect(notice).not.toContain("fs-card");
    expect(notice).not.toContain("eyebrow");
    expect(notice).not.toContain("fs-title");
    expect(src).toContain("notice={fsNotice}");
    expect(src).not.toContain("banner=");
  });

  // LIFE-F-24 (2026-09-05): the drafted step inherited the area but not the
  // project, so a first step for a project's stalled task landed on Today
  // filed nowhere and the project still read stalled. Source-pinned like the
  // rest of this file: the accept path needs the whole provider stack.
  it("the accepted step is filed under the same project as the task it opens", () => {
    const accept = src.slice(src.indexOf("const fsAccept"), src.indexOf("const fsDismiss"));
    expect(accept).toContain("projectId: fsCandidate.data.projectId");
  });

  // TWO THINGS, TWO WEIGHTS (Dave 2026-09-11: "Keep sliding and pushed 8 times
  // should not be identical styling wise"). The label is the chip (SLIDING_TAG,
  // rendered as .slide-tag) and the evidence is the line beside it, so the
  // function returns the evidence alone and nothing when there is none.
  it("the why line states the fact that qualified the task, without the label", () => {
    expect(SLIDING_TAG).toBe("Keeps Sliding");
    expect(slidingLine({ id: "a", data: { text: "x", category: "", done: false, due: "2026-08-25" } }, "2026-09-02")).toBe("8 Days late");
    expect(slidingLine({ id: "a", data: { text: "x", category: "", done: false, due: "2026-09-01", slips: 3 } }, "2026-09-02")).toBe("Pushed 3 times");
    expect(slidingLine({ id: "a", data: { text: "x", category: "", done: false, due: null } }, "2026-09-02")).toBe(null);
  });
});
