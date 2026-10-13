// @vitest-environment jsdom
// ISSUE 112 (ruling 18, Dave 2026-10-13): "An email-derived task or event appears on Today exactly once, as a normal task
// or event. Email adds no second, email-flavored copy of the same item on Today. The combined replies card remains the only
// email-specific surface. Implement deduplication by item identity so nothing shows twice, and nothing Dave approved from
// an email disappears from Today either." (Email Build Spec 2026-10-08 section 7 and AC48.)
//
// The REAL Today page, over the real services in an in-memory Store, with the unified Email flag on (the build flag is a
// module constant, so it is answered for here exactly as connections/ConnectionsPage.test.tsx does). Before the change an
// approved email event was drawn by the Email band AND by the Next-event card and the TV guide, and an approved email task
// was drawn by the band and by nothing else (Up Next, the evening list and the day summary all kept it out, while the day
// ring still counted it). Each case below fails on that code.
//
// The TV guide (.sched-ticker) repeats the whole day to loop (it is frozen, laws/tvGuide.test.ts), so a title is counted
// OUTSIDE it, and separately inside the Email band.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { todayISO } from "../schedule/calendar";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { WaitingService } from "../substrate/waiting/WaitingService";
import { notifyFreshLists } from "../data/store";
import { ENTITY_TASK } from "../notes/types";
import TodayFlow from "./TodayFlow";

const flags = vi.hoisted(() => ({ intake: true }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "email_intake_v1" ? flags.intake : real.flagOn(f)) };
});
// The legacy mail band is its own suite (MailNotices.test.tsx). Here it only has to say whether it mounted.
vi.mock("./MailNotices", async () => {
  const { useEffect } = await import("react");
  return {
    default: function LegacyMail({ onEmptyChange }: { onEmptyChange?: (empty: boolean) => void }) {
      useEffect(() => { onEmptyChange?.(false); }, [onEmptyChange]);
      return <div data-legacy-mail="" />;
    },
  };
});
vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false }) }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
// The whole Today page mounts in each case; a loaded machine (the full suite, several runs at once) needs more than 5 seconds.
vi.setConfig({ testTimeout: 20000 });

const TODAY = todayISO();
const mail = { type: "email" as const, ref: "thread-1", ts: 1 };

interface Seeds { schedule: ScheduleService; tasks: TasksService; waiting: WaitingService }
async function mountWith(seed: (s: Seeds) => Promise<void>) {
  const userId = "email-once-" + Math.random().toString(36).slice(2);
  const store = new Store(new InMemoryAdapter());
  const svc: Seeds = { schedule: new ScheduleService(store, userId), tasks: new TasksService(store, userId), waiting: new WaitingService(store, userId) };
  await seed(svc);
  return Object.assign(render(
    <NotesProvider userId={userId} store={store}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>,
  ), { svc });
}

const leaves = (root: HTMLElement, text: string): Element[] =>
  [...root.querySelectorAll("*")].filter((n) => n.children.length === 0 && (n.textContent ?? "").trim().toLowerCase() === text.toLowerCase());
const inGuide = (n: Element) => !!n.closest(".sched-ticker");
const inBand = (n: Element) => !!n.closest(".email-today-band");
/** Copies of a title on the page outside the frozen TV guide and outside the Email band: Today's own surfaces for it. */
const onToday = (root: HTMLElement, text: string) => leaves(root, text).filter((n) => !inGuide(n) && !inBand(n)).length;
const inTheBand = (root: HTMLElement, text: string) => leaves(root, text).filter(inBand).length;
const inTheGuide = (root: HTMLElement, text: string) => leaves(root, text).filter(inGuide).length;
const bandRows = (root: HTMLElement) => [...root.querySelectorAll("[data-email-row]")].map((r) => r.getAttribute("data-email-row"));
const tile = (root: HTMLElement, cls: string) => root.querySelector(`.stat-tile.${cls}`)?.textContent ?? null;
/** The page has drawn the day and the Email band has had its read. */
const settled = async (root: HTMLElement, text: string) => {
  await waitFor(() => expect(leaves(root, text).length).toBeGreaterThan(0), { timeout: 4000 });
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
};

describe("Today with the Email flag on: an item an email made is drawn once (issue 112)", () => {
  beforeEach(() => {
    flags.intake = true;
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(TODAY + "T09:00:00"));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("an event a capture made is on Today once, outside the TV guide, and never in the Email band", async () => {
    const { container } = await mountWith(async ({ schedule }) => {
      await schedule.createEvent("Quick Call About the Deposit", { date: TODAY, start: "23:00", end: "23:15", source: mail, clientId: "emailcap_1" });
    });
    await settled(container, "Quick Call About the Deposit");
    expect(onToday(container, "Quick Call About the Deposit"), "the Next-event card, once").toBe(1);
    expect(inTheBand(container, "Quick Call About the Deposit"), "the band is no second copy").toBe(0);
    expect(inTheGuide(container, "Quick Call About the Deposit"), "the frozen guide still loops it, untouched").toBeGreaterThan(0);
    expect(bandRows(container)).toEqual([]);
    expect(container.querySelector(".email-today-band")).toBeNull();
  });

  it("a task a capture made is dealt as Your Move like any other task, and the band draws no task row for it", async () => {
    const { container } = await mountWith(async ({ tasks }) => {
      await tasks.createTask("Submit the roster", { due: TODAY, fromThread: "thread-1", source: mail });
    });
    await settled(container, "Submit the roster");
    expect(onToday(container, "Submit the roster"), "dealt in the Your Move row, once").toBe(1);
    expect(inTheBand(container, "Submit the roster")).toBe(0);
    expect(bandRows(container)).toEqual([]);
  });

  it("the day summary counts it, with the Tasks setting at its default: two email tasks due today are two due", async () => {
    const { container } = await mountWith(async ({ tasks }) => {
      await tasks.createTask("Submit the roster", { due: TODAY, fromThread: "thread-1", source: mail });
      await tasks.createTask("Review the transcript", { due: TODAY, fromThread: "thread-2", source: mail });
    });
    await settled(container, "Submit the roster");
    await waitFor(() => expect(tile(container, "st-warn")).toBe("2due"));
  });

  it("nothing approved disappears: in the evening the day's email tasks are in the open list, once each", async () => {
    vi.setSystemTime(new Date(TODAY + "T20:30:00"));
    const { container } = await mountWith(async ({ tasks }) => {
      await tasks.createTask("Submit the roster", { due: TODAY, fromThread: "thread-1", source: mail });
      await tasks.createTask("Review the transcript", { due: TODAY, fromThread: "thread-2", source: mail });
      await tasks.createTask("Plain task for comparison", { due: TODAY });
    });
    await settled(container, "Plain task for comparison");
    expect(container.textContent).toContain("Tonight");
    expect(onToday(container, "Submit the roster")).toBe(1);
    expect(onToday(container, "Review the transcript")).toBe(1);
    expect(onToday(container, "Plain task for comparison")).toBe(1);
    expect(bandRows(container)).toEqual([]);
  });

  // DECISION (the orchestrator's, with issue 112): only a task that carries the email source stamp is a normal Today task.
  // A task that only has a thread link, and no stamp, stays where the Tasks setting has always put it (From Email).
  it("a task with only a thread link and no email stamp stays out of Your Move and out of the count, and the band draws no row for it", async () => {
    const { container } = await mountWith(async ({ tasks, schedule }) => {
      await tasks.createTask("Thread only", { due: TODAY, fromThread: "thread-8" });
      await schedule.createEvent("Dentist Appointment", { date: TODAY, start: "23:00" });
    });
    await settled(container, "Dentist Appointment");
    expect(onToday(container, "Thread only")).toBe(0);
    expect(inTheBand(container, "Thread only")).toBe(0);
    expect(tile(container, "st-warn")).toBeNull();
  });

  it("a Waiting follow-up due today is still on Today, as the band's only row", async () => {
    const { container } = await mountWith(async ({ waiting, tasks, schedule }) => {
      await waiting.create({ title: "Peña's Transcript", waitingFor: "it", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-01T10:00:00Z", followUpOn: TODAY });
      await tasks.createTask("Submit the roster", { due: TODAY, fromThread: "thread-1", source: mail });
      await schedule.createEvent("Quick Call About the Deposit", { date: TODAY, start: "23:00", end: "23:15", source: mail, clientId: "emailcap_1" });
    });
    await settled(container, "Quick Call About the Deposit");
    await waitFor(() => expect(bandRows(container)).toEqual(["waiting"]));
    expect(inTheBand(container, "Peña's Transcript")).toBe(1);
    expect(container.querySelector(".email-today-band")!.textContent).not.toMatch(/Submit The Roster|Quick Call/i);
    expect(onToday(container, "Submit the roster")).toBe(1);
    expect(onToday(container, "Quick Call About the Deposit")).toBe(1);
  });

  // The band mounted once and read once, and the page passed it nothing to read again: a Track This that landed after the page
  // was up was missing until the app was reopened. The page bumps a counter on every reload now (mailTick), so the next repaint
  // (a background refresh, a write, coming back to the app) reads it.
  it("a follow-up tracked after the page is up shows on the next repaint of Today", async () => {
    const { container, svc } = await mountWith(async ({ tasks }) => {
      await tasks.createTask("Plain task for comparison", { due: TODAY });
    });
    await settled(container, "Plain task for comparison");
    expect(bandRows(container)).toEqual([]);
    await svc.waiting.create({ title: "Peña's Transcript", waitingFor: "it", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-01T10:00:00Z", followUpOn: TODAY });
    await act(async () => { notifyFreshLists(ENTITY_TASK); });
    await waitFor(() => expect(bandRows(container)).toEqual(["waiting"]));
    expect(inTheBand(container, "Peña's Transcript")).toBe(1);
  });

  it("one appointment that the Google import and an email both made is drawn once on Today: the approved copy", async () => {
    const { container } = await mountWith(async ({ schedule }) => {
      await schedule.createEvent("Phone Interview with Equinox", { date: TODAY, start: "23:00", end: "23:30", gcalId: "gcal-1" });
      await schedule.createEvent("Phone Interview", { date: TODAY, start: "23:00", end: "23:30", source: mail, clientId: "emailcap_2" });
    });
    await settled(container, "Phone Interview");
    expect(onToday(container, "Phone Interview")).toBe(1);
    expect(leaves(container, "Phone Interview with Equinox").length, "the Google copy is not drawn beside it, guide included").toBe(0);
    expect(container.querySelector(".sched-ticker")!.textContent).not.toMatch(/Equinox/);
  });
});

describe("Today with the Email flag off: the legacy path is untouched (issue 112)", () => {
  beforeEach(() => {
    flags.intake = false;
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(TODAY + "T09:00:00"));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); flags.intake = true; });

  it("an email task is still kept out of Your Move and the count, the old mail band still mounts, and the Email band does not", async () => {
    const { container } = await mountWith(async ({ tasks }) => {
      await tasks.createTask("Submit the roster", { due: TODAY, fromThread: "thread-1", source: mail });
      await tasks.createTask("Plain task for comparison", { due: TODAY });
    });
    await settled(container, "Plain task for comparison");
    expect(onToday(container, "Plain task for comparison"), "the plain task is dealt").toBe(1);
    expect(onToday(container, "Submit the roster"), "the mail task is the mail band's").toBe(0);
    expect(tile(container, "st-warn")).toBe("1due");
    expect(container.querySelector("[data-legacy-mail]")).not.toBeNull();
    expect(container.querySelector(".email-today-band")).toBeNull();
  });

  it("the Google copy and the email copy of one appointment are both drawn: the seal is the flag's", async () => {
    const { container } = await mountWith(async ({ schedule }) => {
      await schedule.createEvent("Phone Interview with Equinox", { date: TODAY, start: "23:00", end: "23:30", gcalId: "gcal-1" });
      await schedule.createEvent("Phone Interview", { date: TODAY, start: "23:00", end: "23:30", source: mail, clientId: "emailcap_2" });
    });
    await settled(container, "Phone Interview");
    expect(container.querySelector(".sched-ticker")!.textContent).toMatch(/Equinox/);
  });
});
