// @vitest-environment jsdom
// EMAIL ON TODAY (docs/jarvis-unified, slice 08; IMPLEMENTATION-SPEC.md 08
// E15, 09 T1, 12; prompt 08 "Verify before completing"; Email Build Spec section 7;
// issue 112, Dave 2026-10-13). The band over the real Waiting service in the
// in-memory Store and a recording session: the ONE combined paused-replies card
// and nothing proposed, the open Waiting follow-ups that are due or overdue
// under it, five at most with no padding, a tomorrow follow-up kept off Today,
// and each row opening Email on a focus.
//
// REWRITTEN FOR ISSUE 112. These tests used to cover "committed email-origin
// items" too: a task or an event a capture had made was a band row, a second,
// email-flavoured copy of what Tasks and Schedule already show on Today. Ruling
// 18: an email-derived task or event appears on Today exactly once, as a normal
// one, and the combined replies card is the only email-specific surface. The
// band takes no task or schedule input any more; the page-level proof that the
// item is drawn once is TodayFlow.email.test.tsx.
import { describe, it, expect, afterEach } from "vitest";
import type { ComponentType } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import EmailToday from "./EmailToday";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { WaitingService } from "../substrate/waiting/WaitingService";
import type { RpcClient } from "../substrate/commands/errors";

const USER = "user-1";
const TODAY = "2026-10-03";
// paused_sends (migration 0068): `count` paused sends, `replies` of them replies. candidate_review_count is answered
// too, with a big number, so a test proves Today never draws it (spec section 7, Dave 2026-10-12).
const client = (count: number, replies = count): RpcClient => ({ rpc: async (fn) => ({ data: fn === "paused_sends" ? { count, replies, drafts: [] } : fn === "candidate_review_count" ? { count: 9, messages: 3 } : { error: "NOT_FOUND" }, error: null }) });
const missing: RpcClient = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.paused_sends" } }) };

async function world() {
  const store = new Store(new InMemoryAdapter());
  const tasks = new TasksService(store, USER);
  const schedule = new ScheduleService(store, USER);
  const waiting = new WaitingService(store, USER);
  const task = (text: string, due: string | null, email = true) => store.create(USER, "task", { text, category: "", done: false, due, ...(email ? { fromThread: "t-x" } : {}) });
  const event = (title: string, date: string, start: string, email = true) => store.create(USER, "event", { title, date, start, end: "10:15", ...(email ? { source: { type: "email", ref: "t-x", at: 1 } } : {}) });
  const track = (title: string, followUpOn: string | undefined, o: Record<string, unknown> = {}) =>
    waiting.create({ title, waitingFor: "it", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-01T10:00:00Z", ...(followUpOn ? { followUpOn } : {}), ...o });
  return { store, tasks, schedule, waiting, task, event, track };
}
const rows = () => [...document.querySelectorAll("[data-email-row]")].map((r) => `${r.getAttribute("data-email-row")}:${(r.querySelector(".conn-name") as HTMLElement).textContent}`);

afterEach(cleanup);

describe("Email on Today", () => {
  it("the paused card leads in Dave's words, carries no title or amount, and opens Email's recovery list; the review count is never on Today", async () => {
    const w = await world();
    const opened: unknown[] = [];
    render(<EmailToday client={client(2)} waiting={w.waiting} today={TODAY} onOpenEmail={(f) => opened.push(f)} />);
    await waitFor(() => expect(rows()).toEqual(["paused:2 Replies Need Your Review"]));
    expect(document.body.textContent).not.toMatch(/\$|Con Edison|142|to Review|Items/);
    fireEvent.click(document.querySelector("[data-email-row='paused']") as HTMLElement);
    expect(opened).toEqual([{ kind: "paused" }]);
  });

  it("a mixed or compose-only pause says Messages; no paused send, or a database without 0068, draws no card", async () => {
    const w = await world();
    render(<EmailToday client={client(3, 2)} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} />);
    await waitFor(() => expect(rows()).toEqual(["paused:3 Messages Need Your Review"]));
    cleanup();
    const empty: boolean[] = [];
    render(<EmailToday client={missing} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} onEmptyChange={(e) => empty.push(e)} />);
    await waitFor(() => expect(empty.at(-1)).toBe(true));
    expect(document.querySelector("[data-email-today]")).toBeNull();
  });

  it("open Waiting follow-ups due today or overdue ride under the card; a later one, an undated one and a resolved one do not; five at most, nothing padded", async () => {
    const w = await world();
    await w.track("Review the transcript", "2026-10-01");
    await w.track("Peña's Transcript", TODAY);
    await w.track("Tomorrow's thing", "2026-10-04");
    await w.track("Later", "2026-10-09");
    await w.track("No date", undefined);
    await w.track("Resolved already", TODAY, { status: "resolved" });
    const empty: boolean[] = [];
    render(<EmailToday client={client(2)} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} onEmptyChange={(e) => empty.push(e)} />);
    await waitFor(() => expect(rows().length).toBe(3));
    expect(rows()).toEqual(["paused:2 Replies Need Your Review", "waiting:Review the transcript", "waiting:Peña's Transcript"]);
    expect(document.body.textContent).not.toMatch(/Tomorrow|Later|No date|Resolved already/);
    expect(empty.at(-1)).toBe(false);
  });

  // ISSUE 112. The regression this file is here for: the band used to draw an email-origin task or event as a row of its
  // own, so one approved item showed in the band and again in the Today stream. It has no task or schedule input now;
  // even a caller that still hands it both draws no task or event row.
  it("a task or an event from an email, due today, is never a band row: only the card and Waiting ever render", async () => {
    const w = await world();
    await w.task("Submit the roster", TODAY);
    await w.task("Review the transcript", "2026-10-01");
    await w.event("Quick Call About the Deposit", TODAY, "10:00");
    await w.track("Peña's Transcript", TODAY);
    const Band = EmailToday as unknown as ComponentType<Record<string, unknown>>;
    render(<Band client={client(1)} tasks={w.tasks} schedule={w.schedule} waiting={w.waiting} today={TODAY} excludeIds={[]} onOpenEmail={() => {}} onOpenEntity={() => {}} />);
    await waitFor(() => expect(rows().length).toBe(2));
    expect(rows()).toEqual(["paused:1 Reply Needs Your Review", "waiting:Peña's Transcript"]);
    expect(document.body.textContent).not.toMatch(/Submit the roster|Review the transcript|Quick Call|Due Today|Was Due/);
    expect([...document.querySelectorAll("[data-email-row]")].map((r) => r.getAttribute("data-email-row"))).toEqual(["paused", "waiting"]);
  });

  it("with only an email task or event due and no card and no follow-up, the band is empty and says so", async () => {
    const w = await world();
    await w.task("Submit the roster", TODAY);
    await w.event("Quick Call About the Deposit", TODAY, "10:00");
    const empty: boolean[] = [];
    const Band = EmailToday as unknown as ComponentType<Record<string, unknown>>;
    render(<Band client={client(0)} tasks={w.tasks} schedule={w.schedule} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} onEmptyChange={(e: boolean) => empty.push(e)} />);
    await waitFor(() => expect(empty.at(-1)).toBe(true));
    expect(document.querySelector("[data-email-today]")).toBeNull();
  });

  it("with no count and nothing due it renders nothing and says so", async () => {
    const w = await world();
    const empty: boolean[] = [];
    render(<EmailToday client={client(0)} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} onEmptyChange={(e) => empty.push(e)} />);
    await waitFor(() => expect(empty.at(-1)).toBe(true));
    expect(document.querySelector("[data-email-today]")).toBeNull();
  });

  it("eight due follow-ups are five rows, the card never the one cut", async () => {
    const w = await world();
    for (let i = 0; i < 8; i++) await w.track(`Follow-up ${i}`, TODAY);
    render(<EmailToday client={client(1)} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} />);
    await waitFor(() => expect(rows().length).toBe(5));
    expect(rows()[0]).toBe("paused:1 Reply Needs Your Review");
  });

  it("a waiting row opens Email on that record", async () => {
    const w = await world();
    const id = await w.track("Peña's Transcript", "2026-10-02");
    const opened: unknown[] = [];
    render(<EmailToday client={null} waiting={w.waiting} today={TODAY} onOpenEmail={(f) => opened.push(f)} />);
    await waitFor(() => expect(rows()).toEqual(["waiting:Peña's Transcript"]));
    expect(screen.getByText("Waiting On Coach Miller")).toBeInTheDocument();
    expect(screen.getByText("Follow Up Was Oct 2")).toHaveClass("fact", "red");
    fireEvent.click(document.querySelector("[data-email-row='waiting']") as HTMLElement);
    expect(opened).toEqual([{ kind: "waiting", id }]);
  });

  // The band mounts once; the page bumps refreshKey on every reload (TodayFlow's mailTick), so a Track This or a pause
  // that landed after it mounted is read on the next repaint, with no subscription of its own and no timer.
  it("reads again when the page's refreshKey moves, so a follow-up tracked after it mounted shows", async () => {
    const w = await world();
    const empty: boolean[] = [];
    const ui = (key: number) => <EmailToday client={null} waiting={w.waiting} today={TODAY} refreshKey={key} onOpenEmail={() => {}} onEmptyChange={(e) => empty.push(e)} />;
    const { rerender } = render(ui(0));
    await waitFor(() => expect(empty.at(-1)).toBe(true));
    await w.track("Peña's Transcript", TODAY);
    rerender(ui(0));
    expect(rows()).toEqual([]);
    rerender(ui(1));
    await waitFor(() => expect(rows()).toEqual(["waiting:Peña's Transcript"]));
    expect(empty.at(-1)).toBe(false);
  });
});

// THE CATALOG, ON THIS BAND (Dave 2026-10-05: a thin grey subtext was back on the Email card, "Open Email to
// Review" under "5 Email Items to Review" and "Task · Due Today"). The rules it broke: a row with nothing to say
// shows nothing; a fact with a meaning wears its key colour (due amber, late red); the separator is drawn by CSS,
// never a middle dot baked into a string (R6); at most one grey run per row; a type icon wears its type's colour.
describe("Email on Today follows the visual catalog", () => {
  async function band() {
    const w = await world();
    await w.track("Peña's Transcript", TODAY);
    await w.track("Review the transcript", "2026-10-01");
    render(<EmailToday client={client(5)} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll("[data-email-row]").length).toBe(3));
    return document.querySelector(".email-today-band") as HTMLElement;
  }

  it("the paused row has a title and no subtext line", async () => {
    const root = await band();
    const row = root.querySelector('[data-email-row="paused"]')!;
    expect(row.querySelector(".facts")).toBeNull();
    expect(row.textContent).not.toMatch(/Open Email to Review/);
  });

  it("no fact carries a baked-in middle dot, and no row says 'Task' or 'Schedule' for what an icon would say", async () => {
    const root = await band();
    for (const f of root.querySelectorAll(".fact")) expect(f.textContent).not.toMatch(/[·•]/);
    expect(root.textContent).not.toMatch(/\bTask\b|\bSchedule\b/);
  });

  it("due is amber, late is red, and the row's grey appears at most once", async () => {
    const root = await band();
    const byText = (t: string) => [...root.querySelectorAll(".fact")].find((f) => f.textContent === t) as HTMLElement;
    expect(byText("Follow Up Today")).toHaveClass("warn");
    expect(byText("Follow Up Was Oct 1")).toHaveClass("red");
    for (const row of root.querySelectorAll("[data-email-row]")) {
      const grey = [...row.querySelectorAll(".fact")].filter((f) => !f.classList.contains("warn") && !f.classList.contains("red") && !f.classList.contains("date"));
      expect(grey.length).toBeLessThanOrEqual(1);
    }
  });

  // A facts line ellipsizes only its LAST fact. The waiting row led with the long free-text name and ended on the amber
  // "Follow Up Today", so a long counterparty pushed the colour off the row before it shortened itself.
  it("the toned fact leads and the free-text name is last, so a long name gives way before the colour does", async () => {
    const root = await band();
    const waiting = [...root.querySelectorAll('[data-email-row="waiting"]')].find((r) => r.textContent?.includes("Peña's Transcript"))!;
    const facts = [...waiting.querySelectorAll(".fact")];
    expect(facts.map((f) => f.textContent)).toEqual(["Follow Up Today", "Waiting On Coach Miller"]);
    expect(facts[0]).toHaveClass("warn");
    expect(facts.at(-1)).not.toHaveClass("warn");
    expect(facts.at(-1)).not.toHaveClass("red");
  });

  it("a row with a fact is one facts line, and the paused row, which has none, draws no line at all", async () => {
    const root = await band();
    for (const row of root.querySelectorAll("[data-email-row]")) {
      const lines = row.querySelectorAll(".facts").length;
      expect(lines).toBe(row.getAttribute("data-email-row") === "paused" ? 0 : 1);
    }
  });

  // RULE 13 (Dave 2026-10-05): an icon that says what a row IS wears its type's colour, never the text ink. The band
  // holds two types now: Email teal and Waiting purple. Task red and Event sky left with the rows that used them.
  it("a type icon wears its type's colour: the envelope is Email teal, the hourglass is Waiting purple", async () => {
    const root = await band();
    expect(root.querySelector('[data-email-row="paused"] .email-today-ic')).toHaveClass("cat-fg-teal");
    for (const ic of root.querySelectorAll('[data-email-row="waiting"] .email-today-ic')) expect(ic).toHaveClass("cat-fg-purple");
    expect(root.querySelectorAll(".email-today-ic.cat-fg-red, .email-today-ic.cat-fg-sky").length).toBe(0);
  });
});
