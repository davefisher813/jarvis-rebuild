// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TodayPage from "./TodayPage";
import RemindersStrip from "./RemindersStrip";
import FocusScreen from "../upnext/FocusScreen";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import type { ReminderView } from "../tasks/reminders";
import { setCategoryRegistry } from "../shared/categories";
import { resetPeekClaim } from "./usePeekOnce";

// THE ROUND-1 VISUAL REVIEW, TODAY (Dave 2026-10-05: "Everything should look PERFECT."). Two review passes of real screenshots found
// these defects on Today, Focus, Search and Smart Paste; each assertion below fails without its fix. Decisions D1 to D8 are the lead's
// (a head holds a calm number of capsules and an overflow, section actions live in the head, one capsule recipe, colour for meaning,
// nothing floats over content, Title Case, no baked dots, no truncation of what matters).

setCategoryRegistry([{ id: "work", name: "Work", color: "blue" }, { id: "family", name: "Family", color: "pink" }]);
const ev = (id: string, start: string, cat = "work"): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: cat } });
const tk = (id: string, due: string | null): TaskItem => ({ id, data: { text: id, category: "work", done: false, due } });
const rv = (id: string, time: string): ReminderView => ({ id, text: id, time, unscheduled: false, paused: false, category: "", done: false, missed: false, snoozed: false, letGo: false });
const noop = () => {};

const base = {
  greeting: "Good Morning",
  dateLong: "Wednesday, May 20",
  summary: { events: 2, due: 1, overdue: 0, moves: 1 },
  todayEvents: [ev("e1", "09:00"), ev("e2", "15:00")],
  now: "08:00",
  nowLabel: "8:00",
  tomorrowEvents: [ev("t1", "09:00", "family")],
  tomorrowDate: "Thu, May 21",
  tasks: [] as TaskItem[],
  today: "2026-05-20",
  onSeeAllSchedule: noop,
  onSeeAllTasks: noop,
};

const css = (f: string) => readFileSync(join(__dirname, "..", "styles", f), "utf8");

beforeEach(() => { localStorage.clear(); resetPeekClaim(); });
afterEach(() => cleanup());

describe("section heads: a calm number of capsules, section actions in the head (D1, D2)", () => {
  const page = () => render(
    <TodayPage {...base} upNext={[tk("due", "2026-05-20")]} onUpNext={noop} onGoBigger={noop}
      mail={<div className="stream-card">mail</div>} mailHead={{ title: "Ready to Send", action: "Open Inbox" }} onSeeAllMail={noop} onClearMail={noop}
      onPlanDay={noop} onNewEvent={noop} onRunningLate={noop}
      reminders={<RemindersStrip items={[rv("meds", "14:00")]} onAdd={noop} onSeeAll={noop} onAddAllToCalendar={noop} />} />,
  );

  it("no head holds more than two capsules, the overflow button is not a third, and none wraps onto a second row", () => {
    const { container } = page();
    const heads = [...container.querySelectorAll(".sh2")];
    expect(heads.length).toBeGreaterThan(3);
    for (const h of heads) {
      const caps = h.querySelectorAll(".see-all.pill-action:not(.head-more)");
      expect(caps.length, h.textContent ?? "").toBeLessThanOrEqual(2);
      expect(h.querySelectorAll(".head-more").length).toBeLessThanOrEqual(1);
    }
    // the day head is the one with the most to offer: ONE capsule (it must fit a 350px line with the pause) and the overflow
    const day = heads.find((h) => h.querySelector(".t")?.textContent === "Your Day" || h.querySelector(".t")?.textContent === "Now")!;
    expect([...day.querySelectorAll(".see-all.pill-action:not(.head-more)")].map((b) => b.textContent)).toEqual(["Plan My Day"]);
  });

  it("Clear All is the Ready to Send head's capsule and Open Inbox waits behind its More button, never a pill under the card", () => {
    const { container } = page();
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === "Ready to Send")!;
    // Both capsules beside the title measured 116px for a title that needs 134, which cut it to "Ready to S...": one capsule
    // and an overflow never crowd it.
    expect([...head.querySelectorAll(".see-all.pill-action:not(.head-more)")].map((b) => b.textContent)).toEqual(["Clear All"]);
    expect(head.querySelectorAll(".head-more")).toHaveLength(1);
    expect(container.querySelector(".notice-clear-row"), "nothing hangs under a card").toBeNull();
    fireEvent.click(screen.getByLabelText("Email Actions"));
    expect([...document.querySelectorAll(".action-sheet button")].map((b) => b.textContent)).toEqual(["Open Inbox", "Cancel"]);
  });

  it("with nothing to clear in bulk, Open Inbox is the head's one capsule", () => {
    const { container } = render(<TodayPage {...base} mail={<div className="stream-card">mail</div>} mailHead={{ title: "Ready to Send", action: "Open Inbox" }} onSeeAllMail={noop} />);
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === "Ready to Send")!;
    expect([...head.querySelectorAll(".see-all.pill-action")].map((b) => b.textContent)).toEqual(["Open Inbox"]);
  });

  it("Focus is Your Move's capsule, and the Focus pill under the card is gone", () => {
    const { container } = page();
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === "Your Move")!;
    expect([...head.querySelectorAll(".see-all.pill-action")].map((b) => b.textContent)).toEqual(["Focus"]);
    expect(container.querySelector(".focus-row")).toBeNull();
  });

  it("the day's head is a neutral head (brand red is for what you can tap), and its actions open from one More button", () => {
    const { container } = page();
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === "Your Day")!;
    expect(head).toHaveClass("sh2-quiet");
    fireEvent.click(screen.getByLabelText("Day Actions"));
    expect([...document.querySelectorAll(".action-sheet button")].map((b) => b.textContent)).toEqual(["New Event", "Schedule", "Running Late", "Cancel"]);
  });
});

describe("Reminders: Add All to Calendar is in the head's overflow, not a pill under the card (D2)", () => {
  it("the head is Add, See All and one More; the More holds Add All to Calendar and fires it", () => {
    const addAll = vi.fn();
    const { container } = render(<RemindersStrip items={[rv("meds", "14:00")]} onAdd={noop} onSeeAll={noop} onAddAllToCalendar={addAll} />);
    const head = container.querySelector(".sh2")!;
    expect([...head.querySelectorAll(".see-all.pill-action:not(.head-more)")].map((b) => b.textContent)).toEqual(["Add", "See All"]);
    expect(container.querySelector(".notice-clear-row"), "nothing under the card").toBeNull();
    expect(screen.queryByText("Add All to Calendar")).toBeNull();
    fireEvent.click(screen.getByLabelText("Reminder Actions"));
    fireEvent.click(screen.getByRole("button", { name: "Add All to Calendar" }));
    expect(addAll).toHaveBeenCalledTimes(1);
  });

  it("an empty strip is still its head and one stand-alone capsule, with no plate behind it (rule 12)", () => {
    const { container } = render(<RemindersStrip items={[]} onAdd={noop} onAddAllToCalendar={noop} />);
    expect(container.querySelector(".card")).toBeNull();
    expect(screen.getByText("Add a Reminder").closest(".notice-clear-row")).not.toBeNull();
    expect(screen.queryByLabelText("Reminder Actions")).toBeNull();
  });
});

describe("Tomorrow: one card, the area as a dot once, titles that wrap (D4, D8)", () => {
  it("draws its rows inside a card with no category bar, so a hairline ends at the card's edge", () => {
    const { container } = render(<TodayPage {...base} tomorrowEvents={[ev("t1", "09:00", "family"), ev("t2", "11:00")]} />);
    const rows = [...container.querySelectorAll(".sched-row-bare")];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.closest(".card"), "in a card, never loose on the page").not.toBeNull();
      expect(r.querySelector(".sched-bar"), "the area is a dot, not also a bar").toBeNull();
      expect(r.querySelector(".sched-cat .cat-dot"), "the dot stays").not.toBeNull();
      expect(r.querySelector(".sched-title > .sched-t"), "the title can wrap to two lines before it ends").not.toBeNull();
    }
  });
});

describe("Focus: the page's own header, one control row, a quiet count (D3, D8)", () => {
  const face = { areaName: "Money", areaSlot: "yellow", reasons: [{ text: "Due Today", tone: "warn" as const }], text: "Create Invoice" };
  const props = { mode: "next" as const, onMode: noop, onClose: noop, face, waiting: 13, onDone: noop, onSkip: noop, onBackToNext: noop };

  it("uses the shared page header (the 20px title with its stroke), not a hand-built bar, and Close is the bar's word", () => {
    const onClose = vi.fn();
    const { container } = render(<FocusScreen {...props} onClose={onClose} />);
    expect(container.querySelector(".pagehead-title")).toHaveTextContent("Focus");
    expect(container.querySelector(".nav-bar, .nav-large"), "no off-grid nav-large title").toBeNull();
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("states what is behind the card as a number and Title Case words, and the last card says Last One Open", () => {
    const { container, rerender } = render(<FocusScreen {...props} />);
    expect(container.querySelector(".focus-rest")).toHaveTextContent("13 More Waiting");
    expect(container.querySelector(".focus-rest b")).toHaveTextContent("13");
    rerender(<FocusScreen {...props} waiting={0} />);
    expect(container.querySelector(".focus-rest")).toHaveTextContent("Last One Open");
  });

  it("the stylesheet keeps the segmented labels on one line, the music chip on the card's column, and the card at the TOP (Dave 2026-09-18, in FocusScreen.tsx)", () => {
    const c = css("components.css");
    expect(c).toMatch(/\.focus-controls \.seg \{ white-space: nowrap; \}/);
    expect(c).toMatch(/\.focus-controls \.chip-row \{[^}]*padding: 0;[^}]*overflow: visible;[^}]*mask-image: none;/);
    // The card starts under the controls with air, never centred in the open space (the 2026-10-05 pass that centred it
    // undid his own note: "it starts at the top now, under the control, where a screen starts").
    expect(c).toMatch(/\.focus-screen \.focus-body \{ justify-content: flex-start; padding-top: var\(--s-4\);/);
    expect(c).not.toMatch(/\.focus-screen \.focus-body \{ justify-content: center/);
  });

  it("the four answers carry unequal weight: one filled Start, Done and the timer as capsules, Not This One as quiet words, every tap 44px", () => {
    const { container } = render(<FocusScreen {...props} onStartNow={noop} onFifteen={noop} />);
    const card = container.querySelector(".focus-card")!;
    expect(card.querySelectorAll(".btn-primary").length, "one filled primary").toBe(1);
    expect(card.querySelector(".btn-primary")).toHaveTextContent("Start Now");
    const row = card.querySelector(".focus-acts.skew")!;
    expect([...row.querySelectorAll(".btn")].map((b) => b.textContent)).toEqual(["Done", "15 Min"]);
    expect(row.querySelector(".btn svg.ic"), "the timer wears its icon").not.toBeNull();
    expect(row.querySelector(".btn[aria-label='Focus 15 Minutes']")).not.toBeNull();
    expect(card.querySelector(".focus-skip")).toHaveTextContent("Not This One");
    const c = css("components.css");
    expect(c).toMatch(/\.focus-acts\.skew \{ grid-template-columns: 1fr auto; \}/);
    expect(c).toMatch(/\.focus-acts \.btn \{[^}]*min-height: var\(--tap-min\);/);
    expect(c).toMatch(/\.focus-skip \{[^}]*min-height: var\(--tap-min\);/);
  });
});

// FOCUS IS THE WHOLE SCREEN (issue 108, Dave 2026-10-13: "the Focus card becomes the whole screen: Jarvis eyebrow with Due
// Today, the task title, a countdown, then the existing controls in their existing styling ... and the More Waiting count").
// It was an overlay laid over the page's scroller: with Today scrolled it sat above the top edge (measured in a browser: the
// overlay at y -600 with Today scrolled 600), and the tab bar, the dock and the return pill painted over its foot. Each
// assertion below fails on the code before the change.
describe("Focus is the whole screen: the kicker, the countdown, the bars out of the way (issue 108)", () => {
  const face = { areaName: "Money", areaSlot: "yellow", reasons: [{ text: "Due Today", tone: "warn" as const }], text: "Create Invoice" };
  const props = { mode: "next" as const, onMode: noop, onClose: noop, face, waiting: 13, onDone: noop, onSkip: noop, onBackToNext: noop };
  const idle = { text: "15:00", caption: "Fifteen Minutes", live: false };
  const live = { text: "14:32", caption: "Left", live: true };
  const running = { text: "create invoice", line: "14:32 Left", over: false };
  const answers = { onRunDone: noop, onRunAgain: noop, onRunStop: noop };

  it("opens the face card with the Jarvis kicker over the facts line, which is where Due Today already is", () => {
    const { container } = render(<FocusScreen {...props} />);
    const card = container.querySelector(".focus-card")!;
    const kicker = card.querySelector(":scope > .eyebrow");
    expect(kicker).toHaveTextContent("Jarvis");
    expect(card.firstElementChild, "the first thing on the card").toBe(kicker);
    expect(kicker!.nextElementSibling, "straight over the facts line").toBe(card.querySelector(".facts"));
    expect(card.querySelector(".facts .fact.warn")).toHaveTextContent("Due Today");
    expect(card.querySelector(".facts .eyebrow"), "a label, never one of the facts").toBeNull();
  });

  it("puts the countdown between the title and the Start Now bar: the number in the hero face, its words in the one grey, no dot", () => {
    const { container } = render(<FocusScreen {...props} onStartNow={noop} onFifteen={noop} clock={idle} />);
    const card = container.querySelector(".focus-card")!;
    const title = card.querySelector(".focus-task")!;
    const clock = card.querySelector(".focus-clock")!;
    const go = card.querySelector(".btn-primary")!;
    expect(title.compareDocumentPosition(clock) & Node.DOCUMENT_POSITION_FOLLOWING, "after the title").toBeTruthy();
    expect(clock.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING, "before Start Now").toBeTruthy();
    expect(clock.querySelector(".hero-num")).toHaveTextContent("15:00");
    expect(clock.querySelector(".conn-meta")).toHaveTextContent("Fifteen Minutes");
    expect(clock.getAttribute("role"), "the window the button will run is not a clock that moves").toBeNull();
    expect(clock.textContent).not.toMatch(/[·•]/);
    expect(clock.querySelector(".fact, .eyebrow"), "no second kicker and no fact chip inside it").toBeNull();
  });

  it("leaves the four answers and the count exactly as they were, with the countdown on the card", () => {
    const { container } = render(<FocusScreen {...props} onStartNow={noop} onFifteen={noop} clock={idle} />);
    const card = container.querySelector(".focus-card")!;
    expect(card.querySelectorAll(".btn-primary")).toHaveLength(1);
    expect(card.querySelector(".btn-primary")).toHaveTextContent("Start Now");
    expect([...card.querySelectorAll(".focus-acts.skew .btn")].map((b) => b.textContent)).toEqual(["Done", "15 Min"]);
    expect(card.querySelector(".btn[aria-label='Focus 15 Minutes']")).not.toBeDisabled();
    expect(card.querySelector(".focus-skip")).toHaveTextContent("Not This One");
    expect(container.querySelector(".focus-rest")).toHaveTextContent("13 More Waiting");
  });

  it("draws no countdown when it is given none: a card with nothing to count says nothing", () => {
    const { container } = render(<FocusScreen {...props} onStartNow={noop} onFifteen={noop} />);
    expect(container.querySelector(".focus-clock")).toBeNull();
    expect(container.querySelector("[role='timer']")).toBeNull();
  });

  it("a live countdown is a timer, and the running card stops saying the same time a second time", () => {
    const { container, rerender } = render(<FocusScreen {...props} onStartNow={noop} clock={live} running={running} {...answers} />);
    const t = container.querySelector("[role='timer']")!;
    expect(t).toHaveTextContent("14:32");
    expect(t).toHaveTextContent("Left");
    expect(container.querySelector(".focus-live .conn-meta"), "said once, by the big clock").toBeNull();
    expect(container.querySelector(".focus-live")).toHaveTextContent("Create Invoice");
    expect([...container.querySelectorAll(".focus-live .btn")].map((b) => b.textContent)).toEqual(["Done", "Another 15", "Stop"]);
    // A block running on a card that is not on the screen has no clock here, so the running card keeps its own line.
    rerender(<FocusScreen {...props} onStartNow={noop} clock={null} running={running} {...answers} />);
    expect(container.querySelector("[role='timer']")).toBeNull();
    expect(container.querySelector(".focus-live .conn-meta")).toHaveTextContent("14:32 Left");
  });

  it("time's up reads 0:00 with its words in the amber the running card used, and the number stays the ink", () => {
    const { container } = render(
      <FocusScreen {...props} onStartNow={noop} clock={{ text: "0:00", caption: "15 Min Up", live: true, warn: true }}
        running={{ text: "create invoice", line: "15 Min Up", over: true }} {...answers} />,
    );
    expect(container.querySelector(".focus-clock .hero-num")).toHaveTextContent("0:00");
    expect(container.querySelector(".focus-clock .conn-meta")).toHaveClass("warn");
    expect(container.querySelector(".focus-clock .hero-num")).not.toHaveClass("warn");
    expect(container.querySelector(".focus-live .conn-meta"), "the amber is said once too").toBeNull();
    expect(css("components.css")).toMatch(/\.focus-live \.conn-meta\.warn, \.focus-clock \.conn-meta\.warn \{ color: var\(--warn\); \}/);
  });

  it("holds the 15 Min capsule still while the block is beginning, so a second tap cannot book a second one", () => {
    const { container, rerender } = render(<FocusScreen {...props} onStartNow={noop} onFifteen={noop} clock={idle} fifteenBusy />);
    expect(container.querySelector(".btn[aria-label='Focus 15 Minutes']")).toBeDisabled();
    rerender(<FocusScreen {...props} onStartNow={noop} onFifteen={noop} clock={idle} />);
    expect(container.querySelector(".btn[aria-label='Focus 15 Minutes']")).not.toBeDisabled();
  });

  it("the Quick Wins card, the end of a deck and an empty deck draw no countdown (Quick Wins has its own 10:00 run line)", () => {
    const wins = render(<FocusScreen {...props} mode="wins" wins={{ done: 1, total: 5, clock: "9:12" }} />);
    expect(wins.container.querySelector(".focus-clock")).toBeNull();
    expect(wins.container.querySelector(".focus-run-line")).toHaveTextContent("9:12 Left");
    wins.unmount();
    const end = render(<FocusScreen {...props} finale={{ title: "3 Down", sub: "A Clean Sweep" }} />);
    expect(end.container.querySelector(".focus-clock, .eyebrow")).toBeNull();
    end.unmount();
    const none = render(<FocusScreen {...props} face={null} />);
    expect(none.container.querySelector(".focus-clock, .eyebrow")).toBeNull();
  });

  it("the stylesheet makes it the whole screen: fixed to the viewport, scrolling inside itself, the three bars hidden and not removed", () => {
    const c = css("components.css");
    const fixedRule = c.match(/\n\.focus-screen \{ position: fixed;([^}]*)\}/)?.[1] ?? "";
    expect(fixedRule, "fixed, so a scrolled Today cannot move it, and in the band that can be seen, as a sheet is (shared/viewport.ts)")
      .toMatch(/^ top: var\(--vv-top, 0px\); bottom: auto; height: var\(--vv-h, 100dvh\); overflow-y: auto; overscroll-behavior: contain;/);
    expect(fixedRule, "the page's own background and the overlay's own z-index stay").not.toMatch(/background|z-index/);
    expect(c).toMatch(/\.search-overlay \{ position: absolute; inset: 0; z-index: 50; background: var\(--bg\);/);
    // The bars step aside the way a sheet's scrim moves them: hidden, never removed, so .app-scroll keeps its height and
    // Today is exactly where it was when Focus closes.
    expect(c).toMatch(/body:has\(\.focus-screen\) :is\(\.tab-bar, \.voice-dock, \.return-pill\) \{ visibility: hidden; \}/);
    expect(c).not.toMatch(/body:has\(\.focus-screen\)[^{]*\{[^}]*display:\s*none/);
    // The bottom of the page clears the home indicator.
    expect(c).toMatch(/\.focus-screen \.focus-body \{[^}]*padding-bottom: calc\(var\(--s-10\) \+ var\(--safe-bottom\)\);/);
  });

  it("a toast and its Undo, and the completion burst, stay above the screen", () => {
    const c = css("components.css");
    // The screen lives inside .app-scroll's layer (z-index 1), under the toast dock (2); the burst is fixed with the screen
    // and one above it, in the same layer.
    for (const f of ["glass-dark.css", "glass-light.css"]) {
      expect(css(f), f).toMatch(/\.app-scroll \{ position: relative; z-index: 1; background: transparent; \}/);
    }
    expect(c).toMatch(/\.toast-dock \{ position: relative; z-index: 2;/);
    expect(c).toMatch(/\.focus-screen ~ \.burst \{ position: fixed; z-index: 51;/);
    // Docked at the foot of the screen while it is open, clear of the home indicator, in the shell's column (no reflow).
    expect(c).toMatch(/body:has\(\.focus-screen\) \.toast-dock \{ order: 1; transform: translateY\(calc\(-1 \* var\(--safe-bottom\)\)\); \}/);
  });

  it("the countdown's rule moves nothing about the type: no family, weight, size, spacing or colour of its own", () => {
    const rule = css("components.css").match(/\.focus-clock \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/display: flex; flex-wrap: wrap; align-items: baseline;/);
    expect(rule).not.toMatch(/font|letter-spacing|line-height|color|background|opacity/);
  });
});

describe("the stylesheet holds the review's visual fixes", () => {
  const c = css("components.css");
  const r = css("ruled.css");
  const d = css("jarvis-design-system.css");

  it("a wrapped facts line draws its separator as the LEADING dot of the next fact, clipped at a line start (D7)", () => {
    expect(c).toMatch(/\.conn-meta:not\(\.facts\):has\(> \.fact\) \{ display: block; -webkit-line-clamp: none; overflow: hidden; \}/);
    expect(c).toMatch(/\.conn-meta:not\(\.facts\) > \.fact \{ position: relative; margin: 0 var\(--s-3\) 0 calc\(-1 \* var\(--s-3\)\); padding-left: var\(--s-3\); \}/);
    expect(c).toMatch(/\.conn-meta:not\(\.facts\) > \.fact \+ \.fact::before \{\s*content: "\\00B7"; position: absolute; left: 0;/);
    // ...and the trailing dot that stranded itself at a line's end is gone
    expect(c).toMatch(/\.conn-meta:not\(\.facts\) > \.fact:not\(:last-child\)::after \{ content: none; \}/);
  });

  it("the Today header is the page: no wash, no ramp, no fill, in either theme (Dave 2026-10-11: \"It shouldn't look like a card\")", () => {
    expect(c).toMatch(/\.today-hero, \.today-hero\.hero-morning, \.today-hero\.hero-evening \{ background: none; \}/);
    expect(c).not.toMatch(/\.today-hero\.hero-(morning|evening) \{\s*background: linear-gradient/);
    expect(c).not.toMatch(/\.today-hero::before/);
    expect(c).toMatch(/\.today-hero \{ padding: var\(--s-3\) var\(--s-4\) var\(--s-3\); \}/);
  });

  it("the goal tile is the neutral tile (a count with no state, not the key's green) and the due tile is as deep in daylight", () => {
    expect(r).toMatch(/\.ruled \.st-goal, \.ruled \.st-quiet \{ background: var\(--press-3\); color: var\(--tx-2\); \}/);
    expect(r).not.toMatch(/\.ruled \.st-goal\s*\{[^}]*--good/);
    expect(r).toMatch(/\.ruled \.st-warn\s*\{ background: color-mix\(in srgb, var\(--warn\) 16%, transparent\);/);
  });

  it("a placeholder is a hint: the quiet ink, not the typed ink's next of kin", () => {
    expect(d).toMatch(/\.input::placeholder \{ color: var\(--tx-quiet\); \}/);
    expect(d).toMatch(/\.search-bar input::placeholder \{ color: var\(--tx-quiet\); \}/);
  });

  it("an icon beside a capsule's label has its gap, in the capsule itself", () => {
    expect(c).toMatch(/\.row-act \{ justify-content: center; gap: var\(--s-2\);/);
  });

  it("the dealt task's check rides the same 46px slot as the discs under it, and the mail rows wear the squircle", () => {
    expect(c).toMatch(/\.stream-grouped \.hl \.task-check-tap \{ width: calc\(30px \+ 2 \* var\(--s-2\)\); \}/);
    expect(c).toMatch(/\.stream-grouped \.notice-vrow \.notice-disc, \.stream-grouped \.notice-card-asrow \.notice-disc \{ border-radius: var\(--r-sm\); \}/);
  });

  it("a notice row's grey line wraps to two lines and then ends; titles balance instead of orphaning a word", () => {
    expect(c).toMatch(/\.notice-card\.notice-card-wrap \.conn-meta \{\s*white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;/);
    expect(c).toMatch(/\.notice-card \.conn-name \{[^}]*text-wrap: balance;/);
  });

  it("the orphaned rules of the controls that left are gone", () => {
    for (const gone of [".focus-row", ".draft-clear", ".plan-cta.late-armed", ".plan-cta.plan-cta-ghost"]) {
      expect(c.includes(gone + " ") || c.includes(gone + "{"), gone).toBe(false);
    }
    expect(r.includes(".focus-row")).toBe(false);
  });
});
