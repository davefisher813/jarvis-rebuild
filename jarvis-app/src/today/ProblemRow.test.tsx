// @vitest-environment jsdom
// TODAY'S PROBLEM ROW (issue 106 V2, approved by Dave 2026-10-13: "a recoverable problem on Today is ONE slim amber row below the
// greeting (per the amber ruling), actionable, and it disappears when resolved. Not a large red card at the top.").
//
// The row is the Email tab's connection strip, whole (the same amber fill, ink and outlined action), so nothing here is a new
// colour. These tests hold the shape: one row, never a card in the stream; the first problem drawn and the rest counted; the
// verb holds still while it works; the words are a door; nothing can be swiped or dismissed away; the dot between two parts is
// drawn by the stylesheet and never typed; and the CSS sets no colour, no red and no type of its own.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ProblemRow, { type Problem } from "./ProblemRow";
import TodayPage from "./TodayPage";
import NoticeCard from "./NoticeCard";
import { WAITING } from "./stream";

const SRC = join(process.cwd(), "src");
const sweep = (run: () => void | Promise<void> = () => {}): Problem => ({
  key: "sweepfail",
  parts: ["Couldn't Move Yesterday's Tasks", "1 Task Did Not Move"],
  action: { label: "Retry", run },
});
const incident: Problem = { key: "connection", parts: ["Gmail Needs Reconnecting", "dave.fisher@icloud.com"], onOpen: () => {}, action: { label: "Reconnect", run: () => {} } };

describe("ProblemRow: one amber row, the Email strip", () => {
  it("draws nothing when nothing is wrong", () => {
    const { container } = render(<ProblemRow problems={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is the Email strip (.conn-strip, role alert) with the words as parts and no tone, disc or capsule of its own", () => {
    const { container } = render(<ProblemRow problems={[sweep()]} />);
    const strip = container.querySelector(".conn-strip")!;
    expect(strip).toHaveClass("conn-strip-today");
    expect(strip).toHaveAttribute("role", "alert");
    expect(strip).toHaveAttribute("data-problem", "sweepfail");
    expect([...strip.querySelectorAll(".conn-strip-part")].map((p) => p.textContent)).toEqual(["Couldn't Move Yesterday's Tasks", "1 Task Did Not Move"]);
    // Not a card, not a notice, not a capsule: the strip's own outlined action is the only control.
    expect(strip.className).not.toMatch(/cat-|notice|card|pill/);
    expect(container.querySelector(".notice-card, .notice-vrow, .notice-disc, .pill-act, .row-act, .facts, .fact")).toBeNull();
    expect(strip.querySelectorAll("button")).toHaveLength(1);
    expect(strip.querySelector("button")).toHaveClass("conn-strip-act");
  });

  it("never types the dot between two parts: the stylesheet draws it", () => {
    const { container } = render(<ProblemRow problems={[sweep(), incident]} />);
    expect(container.textContent).not.toContain("\u00b7");
    expect(container.querySelectorAll(".conn-strip-part")).toHaveLength(3);
  });

  it("an address may break after an @ or a dot, and its words stay whole", () => {
    render(<ProblemRow problems={[incident]} />);
    const address = screen.getByText("dave.fisher@icloud.com");
    expect(address).toHaveClass("conn-strip-part");
    // <wbr> adds no character: what is read, copied and searched is the address itself.
    expect(address.querySelectorAll("wbr").length).toBeGreaterThanOrEqual(2);
    expect(address.textContent).toBe("dave.fisher@icloud.com");
    // A line of words with nothing to break at has none.
    expect(screen.getByText("Gmail Needs Reconnecting").querySelector("wbr")).toBeNull();
  });
});

describe("ProblemRow: one row only", () => {
  it("draws the first problem and counts the rest as an 'N More' part, in Title Case", () => {
    const { container, rerender } = render(<ProblemRow problems={[incident, sweep()]} />);
    expect(container.querySelectorAll(".conn-strip")).toHaveLength(1);
    const parts = () => [...container.querySelectorAll(".conn-strip-part")].map((p) => p.textContent);
    expect(parts()).toEqual(["Gmail Needs Reconnecting", "dave.fisher@icloud.com", "1 More"]);
    expect(screen.queryByText("Couldn't Move Yesterday's Tasks")).toBeNull();
    // The verb on the row is the first problem's.
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    rerender(<ProblemRow problems={[incident, sweep(), { key: "x", parts: ["Another"] }]} />);
    expect(container.querySelectorAll(".conn-strip")).toHaveLength(1);
    expect(parts().at(-1)).toBe("2 More");
  });

  it("the next problem takes the row when the first is mended, and the row is gone when none is left", () => {
    const { container, rerender } = render(<ProblemRow problems={[incident, sweep()]} />);
    expect(container.querySelector("[data-problem]")).toHaveAttribute("data-problem", "connection");
    rerender(<ProblemRow problems={[sweep()]} />);
    expect(container.querySelector("[data-problem]")).toHaveAttribute("data-problem", "sweepfail");
    expect(container.querySelector(".conn-strip")!.textContent).not.toMatch(/\bMore\b/);
    rerender(<ProblemRow problems={[]} />);
    expect(container.querySelector(".conn-strip")).toBeNull();
  });

  it("cannot be waved away: no dismiss, no swipe, and the verb is the only control", () => {
    const { container } = render(<ProblemRow problems={[sweep()]} />);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector(".notice-swipe, .swipe-rail, .notice-x, [data-swipe]")).toBeNull();
    expect(container.querySelector("[aria-label*='ismiss' i], [aria-label*='lose' i]")).toBeNull();
  });
});

describe("ProblemRow: the verb", () => {
  it("runs once, holds still while it works (disabled, label unchanged), and comes back when it is done", async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((res) => { finish = res; }));
    render(<ProblemRow problems={[sweep(run)]} />);
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(1);
    // Working: the same button, disabled and busy (the app's faded disabled button), and its label is NOT swapped for a longer
    // one: that would widen the button, squeeze the words beside it onto another line and make the row jump as it was pressed.
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent(/^Retry$/);
    expect(button).not.toHaveAttribute("data-busy-label");
    // A second tap on the button or on the words is the same tap twice.
    fireEvent.click(button);
    fireEvent.click(screen.getByText("Couldn't Move Yesterday's Tasks"));
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "false");
    // And it can be run again if the problem is still there.
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("the words are a door: with a verb and no door of their own, a tap or Enter on them does what the verb does", async () => {
    const run = vi.fn();
    render(<ProblemRow problems={[sweep(run)]} />);
    const words = screen.getByRole("button", { name: /Couldn't Move Yesterday's Tasks/ });
    expect(words).toHaveClass("conn-strip-text");
    // Each press is a whole run (the verb settles before the next): a press while one is working is the same press twice.
    await act(async () => { fireEvent.click(words); });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.keyDown(words, { key: "Enter" }); });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a problem with its own door sends the words there and leaves the verb to the button", () => {
    const open = vi.fn();
    const run = vi.fn();
    render(<ProblemRow problems={[{ key: "connection", parts: ["Gmail Needs Reconnecting"], onOpen: open, action: { label: "Reconnect", run } }]} />);
    fireEvent.click(screen.getByText("Gmail Needs Reconnecting"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("with no verb and no door it is a plain status row, not button-shaped", () => {
    const { container } = render(<ProblemRow problems={[{ key: "connection", parts: ["Offline"] }]} />);
    expect(container.querySelector("button, [role='button'], [tabindex]")).toBeNull();
    expect(container.querySelector(".conn-strip")).toHaveTextContent("Offline");
  });

  it("with a door and no verb the words alone are the button", () => {
    const open = vi.fn();
    const { container } = render(<ProblemRow problems={[{ key: "connection", parts: ["Gmail Isn't Updating", "dave@x.test"], onOpen: open }]} />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Gmail Isn't Updating/ }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("ProblemRow in Today's page", () => {
  const base = {
    greeting: "Good Morning", dateLong: "Wednesday, May 20", summary: { events: 1, due: 1, overdue: 0, moves: 0 },
    todayEvents: [], now: "08:00", nowLabel: "8:00", tomorrowEvents: [], tomorrowDate: "Thu, May 21", tasks: [], today: "2026-05-20",
    onSeeAllSchedule: () => {}, onSeeAllTasks: () => {},
  };

  it("sits directly under the greeting and above the stream, and is not a member of the stream", () => {
    const { container } = render(
      <TodayPage {...base} offersQuiet
        notices={[<NoticeCard key="n" weight={WAITING} icon={null} title="Your Report Is Ready" action={{ label: "Read", onClick: () => {} }} onOpen={() => {}} />]}
        problem={<ProblemRow problems={[sweep()]} />} />,
    );
    const hero = container.querySelector(".today-hero")!;
    const strip = container.querySelector(".conn-strip-today")!;
    const stream = container.querySelector(".heads-up-stream")!;
    expect(strip).toBeTruthy();
    expect(hero.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(stream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stream.contains(strip)).toBe(false);
    expect(container.querySelector(".stream-card")!.contains(strip)).toBe(false);
    // The stream holds the notice and nothing about the problem.
    expect(stream).toHaveTextContent("Your Report Is Ready");
    expect(stream).not.toHaveTextContent("Couldn't Move");
  });

  it("with no problem the page is as it was: no strip", () => {
    const { container } = render(<TodayPage {...base} />);
    expect(container.querySelector(".conn-strip")).toBeNull();
  });
});

// THE STYLESHEET HOLDS WHAT THE ISSUE ASKED FOR (light and dark differ only in colour; the font style does not change; recoverable
// is amber, never red). The row's rules set NO colour, NO face, NO size and NO weight of their own, and are scoped to no theme: the
// amber, the ink and the type are the Email strip's (.conn-strip), which the email suite holds to --warn-fill / --on-fill-dark.
describe("ProblemRow: the stylesheet adds no colour, no red and no type", () => {
  const CSS = readFileSync(join(SRC, "styles/components.css"), "utf8");
  const rules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
  const mine = rules.filter((r) => /conn-strip-today|conn-strip-part/.test(r.sel));

  it("has the rules the markup needs, and only those", () => {
    const sels = mine.map((r) => r.sel);
    expect(sels).toContain(".conn-strip.conn-strip-today");
    expect(sels).toContain(".conn-strip-today .conn-strip-text");
    expect(sels).toContain(".conn-strip-today .conn-strip-part");
    expect(sels).toContain(".conn-strip-today .conn-strip-part + .conn-strip-part::before");
  });

  it("draws the dot with CSS, in the strip's own ink", () => {
    const dot = mine.find((r) => r.sel === ".conn-strip-today .conn-strip-part + .conn-strip-part::before")!;
    expect(dot.body).toMatch(/content:\s*"\\00B7"/);
    expect(dot.body).not.toMatch(/color|var\(--tx/);
  });

  it("sets no colour, background, border colour, face, size or weight, and is scoped to no theme", () => {
    for (const r of mine) {
      expect(r.sel, "no theme-scoped rule").not.toMatch(/data-theme|prefers-color-scheme|:root/);
      expect(r.body, r.sel).not.toMatch(/(^|[;\s])(color|background(-color|-image)?|border(-\w+)?-color|font(-\w+)?|opacity|box-shadow|text-shadow)\s*:/);
      expect(r.body, r.sel).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|var\(--(sys-)?red|var\(--tint|var\(--accent|var\(--tx/i);
    }
  });

  it("the strip it rides is the key's amber: --warn-fill with the on-fill ink, in both themes by token", () => {
    const strip = rules.find((r) => r.sel === ".conn-strip")!;
    expect(strip.body).toMatch(/background:\s*var\(--warn-fill\)/);
    expect(strip.body).toMatch(/color:\s*var\(--on-fill-dark\)/);
  });

  it("the component names no red: not a red tone, not a red token", () => {
    const src = readFileSync(join(SRC, "today/ProblemRow.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(src).not.toMatch(/cat-fg-|cat-bg-|--sys-red|--red\b|--tint|tone/);
  });
});
