// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { rankStream, FAILING, WAITING, NEW, RESUME } from "./stream";
import NoticeCard from "./NoticeCard";
import { Quiet } from "./quiet";
import { cloneElement } from "react";

const card = (key: string, weight: number, title: string) => (
  <NoticeCard key={key} weight={weight} icon={<span />} title={title} action={{ label: "Go", onClick: () => {} }} />
);

// LAW 3E: form follows decision. One headliner, verb rows, receipts.
describe("the stream ranks", () => {
  it("exactly one headliner: the heaviest; failing beats waiting beats new", () => {
    const r = rankStream([
      card("a", NEW, "New Thing"),
      card("b", FAILING, "Failing Thing"),
      card("c", WAITING, "Waiting Thing"),
      card("d", RESUME, "Resume Thing"),
    ]);
    expect((r.headliner!.props as { title: string }).title).toBe("Failing Thing");
    expect(r.rows.map((x) => (x.props as { title: string }).title)).toEqual([
      "Waiting Thing", "New Thing", "Resume Thing",
    ]);
  });

  it("[edge] ties keep the producer's own order", () => {
    const r = rankStream([card("a", FAILING, "First"), card("b", FAILING, "Second")]);
    expect((r.headliner!.props as { title: string }).title).toBe("First");
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
