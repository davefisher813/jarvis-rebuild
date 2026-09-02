import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slidingLine } from "./lifecycle";

// THE KEEPS SLIDING ROW (Fewer Buttons, Dave 2026-09-02: "I don't like all
// those floating buttons"). The First Step offer was a card floating above
// the list (08-31: "the big task up top actually doesn't render as such");
// it is the list's first row now, the notice row the one ask on Goals
// wears. Source-pinned because the flow needs a provider stack to mount;
// the rendered look is verified by the screen renders. What must stay
// true: both states are the stacked notice row in the stalled tone, the
// row says why it exists on its second line, the answer state puts the
// step in the name slot with the task demoted to a For: line, and the row
// is handed to the page as its notice, never rendered above the list.
describe("The Keeps Sliding row", () => {
  const src = readFileSync(join(__dirname, "TasksFlow.tsx"), "utf8");
  const notice = src.slice(src.indexOf("const fsNotice"), src.indexOf(") : null;", src.indexOf("const fsNotice")));

  it("both states are the stacked notice row in the stalled tone", () => {
    expect(notice.match(/<NoticeCard/g)?.length).toBe(2);
    expect(notice.match(/form="card"/g)?.length).toBe(2);
    expect(notice.match(/tone="cat-fg-orange"/g)?.length).toBe(2);
    expect(notice.match(/onDismiss=\{fsDismiss\}/g)?.length).toBe(2);
  });

  it("the stalled state names the task and says why; the answer state leads with the step", () => {
    expect(notice).toContain("title={fsCandidate.data.text}");
    expect(notice).toContain("sub={slidingLine(fsCandidate, today)}");
    expect(notice).toContain("title={fsStep.step}");
    expect(notice).toContain('sub={"First step for: " + fsCandidate.data.text}');
  });

  it("the old card anatomy stays gone, and the row is the page's notice", () => {
    expect(notice).not.toContain("fs-card");
    expect(notice).not.toContain("eyebrow");
    expect(notice).not.toContain("fs-title");
    expect(src).toContain("notice={fsNotice}");
    expect(src).not.toContain("banner=");
  });

  it("the why line states the fact that qualified the task", () => {
    expect(slidingLine({ id: "a", data: { text: "x", category: "", done: false, due: "2026-08-25" } }, "2026-09-02")).toBe("Keeps sliding \u00b7 8 days late");
    expect(slidingLine({ id: "a", data: { text: "x", category: "", done: false, due: "2026-09-01", slips: 3 } }, "2026-09-02")).toBe("Keeps sliding \u00b7 Pushed 3 times");
    expect(slidingLine({ id: "a", data: { text: "x", category: "", done: false, due: null } }, "2026-09-02")).toBe("Keeps sliding");
  });
});
