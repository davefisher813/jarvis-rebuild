// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { rankStream, FAILING, DEALT, WAITING, NEW, RESUME, AMBIENT } from "./stream";
import NoticeCard from "./NoticeCard";
import { Quiet } from "./quiet";
import { cloneElement } from "react";

const card = (key: string, weight: number, title: string) => (
  <NoticeCard key={key} weight={weight} icon={<span />} title={title} action={{ label: "Go", onClick: () => {} }} />
);

// LAW 3E: form follows decision. Verb rows and receipts. The headliner was
// retired 2026-08-25 (Dave: "They should all be the size of update workout
// feature"): ORDER carries the emphasis it was buying, at no height.
describe("the stream ranks", () => {
  it("puts the heaviest first; failing beats waiting beats new", () => {
    const r = rankStream([
      card("a", NEW, "New Thing"),
      card("b", FAILING, "Failing Thing"),
      card("c", WAITING, "Waiting Thing"),
      card("d", RESUME, "Resume Thing"),
    ]);
    expect(r.headliner).toBeNull();
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual([
      "Failing Thing", "Waiting Thing", "New Thing", "Resume Thing",
    ]);
  });

  // The ranking still has to be a ranking. Retiring the big shape must not
  // quietly retire the ORDER, which is now the only thing carrying it.
  it("never promotes anything to a headliner any more", () => {
    const r = rankStream([card("a", FAILING, "One"), card("b", NEW, "Two"), card("c", WAITING, "Three")]);
    expect(r.headliner).toBeNull();
    expect(r.rows).toHaveLength(3);
  });

  it("[edge] ties keep the producer's own order", () => {
    const r = rankStream([card("a", FAILING, "First"), card("b", FAILING, "Second")]);
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual(["First", "Second"]);
  });

  // SPEC MOVED (Dave 2026-08-22): a lone notice no longer headlines. Big
  // type exists to beat other notices; alone, it renders as a row. Receipts
  // are whispers, not competition, so they do not promote a lone notice.
  it("a lone notice is a row, not a headliner", () => {
    const r = rankStream([card("a", FAILING, "Finish Jarvis Visuals")]);
    expect(r.headliner).toBeNull();
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual(["Finish Jarvis Visuals"]);
  });

  it("receipts never compete for the headline, and never promote one", () => {
    const r = rankStream([
      <button key="r" data-receipt className="receipt-line">Moved things</button>,
      card("a", NEW, "Actionable"),
    ]);
    expect(r.headliner).toBeNull();
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual(["Actionable"]);
    expect(r.receipts.length).toBe(1);
  });

  it("[edge] an empty stream has no headliner", () => {
    const r = rankStream([]);
    expect(r.headliner).toBeNull();
    expect(r.rows).toEqual([]);
  });

  // SOUNDNESS PASS (2026-08-26, Dave: "the logic behind all of this needs to
  // be sound"). The dealt task leading its band used to be true only because
  // Your Move spliced it first into the array handed to rankStream, winning
  // the arrival-order tie-break. That is a fact about ONE caller's code, not
  // a fact this function guarantees. DEALT makes it a real weight comparison:
  // built here with the dealt element placed LAST and still landing first,
  // which the old array-order trick could never have produced.
  //
  // These two also mark the dealt fixture `anchor: true` now, matching
  // what StreamMember actually passes in TodayPage.tsx. With only WAITING
  // (below DEALT) or only FAILING (above DEALT) in the mix, anchor and
  // plain weight order agree, so these two do not yet prove the anchor
  // mechanism itself -- the "wedged" tests below do that.
  it("the dealt task leads WAITING regardless of where it sits in the array", () => {
    const r = rankStream([
      card("bill", WAITING, "Rent Due Friday"),
      card("report", WAITING, "Your July Is Ready"),
      cloneElement(card("dealt", DEALT, "Brainstorm For App Design"), { anchor: true }),
    ]);
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual([
      "Brainstorm For App Design", "Rent Due Friday", "Your July Is Ready",
    ]);
  });

  it("FAILING still beats the dealt task -- a sliding day outranks any single move", () => {
    const r = rankStream([
      cloneElement(card("dealt", DEALT, "The Move"), { anchor: true }),
      card("fail", FAILING, "Day Is Sliding"),
    ]);
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual(["Day Is Sliding", "The Move"]);
  });

  // AN ANCHOR NEVER WEDGES (2026-08-26, Dave's screenshot: a FAILING notice
  // above, a lighter notice below, the dealt task pinned in the middle --
  // "I don't want a task wedged in between 2 arrows"; resolved as "task
  // leads, urgent notices can still jump it"). Reproduced here exactly:
  // FAILING outranks DEALT, NEW does not. A naive per-element check ("does
  // THIS notice outrank the anchor?") would leave FAILING above and NEW
  // below, putting the anchor right back in the middle. It has to move as
  // one block.
  it("[edge] one heavier notice pulls the whole block above the anchor, not just itself", () => {
    const r = rankStream([
      cloneElement(card("dealt", DEALT, "The Move"), { anchor: true }),
      card("fail", FAILING, "Day Is Sliding"),
      card("new", NEW, "3 Moved to Today"),
    ]);
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual([
      "Day Is Sliding", "3 Moved to Today", "The Move",
    ]);
  });

  // Stronger than the above: WAITING sits only ONE point below DEALT, the
  // closest a non-anchor weight gets without tying it, so this is the case
  // most likely to survive a bug that only moves elements strictly heavier
  // than the anchor. It still has to ride up with FAILING and NEW, sorted
  // among themselves, because the rule is "does anything outrank the
  // anchor", not "does this element outrank the anchor".
  it("[edge] a notice lighter than the anchor still rides up with the ones that outrank it", () => {
    const r = rankStream([
      cloneElement(card("dealt", DEALT, "The Move"), { anchor: true }),
      card("wait", WAITING, "Rent Due Friday"),
      card("fail", FAILING, "Day Is Sliding"),
      card("new", NEW, "3 Moved to Today"),
    ]);
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual([
      "Day Is Sliding", "Rent Due Friday", "3 Moved to Today", "The Move",
    ]);
  });

  it("[edge] with nothing to outrank it the anchor leads, and the rest still sort by weight behind it", () => {
    const r = rankStream([
      card("new", NEW, "3 Moved to Today"),
      cloneElement(card("dealt", DEALT, "The Move"), { anchor: true }),
      card("resume", RESUME, "Pick Up Report"),
    ]);
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual([
      "The Move", "3 Moved to Today", "Pick Up Report",
    ]);
  });

  // AMBIENT sits below the ranker's own DEFAULT_WEIGHT fallback (an
  // unweighted card, which is always a bug -- nothing ships one on purpose):
  // deliberately the least urgent thing in the stream ranks below an
  // accident, never above it.
  it("[edge] AMBIENT sinks below an unweighted (default-weight) member", () => {
    const r = rankStream([
      card("weather", AMBIENT, "Add Weather to Your Day"),
      <NoticeCard key="mystery" icon={<span />} title="No Weight Declared" action={{ label: "Go", onClick: () => {} }} />,
    ]);
    expect(r.rows.map((x) => (x.props as { title?: string }).title)).toEqual([
      "No Weight Declared", "Add Weather to Your Day",
    ]);
  });
});

describe("the three forms", () => {
  it("headliner: big title, verbs as visible capsules including the alt", () => {
    const alt = vi.fn();
    render(cloneElement(
      <NoticeCard icon={<span />} title="Finish Jarvis Visuals" sub="Slid 3d" heat="warm"
        action={{ label: "Break It Down", onClick: () => {} }} alt={{ label: "Not Today", onClick: alt }} />,
      { form: "headliner" },
    ));
    expect(document.querySelector(".hl-title")!.textContent).toBe("Finish Jarvis Visuals");
    fireEvent.click(screen.getByText("Not Today"));
    expect(alt).toHaveBeenCalled();
  });

  // THE TIGHT HEADLINER (2026-08-22). Its height came from the sub sitting
  // on a line of its own under the title; the title's own line is the part
  // that earns its keep, because it is what stops a real task title
  // truncating beside its verb.
  it("headliner: the title owns its line, the sub rides beside the verb", () => {
    render(cloneElement(
      <NoticeCard icon={<span />} tone="cat-fg-orange" title="Check on Bridge Admin Costs" sub="Slid 4d"
        action={{ label: "Break It Down", onClick: () => {} }} />,
      { form: "headliner" },
    ));
    // The title is alone in the top band: no sub, no verb sharing its line.
    const top = document.querySelector(".notice-hl")!;
    expect(top.querySelector(".hl-title")!.textContent).toBe("Check on Bridge Admin Costs");
    expect(top.querySelector(".conn-meta")).toBeNull();
    expect(top.querySelector("button")).toBeNull();
    // The foot carries both: sub on the left, verb on the right.
    const foot = document.querySelector(".hl-acts")!;
    expect(foot.querySelector(".hl-sub")!.textContent).toContain("Slid");
    expect(foot.querySelector("button")!.textContent).toBe("Break It Down");
  });

  it("headliner: the lead wears the category tile the rows wear", () => {
    render(cloneElement(
      <NoticeCard icon={<span />} tone="cat-fg-orange" title="A Thing" sub="x"
        action={{ label: "Go", onClick: () => {} }} />,
      { form: "headliner" },
    ));
    // The tone is a foreground class everywhere else; the tile fills with it.
    expect(document.querySelector(".hl-tile")!.className).toContain("cat-bg-orange");
  });

  it("[edge] a headliner with no sub still renders its verb", () => {
    render(cloneElement(
      <NoticeCard icon={<span />} title="No Sub Here" action={{ label: "Go", onClick: () => {} }} />,
      { form: "headliner" },
    ));
    expect(document.querySelector(".hl-sub")).toBeNull();
    expect(document.querySelector(".hl-acts button")!.textContent).toBe("Go");
  });

  it("row: one line, fact plus capsule; the sub rides inline", () => {
    render(cloneElement(
      <NoticeCard icon={<span />} title="10 Moved to Today" sub="No times yet"
        action={{ label: "Plan Them", onClick: () => {} }} />,
      { form: "row" },
    ));
    expect(document.querySelector(".notice-vrow")).toBeTruthy();
    expect(document.querySelector(".vrow-sub")!.textContent).toBe("No times yet");
    expect(document.querySelector(".hl-title")).toBeNull();
  });

  it("a row with more to it expands to the full card on tap", () => {
    render(cloneElement(
      <NoticeCard icon={<span />} title="Wei Chen" sub="59d waiting"
        action={{ label: "Draft It", onClick: () => {} }}
        foot={<div className="mail-chips">chips</div>} />,
      { form: "row" },
    ));
    fireEvent.click(document.querySelector(".notice-vrow")!);
    expect(document.querySelector(".notice-vrow")).toBeNull();
    expect(screen.getByText("chips")).toBeInTheDocument();
  });

  it("[edge] a plain row with only onOpen opens directly instead of expanding", () => {
    const open = vi.fn();
    render(cloneElement(
      <NoticeCard icon={<span />} title="A Thing" onOpen={open} />,
      { form: "row" },
    ));
    fireEvent.click(document.querySelector(".notice-vrow")!);
    expect(open).toHaveBeenCalled();
  });
});

describe("the quiet line", () => {
  it("data pops, words whisper", () => {
    render(<div data-testid="q"><Quiet s="Slid 3d · 6/17 by night" /></div>);
    const bright = [...document.querySelectorAll(".qd")].map((e) => e.textContent);
    expect(bright).toEqual(["3d", "6/17"]);
  });

  it("heat lands on the data only, and only when the producer says so", () => {
    render(<div><Quiet s="59d waiting" heat="hot" /></div>);
    expect(document.querySelector(".qd-hot")!.textContent).toBe("59d");
    expect(document.body.textContent).toContain("waiting");
  });

  it("[edge] a sub with no data renders as plain words", () => {
    render(<div data-testid="p"><Quiet s="No times yet" /></div>);
    expect(document.querySelector(".qd")).toBeNull();
    expect(screen.getByTestId("p").textContent).toBe("No times yet");
  });
});
