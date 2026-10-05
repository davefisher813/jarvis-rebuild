// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import NoticeCard from "./NoticeCard";

// ROUND 3 OF THE VISUAL REVIEW, TODAY'S DEFECTS (Dave 2026-10-05: "Everything should look PERFECT"). Each case fails without its fix.
const SRC = join(__dirname, "..");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const css = () => read("styles/components.css");
const noop = () => {};

// Every declaration of every rule whose selector list is exactly `sel`, joined (a selector may be declared in several places).
const rule = (text: string, sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const all = [...text.matchAll(new RegExp("(?:^|\\}|\\*\\/)[ \\t]*" + esc + "\\s*\\{([^}]*)\\}", "gm"))];
  return all.map((m) => m[1]!).join(" ");
};

describe("a stacked offer is one clean block, aligned to its own text", () => {
  const offer = () => render(
    <NoticeCard offer stack uniform={false} icon={<span />} tone="cat-fg-teal" title="Connect Your Inbox"
      sub="Real Mail Replaces These Samples" action={{ label: "Connect Google", onClick: noop }} onOpen={noop} />,
  );

  it("draws no chevron beside a capsule that is already the action", () => {
    const { container } = offer();
    expect(container.querySelector(".chev"), "the capsule is the action; a chevron offers it twice").toBeNull();
  });

  it("puts the capsule on the title's edge with an empty glyph in front, not full bleed", () => {
    const { container } = offer();
    const stack = container.querySelector(".notice-stack")!;
    expect(stack.children[0]).toHaveClass("row-glyph");
    expect(stack.children[1]).toHaveClass("pill-act");
    const body = rule(css(), ".notice-stack");
    expect(body, "the card's own padding, not the old 8px inset").toMatch(/padding:\s*0 var\(--s-4\)/);
    expect(body).toMatch(/gap:\s*var\(--s-3\)/);
  });

  it("wears the one 30px rounded-square tile, never a circle", () => {
    expect(rule(css(), ".notice-card .notice-disc")).toMatch(/border-radius:\s*var\(--r-sm\)/);
  });
});

describe("the peeking row shows its whole first action", () => {
  it("peeks by one 88px well, never 40% of a label", () => {
    expect(read("shared/useSwipe.ts")).toMatch(/moveTo\(-Math\.min\(revealW, 88\)\)/);
    expect(read("shared/useSwipe.ts")).not.toMatch(/revealW \* 0\.4/);
  });
});

describe("the revisit decision's outcome row", () => {
  const flow = read("today/TodayFlow.tsx");
  const foot = flow.slice(flow.indexOf("THE OUTCOME IS ONE QUESTION"), flow.indexOf("sweepReceipt && sweepReceipt.failed"));

  it("is a question over one segmented control, on the text edge, with no loose capsule", () => {
    expect(foot).toMatch(/How Did It Go\?/);
    expect(foot).toMatch(/className="segmented"/);
    expect(foot).toMatch(/className="row hl-verbs notice-foot-acts"/);
    expect(foot).toMatch(/className="row-glyph" aria-hidden="true"/);
    expect(foot, "no pill inside the card").not.toMatch(/pill-act/);
  });

  it("keeps its segments at 44px inside the card's padding, in the one tile column", () => {
    expect(rule(css(), ".notice-foot-ask .segmented .seg")).toMatch(/min-height:\s*var\(--tap-min\)/);
    expect(rule(css(), ".notice-foot-ask")).toMatch(/padding-right:\s*var\(--s-4\)/);
    expect(css()).toMatch(/\.stream-grouped \.notice-card:not\(\.notice-card-row\) > \.row > \.notice-disc \{ margin: 0 var\(--s-2\); border-radius: var\(--r-sm\); \}/);
  });
});

describe("a fold on the page's ground lines its chevron up with the cards above", () => {
  it("reserves the card gutter plus the card's own padding on the right", () => {
    expect(rule(css(), ".receipt-line")).toMatch(/padding:\s*var\(--s-1\) var\(--s-9\) 0 var\(--s-4\)/);
    // ...and a fold INSIDE a card or an inset block keeps the plain gutter.
    expect(css()).toMatch(/\.pad-x > \.receipt-line, \.card \.receipt-line \{ padding-right: var\(--s-4\); \}/);
  });
});

describe("The Whole Day is a head like the others", () => {
  it("draws the dotted rule to the edge", () => {
    expect(rule(css(), ".day-band")).toMatch(/display:\s*flex/);
    expect(rule(css(), ".day-band::after")).toMatch(/border-top:\s*1px dotted var\(--divider\)/);
  });
});

describe("the band over the mail names where its rows came from", () => {
  it("falls back to From Your Inbox, not Ready to Send (it also holds a suggestion and a task)", () => {
    const page = read("today/TodayPage.tsx");
    expect(page).toMatch(/mailHead\?\.title \?\? "From Your Inbox"/);
    expect(page).not.toMatch(/\?\? "Ready to Send"/);
  });
});

describe("one meeting row of Now opens, and says what is open", () => {
  it("the prep row has its chevron and counts open items", () => {
    const flow = read("today/TodayFlow.tsx");
    expect(flow).toMatch(/\{prep\.open\.length === 1 \? "Open Item" : "Open Items"\} With Them/);
    const prepRow = flow.slice(flow.indexOf("{prep && ("), flow.indexOf("</SwipeShell>", flow.indexOf("{prep && (")));
    expect(prepRow).toMatch(/<div className="chev" \/>/);
  });
});

describe("a sender's initial has no colour of its own", () => {
  it("is one neutral face whatever hue slot its class carries", () => {
    const rows = readFileSync(join(SRC, "styles/mail-rows.css"), "utf8");
    expect(rows).toMatch(/\.mface\.mface\[class\*="cat-bg-"\] \{ background: var\(--press-5\); color: var\(--tx-1\); \}/);
  });
});

describe("floating chrome keeps its distance from the dock", () => {
  it("the return pill's painted capsule stands at least 8px above the capture bar", () => {
    const pill = rule(css(), ".return-pill");
    expect(pill).toMatch(/margin-bottom:\s*var\(--s-1\)/);
    // 5px of the 44px box is unpainted on the bottom, plus 4px of margin: 9px clear.
    expect(rule(css(), ".return-pill::before")).toMatch(/inset:\s*5px 0/);
  });
});

describe("a row expands into its card without losing its tile", () => {
  it("a notice with a foot opens in place and keeps one disc", () => {
    const { container, getByText } = render(
      <NoticeCard form="row" icon={<span />} tone="cat-fg-purple" title="A Decision" action={{ label: "Keep", onClick: noop }}
        alt={{ label: "Change It", onClick: noop }} onOpen={noop} foot={<div className="foot-probe">foot</div>} />,
    );
    fireEvent.click(getByText("A Decision"));
    expect(container.querySelectorAll(".notice-disc")).toHaveLength(1);
    expect(container.querySelector(".foot-probe")).not.toBeNull();
  });
});

describe("the month report's hours strip has the height to show a peak", () => {
  it("is 56px of bars, not 30", () => {
    expect(rule(css(), ".rep-hours")).toMatch(/height:\s*56px/);
  });
});
