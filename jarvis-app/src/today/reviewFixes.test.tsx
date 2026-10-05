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

  it("the stylesheet keeps the segmented labels on one line, the music chip on the card's column, and the card centred", () => {
    const c = css("components.css");
    expect(c).toMatch(/\.focus-controls \.seg \{ white-space: nowrap; \}/);
    expect(c).toMatch(/\.focus-controls \.chip-row \{[^}]*padding: 0;[^}]*overflow: visible;[^}]*mask-image: none;/);
    expect(c).toMatch(/\.focus-screen \.focus-body \{ justify-content: center;/);
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

  it("the Today hero's wash fades into the page instead of ending in a seam, in both themes", () => {
    for (const theme of ["dark", "light"]) {
      for (const part of ["morning", "evening"]) {
        const m = c.match(new RegExp(`\\[data-theme="${theme}"\\] \\.today-hero\\.hero-${part} \\{\\s*background: linear-gradient\\(180deg, transparent 30%, var\\(--bg\\) 100%\\)`));
        expect(m, `${theme} ${part}`).not.toBeNull();
      }
    }
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
