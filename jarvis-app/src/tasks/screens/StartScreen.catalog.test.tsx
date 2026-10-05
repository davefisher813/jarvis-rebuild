// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StartScreen from "./StartScreen";
import { startAction, type StartTarget } from "../startAction";
import { START_KEY } from "../startStore";
import { lineCase } from "../../shared/casing";

// THE VISUAL CATALOG, HELD ON THE START SCREEN (Dave 2026-10-05, "I am sick of
// this": two thin grey lines stacked under a title came back). Every test here
// reads the DOM the real component draws and asserts a structural property of
// the catalog (STYLING_CATALOG_V3 §AK one grey, §AM the key, R6 the dot is
// drawn by CSS, the casing rule), never a class that merely happens to exist.

const MIDDOT = "·";
const task = (title: string, extra: Partial<StartTarget["data"] & object> = {}): StartTarget => ({
  kind: "task", id: "t1", title, data: { text: title, category: "life", done: false, ...extra },
});
const noop = async () => null;
const base = (target: StartTarget, action = startAction(target)) => ({
  target, action, onDraftChange: () => {}, onPrimary: noop, onBack: () => {}, onInTheWay: () => {},
});

beforeEach(() => { localStorage.removeItem(START_KEY); });

/** Every facts line and every meta line the screen drew. */
const lines = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".facts, .conn-meta")];
/** A fact in the row's plain grey: no tone, no caps, no mark, and not wholly a
 *  <b> (the facts line draws a bold number white, the key's "stand out"). */
const isPlain = (f: Element) => f.className.trim() === "fact" && f.querySelector(":scope > b")?.textContent !== f.textContent;
const plainFacts = (line: HTMLElement) => [...line.querySelectorAll<HTMLElement>(":scope > .fact")].filter(isPlain);

/** The structural half of the catalog, for any rendered screen. */
function expectCatalog(root: HTMLElement) {
  for (const line of lines(root)) {
    for (const f of line.querySelectorAll(".fact")) {
      expect(f.textContent, "R6: the dot between facts is drawn by CSS, never typed into a fact").not.toContain(MIDDOT);
    }
    expect(plainFacts(line).length, "R1/R5: at most one plain grey fact on a line, the rest wear a key colour, caps or a mark").toBeLessThanOrEqual(1);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[style]")) {
    const css = el.getAttribute("style") ?? "";
    expect(css, "R3: no raw colour in an inline style").not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  }
}

describe("Start: the header is one subtext block, never two greys", () => {
  it("the count is a white number in a facts line, not its own grey class", () => {
    const { container } = render(<StartScreen {...base(task("Plan the trip"))} progress={{ done: 1, total: 4 }} />);
    const count = container.querySelector(".fb-count") as HTMLElement;
    expect(count, "the count is a .facts line, so its size and weight are the primitives'").toHaveClass("facts");
    const b = count.querySelector(".fact > b");
    expect(b, "the number that must stand out is the facts line's own <b>, which the stylesheet draws white").not.toBeNull();
    expect(b!.textContent).toBe("1 of 4 Complete");
    expect(container.querySelector(".start-last"), "the second grey class is gone").toBeNull();
    expectCatalog(container);
  });

  it("last worked is a facts line: the day in small caps, his note the one grey, no typed dot", () => {
    const { container } = render(<StartScreen {...base(task("Plan the trip"))}
      progress={{ done: 1, total: 4 }} lastWorked={`Last Worked on Today ${MIDDOT} Booked the venue`} />);
    const facts = [...container.querySelectorAll(".facts")].filter((l) => l.querySelector(".fact.date"));
    expect(facts).toHaveLength(1);
    const line = facts[0] as HTMLElement;
    expect(line.querySelector(".fact.date")!.textContent).toBe("Last Worked on Today");
    expect(plainFacts(line).map((f) => f.textContent)).toEqual(["Booked the venue"]);
    expect(line.textContent).not.toContain(MIDDOT);
    expectCatalog(container);
  });

  it("a note that holds a dot of its own keeps it, only the first dot is the seam", () => {
    const { container } = render(<StartScreen {...base(task("Plan the trip"))}
      lastWorked={`Last Worked on Today ${MIDDOT} Call A ${MIDDOT} Call B`} />);
    expect(container.querySelector(".fact.date")!.textContent).toBe("Last Worked on Today");
    expect(plainFacts(container.querySelector(".facts") as HTMLElement)[0]!.textContent).toBe(`Call A ${MIDDOT} Call B`);
  });

  it("with no note there is one fact, and with nothing worked there is no line at all", () => {
    const { container, rerender } = render(<StartScreen {...base(task("Plan the trip"))} lastWorked="Last Worked on Yesterday" />);
    expect(container.querySelectorAll(".facts > .fact")).toHaveLength(1);
    rerender(<StartScreen {...base(task("Plan the trip"))} lastWorked={null} />);
    expect(container.querySelector(".facts"), "a row with nothing to say shows nothing").toBeNull();
  });

  it("never stacks two plain grey runs under the title (the screenshot Dave sent)", () => {
    const { container } = render(<StartScreen {...base(task("Plan the trip"))}
      progress={{ done: 1, total: 4 }} lastWorked={`Last Worked on Today ${MIDDOT} Booked the venue`} />);
    const head = container.querySelector(".start-head")!;
    const grey: string[] = [];
    for (let n = head.nextElementSibling; n && !n.querySelector('[role="status"]') && n.getAttribute("role") !== "status"; n = n.nextElementSibling) {
      n.querySelectorAll(".fact").forEach((f) => { if (isPlain(f)) grey.push(f.textContent ?? ""); });
    }
    expect(grey, "one grey run between the title and the work card").toEqual(["Booked the venue"]);
  });
});

describe("Start: the work card holds one grey, and says nothing twice", () => {
  const grounded = (): StartTarget => task("Send team practice details");
  const groundedAction = () => startAction(grounded(), {
    grounding: {
      lines: ["Hi everyone,"],
      sources: [{ kind: "event", id: "e1", label: "Source: Saturday Practice" }],
      missing: ["Location Still Needed"],
    },
  });

  it("the question is primary ink, not a second grey under the facts line", () => {
    const { container } = render(<StartScreen {...base(grounded(), groundedAction())} />);
    const card = container.querySelector(".start-card") as HTMLElement;
    expect(card.querySelector(".facts")).not.toBeNull();
    expect(card.querySelector(".start-label"), "the prompt is not drawn in the grey label class").toBeNull();
    expect(card.querySelector(".start-move")!.textContent).toBe(groundedAction().prompt);
    expectCatalog(container);
  });

  it("the honest line sits below the card as the one field note, and the card holds no note of its own", () => {
    const { container } = render(<StartScreen {...base(grounded(), groundedAction())} />);
    const card = container.querySelector(".start-card") as HTMLElement;
    expect(card.querySelector(".start-truth, .conn-status, .input-hint"), "no grey note inside the card").toBeNull();
    const hints = container.querySelectorAll(".input-hint");
    expect(hints).toHaveLength(1);
    expect(hints[0]!.textContent).toMatch(/Nothing Is Sent Here/);
    expect(card.parentElement!.nextElementSibling, "directly under the card").toContainElement(hints[0] as HTMLElement);
  });

  it("a receipt REPLACES the honest line, so two greys never say the same thing", async () => {
    const target = task("Pack for practice");
    const { container } = render(<StartScreen {...base(target)}
      onPrimary={async () => `Saved as the First Step ${MIDDOT} The Task Stays Open`} />);
    expect(container.querySelector(".input-hint")!.textContent).toMatch(/^Becomes the First Step/);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Find the bag" } });
    fireEvent.click(screen.getByText("Save First Step"));
    await waitFor(() => expect(container.querySelector(".input-hint")!.textContent).toMatch(/^Saved as the First Step/));
    expect(container.querySelectorAll(".input-hint"), "one note, never the receipt over the promise").toHaveLength(1);
    expect(container.querySelector(".conn-status")).toBeNull();
    expect(container.textContent!.match(/The Task Stays Open/g), "said once").toHaveLength(1);
  });

  it("a project's next task does not repeat the project's own title as a source", () => {
    const target: StartTarget = { kind: "project", id: "p1", title: "Jarvis V1" };
    const action = startAction(target, { children: [{ id: "c1", title: "Finish the visuals" }] });
    expect(action.sources[0]!.label, "the resolver still reports what it read").toBe("Jarvis V1");
    const { container } = render(<StartScreen {...base(target, action)} />);
    expect(container.querySelector(".start-card .facts"), "a line that only repeats the title is not drawn").toBeNull();
    expect(screen.getAllByText("Jarvis V1"), "the title is on screen once").toHaveLength(1);
  });

  it("a linked record's label is the move, and is not also printed as its own source", () => {
    const target = task("Finish the visuals");
    const action = startAction(target, { resource: { kind: "note", id: "n1", label: "Health Feedback" } });
    const { container } = render(<StartScreen {...base(target, action)} />);
    expect(screen.getAllByText("Health Feedback")).toHaveLength(1);
    expect(container.querySelector(".start-card .facts")).toBeNull();
  });

  it("a source that says something new is still drawn, once, as the one grey", () => {
    const target = task("Finish the visuals", { steps: [{ text: "Fix the headliner", done: false }, { text: "Ship it", done: false }] });
    const { container } = render(<StartScreen {...base(target)} />);
    const facts = container.querySelector(".start-card .facts") as HTMLElement;
    expect(plainFacts(facts).map((f) => f.textContent)).toEqual(["Step 1 of 2"]);
    expectCatalog(container);
  });

  it("the footer is Title Case like every line the app writes", () => {
    const { container } = render(<StartScreen {...base(grounded(), groundedAction())} />);
    const floor = container.querySelector(".list-floor")!.textContent!;
    expect(floor).toBe(`Saved on This Device ${MIDDOT} Nothing Leaves Here`);
    expect(lineCase(floor), "no sentence-case word after a dot or in the middle").toBe(floor);
  });

  it("every grey line the screen draws is Title Case after dots and numbers", () => {
    const { container } = render(<StartScreen {...base(grounded(), groundedAction())}
      progress={{ done: 2, total: 5 }} lastWorked="Last Worked on 3 Days Ago" />);
    for (const el of container.querySelectorAll(".fact, .conn-meta, .list-floor, .input-hint")) {
      const t = el.textContent ?? "";
      // His own typed words (a note, a step) are shown as he wrote them.
      expect(lineCase(t), t).toBe(t);
    }
  });
});

describe("Start: every way out stays on screen", () => {
  it("the ways out row wraps (five actions measured 713px wide at 390px, three off the edge)", () => {
    const target = task("Plan the trip", { steps: [{ text: "Pick dates", done: false }] });
    const { container } = render(<StartScreen {...base(target)} onSmallerStep={async () => true} onEditStep={async () => true}
      onWorked={async () => true} onDoneForNow={() => {}} />);
    const row = container.querySelector(".start-support") as HTMLElement;
    expect(row.querySelectorAll("button").length, "all five are offered with a step on screen").toBe(5);
    expect(row, "and the row carries the wrap rule from the feedback block").toHaveClass("fb-support");
  });
});

describe("Start: nothing ready means nothing printed", () => {
  it("a task with nothing linked has no ready line to put on the card", () => {
    for (const title of ["Pack for practice", "Email Nadia about the invoice", "Clean up backend storage"]) {
      expect(startAction(task(title)).ready, title).toBe("");
    }
    // A machine sender: the same rule, and the prompt still asks the question.
    const machine = startAction(task("Reply to the failed build notice"), { fromEmailAddress: "no-reply@github.com" });
    expect(machine.ready).toBe("");
    expect(machine.prompt).toBe("Which error do you need to look at?");
  });

  it("no ready line anywhere repeats what the Start button already says", () => {
    const REPEATS_THE_BUTTON = /^(start|begin|open)\b/i;
    const actions = [
      startAction(task("Pack for practice")),
      startAction(task("Email Nadia about the invoice")),
      startAction(task("Send team practice details"), { grounding: { lines: ["Hi"], sources: [], missing: [] } }),
      startAction(task("Pack", { steps: [{ text: "Find the bag", done: false }] })),
    ];
    for (const a of actions) expect(a.ready, a.kind).not.toMatch(REPEATS_THE_BUTTON);
  });
});
