// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Quiet } from "./quiet";
import NoticeCard from "./NoticeCard";
import TodayFlow from "./TodayFlow";
import { Facts } from "../messages/factsLine";
import EmailFacts from "../email/EmailFacts";
import ToastHost from "../shared/ToastHost";
import { showToast, hideToast } from "../shared/toast";
import { bindMeridiem, lineCase } from "../shared/casing";
import { NotesProvider, useSchedule } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { todayISO } from "../schedule/calendar";

// A CLOCK HOLDS ONE LINE (Dave 2026-10-13, issue 106 V1: "8:15 AM must hold one line. Apply the same no-wrap rule
// Schedule already follows, everywhere times render on Today").
//
// Schedule's clocks already hold one line: they are a clock face and its AM or PM with no space between them, or they wear
// white-space: nowrap. Today's were the STRINGS. A sub, a fact, a title and a toast are text, and "2:00 PM" in text has a
// plain space in the middle of it, which is a place for a wrapping line to break the clock in half and leave PM alone on
// the next one (measured in a bench through the real stylesheets: at 360 to 390px with 1.4x text, and at 300 to 310px at the
// default size; the same widths wrap in light and in dark, because the two themes differ in colour only).
//
// The no-break space is bound where the text is DRAWN, and bound last: lineCase and titleCase split on any whitespace and
// rejoin with a plain space, so a pair bound by a producer is undone by the next Title Case pass.
//
// These read raw textContent on purpose. testing-library's getByText and jest-dom's toHaveTextContent normalise a no-break
// space into a plain one, which is exactly the difference this file is about.
const GLUED = /\d\u00a0(AM|PM)/;
const LOOSE = /\d (AM|PM)\b/;
const text = (el: Element | null) => el?.textContent ?? "";

afterEach(() => { hideToast(); vi.useRealTimers(); });

describe("bindMeridiem, the one helper every door calls", () => {
  it("binds a clock and leaves everything else alone", () => {
    expect(bindMeridiem("Until 8:15 AM")).toBe("Until 8:15\u00a0AM");
    expect(bindMeridiem("Between 7 AM and 10 PM")).toBe("Between 7\u00a0AM and 10\u00a0PM");
    expect(bindMeridiem("10 AMERICANS")).toBe("10 AMERICANS");
    expect(bindMeridiem("Team Standup")).toBe("Team Standup");
  });
  it("is idempotent, so a door can bind text a producer already bound", () => {
    const once = bindMeridiem("Moved to 2:30 PM");
    expect(bindMeridiem(once)).toBe(once);
  });
  it("is undone by lineCase, which is why the doors bind AFTER it", () => {
    expect(lineCase(bindMeridiem("starts 2:30 PM with the team"))).toMatch(LOOSE);
    expect(bindMeridiem(lineCase("starts 2:30 PM with the team"))).toMatch(GLUED);
  });
});

describe("Quiet, the sub of every string notice", () => {
  it("keeps the clock and its meridiem together, and the figure is still the datum", () => {
    const { container } = render(<Quiet s="Looks Like Tuesday 2:00 PM With Dr Patel" />);
    expect(text(container)).toMatch(GLUED);
    expect(text(container)).not.toMatch(LOOSE);
    expect(Array.from(container.querySelectorAll(".qd")).map((e) => e.textContent)).toEqual(["2:00"]);
  });
  it("binds a whole hour too", () => {
    const { container } = render(<Quiet s="Ends at 3 PM" />);
    expect(text(container)).toBe("Ends at 3\u00a0PM");
    expect(Array.from(container.querySelectorAll(".qd")).map((e) => e.textContent)).toEqual(["3"]);
  });
  it("still tones a day count beside a bound clock", () => {
    const { container } = render(<Quiet s="Ends 5:00 PM with 3 days left" />);
    expect(text(container)).toMatch(GLUED);
    expect(Array.from(container.querySelectorAll(".qd-soon")).map((e) => e.textContent)).toEqual(["3"]);
  });
  it("takes text that went through lineCase, the order every producer uses", () => {
    const { container } = render(<Quiet s={lineCase("starts 2:30 PM with the team")} />);
    expect(text(container)).toMatch(GLUED);
    expect(text(container)).not.toMatch(LOOSE);
  });
});

describe("Facts, the line of facts every screen draws", () => {
  it("binds the clock in a plain, a toned, a date and a strong fact", () => {
    const { container } = render(
      <Facts facts={[
        { text: "Today 2:00 PM" },
        { text: "Starts 11:30 AM", tone: "warn" },
        { text: "Reply By 5:45 PM", tone: "date" },
        { text: "About 9 AM", strong: true },
      ]} />,
    );
    const facts = Array.from(container.querySelectorAll(".fact"));
    expect(facts).toHaveLength(4);
    for (const f of facts) {
      expect(text(f), text(f)).toMatch(GLUED);
      expect(text(f), text(f)).not.toMatch(LOOSE);
    }
  });
  it("draws the same classes it always did (only the space changed)", () => {
    const { container } = render(<Facts facts={[{ text: "Today 2:00 PM", tone: "warn" }, { text: "Reply By 5:45 PM", tone: "date" }]} />);
    expect(container.querySelector(".facts > .fact.warn")).not.toBeNull();
    expect(container.querySelector(".facts > .fact.date")).not.toBeNull();
  });
});

describe("EmailFacts, the Email tab's line of facts", () => {
  it("binds the clock in a plain, a toned, a category and a strong fact, one line or wrapping", () => {
    for (const wrap of [false, true]) {
      const { container, unmount } = render(
        <EmailFacts wrap={wrap} facts={[
          { text: "Today 2:00 PM", tone: "warn" },
          { text: "Reply By 5:45 PM" },
          { text: "Booked 8:15 AM", cat: "teal" },
          { text: "About 9 AM", strong: true },
        ]} />,
      );
      const facts = Array.from(container.querySelectorAll(".fact"));
      expect(facts).toHaveLength(4);
      for (const f of facts) {
        expect(text(f), text(f)).toMatch(GLUED);
        expect(text(f), text(f)).not.toMatch(LOOSE);
      }
      expect(container.querySelector(wrap ? ".conn-meta" : ".facts")).not.toBeNull();
      unmount();
    }
  });
});

describe("NoticeCard, the card every Today notice is drawn in", () => {
  const base = { icon: <span />, tone: "cat-fg-sky" };
  it("binds a clock in a string title, in the card form and in the row form", () => {
    const card = render(<NoticeCard {...base} uniform={false} title="Booked 8:15 AM With the Team" />);
    expect(text(card.container.querySelector(".conn-name"))).toBe("Booked 8:15\u00a0AM With the Team");
    card.unmount();
    const row = render(<NoticeCard {...base} form="row" title="Standup Moved to 8:15 AM" onOpen={() => {}} />);
    expect(text(row.container.querySelector(".conn-name"))).toBe("Standup Moved to 8:15\u00a0AM");
  });
  it("binds a clock in a string sub (through Quiet), and the figure is still lit", () => {
    const { container } = render(<NoticeCard {...base} uniform={false} title="Dental Cleaning" sub="Looks Like Tuesday 2:00 PM With Dr Patel" />);
    const sub = container.querySelector(".conn-meta");
    expect(text(sub)).toMatch(GLUED);
    expect(text(sub)).not.toMatch(LOOSE);
    expect(Array.from(sub!.querySelectorAll(".qd")).map((e) => e.textContent)).toEqual(["2:00"]);
  });
  // The swipe tray's snooze read "Back at 9" over "AM" in a 88px button (issue 106 V1, found by the Oct 17 audit at 390).
  it("binds a clock in the tray's revealed actions and in the card's own buttons", () => {
    const alt = { label: "Back at 9 AM", onClick: () => {} };
    const row = render(<NoticeCard {...base} form="row" title="Reply to Maya" onOpen={() => {}} alt={alt} />);
    const labels = Array.from(row.container.querySelectorAll(".notice-alt")).map(text);
    expect(labels).toContain("Back at 9\u00a0AM");
    row.unmount();
    const card = render(<NoticeCard {...base} uniform={false} title="Reply to Maya" action={{ label: "Back at 6:30 PM", onClick: () => {} }} alt={alt} />);
    for (const b of Array.from(card.container.querySelectorAll("button"))) expect(text(b)).not.toMatch(LOOSE);
  });
  it("leaves a title that is not a string to draw its own times", () => {
    const { container } = render(<NoticeCard {...base} title={<span className="mine">Booked 8:15 AM</span>} />);
    expect(text(container.querySelector(".mine"))).toBe("Booked 8:15 AM");
  });
});

describe("ToastHost, the one door every toast goes through", () => {
  it("binds a clock in the message", () => {
    const { container } = render(<ToastHost />);
    act(() => showToast({ message: "Moved to 2:30 PM" }));
    expect(text(container.querySelector(".toast-msg"))).toBe("Moved to 2:30\u00a0PM");
  });
  it("binds a clock in a message written through lineCase, which rejoins with a plain space", () => {
    const { container } = render(<ToastHost />);
    act(() => showToast({ message: lineCase("starts 2:30 PM with the team") }));
    expect(text(container.querySelector(".toast-msg"))).toMatch(GLUED);
    expect(text(container.querySelector(".toast-msg"))).not.toMatch(LOOSE);
  });
  it("keeps the Undo capsule beside it", () => {
    const { container } = render(<ToastHost />);
    act(() => showToast({ message: "Booked 3:00 PM", actionLabel: "Undo", onAction: () => {} }));
    expect(text(container.querySelector(".toast-action"))).toBe("Undo");
  });
});

// THE NOW CARD'S "UNTIL" (Today's open-window row: "Until 11:30 AM" beside the next event). Rendered through the real
// TodayFlow with the clock frozen, the way TodayFlow.test.tsx does it, because the line is JSX in the page and no unit
// can reach it.
describe("TodayFlow: the Now card's Until time", () => {
  it("is one word: the clock and its AM or PM are joined", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(todayISO() + "T09:00:00"));
    let sched: ReturnType<typeof useSchedule> | null = null;
    function Grab() { sched = useSchedule(); return null; }
    const { container } = render(
      <NotesProvider userId={"clock-glue-" + Math.random().toString(36).slice(2)}>
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Grab />
          <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    await waitFor(() => expect(sched).toBeTruthy(), { timeout: 5000 });
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_EVENT } = await import("../schedule/types");
    await sched!.createEvent("Bridge Foundation Zoom", { date: todayISO(), start: "11:30", end: "12:30" });
    notifyFreshLists(ENTITY_EVENT);
    const until = () => Array.from(container.querySelectorAll(".conn-meta > .fact.date")).find((e) => /^Until 11:30/.test(text(e).replace(/\s/g, " ")));
    await waitFor(() => expect(until()).toBeTruthy(), { timeout: 8000 });
    expect(text(until()!)).toBe("Until 11:30\u00a0AM");
  }, 20000);
});

// THE STYLESHEET HALF. The strip's .rem-time is the one Today clock that did not carry Schedule's nowrap; it cannot wrap
// today (a clock face and its meridiem have no space between them) and now says so. The rows the frozen TV guide draws
// (.sched-time and .ampm) are NOT restyled by this: Dave 2026-09-27, "It should never be edited. It should never be
// touched", and his own words are what unfreeze it.
describe("the stylesheet", () => {
  const css = (f: string) => readFileSync(join(__dirname, "..", "styles", f), "utf8");
  const rule = (file: string, selector: string) => {
    const m = css(file).match(new RegExp("^" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}", "m"));
    return m?.[1] ?? null;
  };
  it(".rem-time holds one line", () => {
    const r = rule("components.css", ".rem-time");
    expect(r, "the .rem-time rule").not.toBeNull();
    expect(r).toMatch(/white-space:\s*nowrap/);
  });
  it("the rows the frozen TV guide draws are left as Dave approved them", () => {
    for (const [file, sel] of [
      ["jarvis-design-system.css", ".sched-time"],
      ["jarvis-design-system.css", ".ampm"],
      ["ruled.css", ".ruled .sched-time"],
      ["ruled.css", ".ruled .sched-time .ampm"],
    ] as const) {
      const r = rule(file, sel);
      expect(r, `${sel} in ${file}`).not.toBeNull();
      expect(r, `${sel} is drawn inside the frozen TV guide; V1 does not restyle it`).not.toMatch(/white-space/);
    }
  });
});

describe("the source of Today", () => {
  it("never joins a clock to its AM or PM with a plain space in JSX", () => {
    const dir = __dirname;
    const bad: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!/\.tsx$/.test(f) || /\.test\./.test(f)) continue;
      readFileSync(join(dir, f), "utf8").split("\n").forEach((line, i) => {
        if (/\.time\}\s+\{[^}]*\.ap\}/.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad, "write {time}{\"\\u00a0\"}{ap}, or draw the string through a door that binds it").toEqual([]);
  });
});
