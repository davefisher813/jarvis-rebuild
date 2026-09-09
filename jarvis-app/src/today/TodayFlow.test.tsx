// @vitest-environment jsdom
// TODAY-F-14 (2026-09-05): a failed first load left the skeleton up forever.
// reload() had no catch and cleared `loading` only on its success path, so a
// first launch with no signal (or any throw in the heal or the reads) was a
// skeleton with no card and no retry until another tab was visited. The
// page now renders with what it has and the toast carries the retry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, usePeople, useTasks } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { ScheduleService } from "../schedule/ScheduleService";
import { setCategoryRegistry } from "../shared/categories";
import { heldBy } from "../brain/hardLines";
import { todayISO } from "../schedule/calendar";
import type { AIService } from "../ai/AIService";
import TodayFlow from "./TodayFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

// UP-MIND-01 class (2026-09-07): the birthday row's own "Text" door opens
// MessageDraftSheet without ever gathering voice, same bug as the Tasks and
// Chat doors fixed alongside it.
const draftProps: { voice?: string }[] = [];
vi.mock("../people/MessageDraftSheet", () => ({
  default: (props: { voice?: string }) => { draftProps.push(props); return null; },
}));

// UP-MIND-23 class (2026-09-07): onAIPlan below.
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: true } as unknown as AIService) }));
const aiPlanOpts: { profile?: string; strands?: unknown[] }[] = [];
vi.mock("../schedule/planDayAI", async () => {
  const actual = await vi.importActual<typeof import("../schedule/planDayAI")>("../schedule/planDayAI");
  return {
    ...actual,
    aiPlanDay: (...args: unknown[]) => {
      aiPlanOpts.push(args[5] as { profile?: string; strands?: unknown[] });
      return Promise.resolve({ items: [], leanedOn: [] });
    },
  };
});

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

function mount() {
  return render(
    <NotesProvider userId={"today-fail-" + Math.random().toString(36).slice(2)}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

beforeEach(() => { showToast.mockReset(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("TodayFlow first load failure (TODAY-F-14)", () => {
  it("drops the skeleton, renders the page, and offers Retry on the toast", async () => {
    vi.spyOn(ScheduleService.prototype, "healPlanDuplicates").mockRejectedValueOnce(new Error("no signal"));
    const { container } = mount();
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    const call = showToast.mock.calls[0]![0] as { message: string; actionLabel?: string; onAction?: () => void };
    expect(call.message).toBe("Couldn't load today · Check your connection");
    expect(call.actionLabel).toBe("Retry");
    await waitFor(() => expect(container.querySelector(".skel-screen")).toBeNull());
    expect(container.querySelector(".screen")).not.toBeNull();

    // Signal is back: Retry re-runs the load and nothing complains again.
    await act(async () => { call.onAction!(); });
    await new Promise((r) => setTimeout(r, 50));
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("a load that answers shows no toast and no skeleton", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".skel-screen")).toBeNull());
    expect(showToast).not.toHaveBeenCalled();
  });
});

// TODAY-F-11 (2026-09-05): "Undo after deleting an event from Today restores a
// stripped copy." The undo re-created the event from seven hand-copied
// fields, so a repeating block came back with no end date, no attached tasks,
// no Training Door, no skipped days and a new id.
describe("TodayFlow: Undo after deleting an event (TODAY-F-11)", () => {
  it("puts the whole event back, under its own id", async () => {
    const { useSchedule } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_EVENT } = await import("../schedule/types");
    const { todayISO, addDays } = await import("../schedule/calendar");
    let sched: ScheduleService | null = null;
    function Grab() { sched = useSchedule(); return null; }
    render(
      <NotesProvider userId="today-undo-event">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Grab />
          <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    // Tomorrow, where Today lists it whatever the clock says.
    const id = (await sched!.createEvent("Lift", {
      date: tomorrow, start: "17:30", end: "18:30", recurrence: "daily",
      until: addDays(today, 60), taskIds: ["t1"],
    }))!;
    await sched!.editGymDoor(id, true);
    await sched!.addExdate(id, addDays(today, 4));
    notifyFreshLists(ENTITY_EVENT);
    await waitFor(() => expect(screen.getByText("Lift")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lift"));
    // EVENTS ARE FIRST-CLASS (2026-09-09): tapping an event opens its PAGE
    // now, the way tapping a project or a goal always has. The sheet is one
    // tap further in, on the page's Edit.
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByText("Edit Event");
    fireEvent.click(screen.getByText("Delete Event"));
    await waitFor(() => expect(showToast.mock.calls.some((c) => (c[0] as { message: string }).message === "Event deleted")).toBe(true));
    expect(await sched!.event(id)).toBeNull();
    const call = showToast.mock.calls.find((c) => (c[0] as { message: string }).message === "Event deleted")![0] as { onAction: () => Promise<void> };
    await act(async () => { await call.onAction(); });
    const back = (await sched!.event(id))!;
    expect(back.gym).toBe(true);
    expect(back.until).toBe(addDays(today, 60));
    expect(back.taskIds).toEqual(["t1"]);
    expect(back.exdates).toEqual([addDays(today, 4)]);
  });
});

// UP-CORE-09 (2026-09-05): the Momentum Chain, on the tab where ticks happen.
// momentum.ts shipped with item 7 and was wired to the Tasks tab alone, so a
// tick on Today bought a toast and the next small thing stayed four taps away.
describe("TodayFlow: the Momentum Chain (UP-CORE-09)", () => {
  it("offers the next best thing after a tick, and Not Now takes it back", async () => {
    const { useTasks } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_TASK } = await import("../notes/types");
    const { todayISO } = await import("../schedule/calendar");
    let svc: import("../tasks/TasksService").TasksService | null = null;
    function Grab() { svc = useTasks(); return null; }
    render(
      <NotesProvider userId="today-momentum">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Grab />
          <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    const today = todayISO();
    await svc!.createTask("Email the coach", { category: "c1", due: today, estimateMin: 15 });
    await svc!.createTask("Book the field", { category: "c1", due: today, estimateMin: 15 });
    notifyFreshLists(ENTITY_TASK);
    await waitFor(() => expect(screen.getByText("Book the field")).toBeInTheDocument());

    // Tick the dealt task; the chain fills the slot it left.
    fireEvent.click(screen.getAllByLabelText("Mark done")[0]!);
    await waitFor(() => expect(screen.getByText(/Keep going/)).toBeInTheDocument());
    // The task's own length is what makes it startable (UP-CORE-02).
    expect(screen.getAllByText(/15m/).length).toBeGreaterThan(0);

    // Waving it off empties the slot. Two of those quiet the chain for the
    // day, which is momentum.ts's own rule, unchanged.
    const chain = screen.getByText(/Keep going/).closest(".notice-swipe")!;
    fireEvent.click(chain.querySelector(".notice-dismiss")!);
    await waitFor(() => expect(screen.queryByText(/Keep going/)).toBeNull());
  });
});

// BRAIN-F-05 class (2026-09-07): the day re-flow's Values guard compared a
// hard line's typed word against the moved block's raw category id, so a
// Protect line on a real area ("School", "Gym") never once held a move: the
// id it was checking could not spell what the user typed. Same bug shape as
// the two prompt leaks fixed the same week (planDayAI.ts, review/seal.ts),
// here on the automatic re-flow path instead of a prompt.
describe("TodayFlow: a Protect line matches the area's name, not its id (BRAIN-F-05 class)", () => {
  afterEach(() => setCategoryRegistry([]));

  it("holds a move once the category resolves to the name the user typed", async () => {
    const { reflowHold } = await import("./TodayFlow");
    // A real category id: uuid-shaped, and nothing like the word it names,
    // the same fixture shape planDayAI.test.ts and seal.test.ts landed on
    // after a first attempt ("c-school") accidentally still spelled "school".
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    setCategoryRegistry([{ id, name: "School", color: "blue" }]);
    const line = { kind: "protect" as const, match: "School" };
    const event = { data: { title: "Pickup", category: id } };

    // BEFORE the fix this call passed the raw id as `category`, which is
    // exactly what a direct heldBy call still does here: no match.
    const beforeFix = heldBy([line], { action: "reflow", blockTitle: event.data.title, category: event.data.category });
    expect(beforeFix).toBeNull();

    // AFTER: reflowHold resolves the id to "School" first, so the line the
    // user actually typed holds the move.
    const afterFix = reflowHold([line], event);
    expect(afterFix).toEqual(line);
  });

  it("still returns null for a category with no hard line on it", async () => {
    const { reflowHold } = await import("./TodayFlow");
    const workId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    setCategoryRegistry([{ id: workId, name: "Work", color: "orange" }]);
    const line = { kind: "protect" as const, match: "School" };
    expect(reflowHold([line], { data: { title: "Standup", category: workId } })).toBeNull();
  });

  it("a deleted category (unresolvable id) never falls back to matching the raw id", async () => {
    const { reflowHold } = await import("./TodayFlow");
    const line = { kind: "protect" as const, match: "0f8fad5b-d9cb-469f-a165-70867728950e" };
    expect(reflowHold([line], { data: { title: "Gone", category: "0f8fad5b-d9cb-469f-a165-70867728950e" } })).toBeNull();
  });
});

// UP-MIND-01 class (2026-09-07): the birthday card's "Text" button, the
// third of three MessageDraftSheet doors missing voice (Tasks and Chat are
// the other two, fixed the same commit set).
describe("TodayFlow: the birthday card's Text door gathers a real voice (UP-MIND-01 class)", () => {
  function SeededBirthday() {
    const people = usePeople();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      (async () => {
        // Local calendar day, not toISOString (reads UTC and would land on
        // the wrong day near midnight in some zones - the exact class of
        // bug todayISO in ai/useAIContext.ts exists to avoid).
        const now = new Date();
        const mmdd = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        await people.create({ name: "Priya Shah", group: "contacts", phone: "555-0102", birthday: mmdd });
        setReady(true);
      })();
    }, [people]);
    return ready ? (
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    ) : null;
  }

  it("passes MessageDraftSheet a non-empty voice", async () => {
    draftProps.length = 0;
    render(<NotesProvider userId="today-birthday-voice"><SeededBirthday /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Priya Shah")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    await waitFor(() => expect(draftProps.length).toBeGreaterThan(0));
    // BEFORE the fix this prop was simply never passed. AFTER, it resolves
    // to at least the identity line every real context carries.
    await waitFor(() => expect(draftProps.at(-1)!.voice).toMatch(/^User: /));
  });
});

// UP-MIND-23 class (2026-09-07): ScheduleFlow's Plan My Day has passed
// `profile` (the assembled context, as text) and attributed `strands` to
// aiPlanDay since item 04's attribution work landed. Today's own copy of
// the same call never picked up either option, so a plan built from Today
// reasoned from routine hours and energy alone - the model could never cite
// a fact or a pattern the way a Schedule-built plan already can.
describe("TodayFlow: Plan My Day carries the same brain Schedule's does (UP-MIND-23 class)", () => {
  function SeededPlanTask() {
    const tasks = useTasks();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      (async () => {
        await tasks.createTask("Draft the proposal", { due: todayISO() });
        setReady(true);
      })();
    }, [tasks]);
    return ready ? (
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    ) : null;
  }

  // A TEST THAT ONLY PASSES BEFORE 6 PM (found 2026-09-09 at 19:04, going red
  // with nothing having changed; it reproduces on an untouched checkout).
  // Today shifts into its EVENING posture at the later of 6 PM and the end of
  // work hours (today/evening.ts, isEvening), and in that posture there is no
  // day-draft card, so there is no "Not Today" to tap and this test could not
  // reach the refine path it exists to prove. The clock is pinned to a morning
  // so the posture is the one the test is written for, at every hour anyone
  // runs it. shouldAdvanceTime keeps real time moving underneath, which is
  // what waitFor needs to resolve at all.
  beforeEach(() => {
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(morning);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("passes a real profile and a strands array, not the options Schedule alone used to get", async () => {
    aiPlanOpts.length = 0;
    render(<NotesProvider userId="today-planday-brain"><SeededPlanTask /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Draft the proposal")).toBeInTheDocument());
    // THE DAY LOOP (item 14) drafts today the instant loading finishes,
    // which has already happened by the line above -- so a standing draft
    // for today exists before this test ever opens the sheet. PlanDaySheet
    // seeds from that draft on purpose (merge phase 1: "the card already
    // showed him a plan; re-plan must not silently renumber it"), and a
    // sheet seeded from a draft stands its AI refine down -- also on
    // purpose, per its own comment. Dismissing the card first, the same tap
    // a real person has ("Not Today"), is what actually reaches the
    // AI-refine path this test means to prove; opening the sheet against a
    // live draft proves nothing here, because the refine is SUPPOSED to
    // stand down in that case.
    fireEvent.click(screen.getByRole("button", { name: "Not Today" }));
    fireEvent.click(screen.getByRole("button", { name: /Plan My Day/ }));
    await waitFor(() => expect(aiPlanOpts.length).toBeGreaterThan(0));
    const opts = aiPlanOpts[0]!;
    // BEFORE the fix, this options object had no `profile` key at all and
    // `strands` was never sent (undefined, not even an empty array).
    expect(typeof opts.profile).toBe("string");
    expect(opts.profile).toContain("User:");
    expect(Array.isArray(opts.strands)).toBe(true);
  });
});
