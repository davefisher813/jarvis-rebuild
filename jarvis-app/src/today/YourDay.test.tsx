// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import YourDay from "./YourDay";
import type { EventItem } from "../schedule/types";

// THE VIEW YOU ACT IN IS THE PAUSED CARD (Dave 2026-09-27: the TV guide moves
// at all times, a short day included). The tests below describe the
// actionable view (the Now band, the compressed day, the doors), so they
// render and then hold the card still, which is the one way to reach it.
const hold = (ui: React.ReactElement, options?: Parameters<typeof render>[1]) => {
  const r = render(ui, options);
  const t = r.container.querySelector(".ticker-toggle");
  if (t) fireEvent.click(t);
  return r;
};

const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "orgB" } });
const many = Array.from({ length: 8 }, (_, i) => ev("e" + i, String(8 + i).padStart(2, "0") + ":00"));

// The overflow describe below overrides HTMLElement.prototype.scrollHeight to
// force the ticker. Restoring it turned out not to be reliable (jsdom has no
// own descriptor to put back, and the restore ran in an order that still left
// 999 in place), and the symptom is nasty: every later test silently renders
// the ticker, which draws the day TWICE, so assertions fail with "found
// multiple elements" or miss non-ticker markup entirely.
//
// So the file pins the default explicitly instead of trying to undo the
// override. Every test starts from a day that fits unless it says otherwise.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 0 });
});

describe("YourDay", () => {
  // AMENDED 2026-09-22. This asserted the card was absent on a day that
  // fits, which gave the home page two different shapes depending on how
  // busy the day was. Dave: "I want the tv guide schedule to render at all
  // times on the home page. It looks awful the other way." The card is
  // always the card; only the MOTION is conditional.
  // AMENDED 2026-09-27 (Dave, on his phone at 8:51 PM with three rows left
  // and the card standing still: "the tv guide scroller is gone again ...
  // It should never be touched"). "Render at all times" means MOVE at all
  // times: a short day is repeated until the loop has two windows to loop,
  // and the pause control and the hint are there because it is moving.
  it("moves even when the day fits, with the pause control and the hint", () => {
    const { container } = render(<YourDay events={[ev("a", "09:00")]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} />);
    expect(screen.getByText("Your Day")).toBeInTheDocument();
    const card = container.querySelector(".sched-ticker");
    expect(card, "the card renders at all times").not.toBeNull();
    expect(card!.className, "and it moves").not.toContain("ticker-still");
    const copies = container.querySelectorAll(".ticker-track:not(.day-measure) > *").length;
    expect(copies, "an even number of copies, at least two").toBeGreaterThanOrEqual(2);
    expect(copies % 2).toBe(0);
    expect(container.querySelector(".ticker-toggle")).not.toBeNull();
    expect(container.querySelector(".ticker-hint")).not.toBeNull();
  });

  it("shows an empty state when nothing is scheduled", () => {
    const { container } = render(<YourDay events={[]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} />);
    expect(container.querySelector(".empty-state")).toBeTruthy();
  });

  // UP-ATH-02 (2026-09-06): Schedule has shown the Training Door on a gym
  // block since D4-C, off this same DayRow. Today did not, so the page the
  // athlete is on at six in the evening was the one page that could not
  // start a session.
  it("draws the Training Door on a gym block, and starts from it", () => {
    const gym: EventItem = { id: "g1", data: { title: "Gym", date: "2026-05-20", start: "18:00", category: "orgB", gym: true } };
    let started = 0;
    hold(
      <YourDay
        events={[gym]}
        now="08:00"
        nowLabel="8:00"
        onSeeAll={() => {}}
        gymDoorFor={(e) => (e.data.gym ? { dayName: "Push Day", facts: { exercises: 6, estMin: 42 }, onStart: () => { started++; } } : null)}
      />,
    );
    expect(screen.getByText("Push Day")).toBeInTheDocument();
    // The facts, not a joined string (§AM F3, 2026-09-26): the count and the
    // estimate are separate runs, so each can wear its own ink. The count is
    // a number with no state, a white <b>; the estimate is the app's own
    // arithmetic, sky.
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    expect(screen.getByText("6 Exercises").tagName).toBe("B");
    expect(screen.getByText("Est 42 Min")).toHaveClass("fact", "est");
    fireEvent.click(screen.getByRole("button", { name: "Start Push Day" }));
    expect(started).toBe(1);
  });

  it("leaves a plain event alone: no door where there is no gym block", () => {
    render(<YourDay events={[ev("a", "09:00")]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} gymDoorFor={() => null} />);
    expect(screen.queryByText(/^Start /)).not.toBeInTheDocument();
  });

  describe("when the day overflows the window", () => {
    let desc: PropertyDescriptor | undefined;
    beforeEach(() => {
      desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 999 });
    });
    afterEach(() => {
      // jsdom has no own scrollHeight descriptor on HTMLElement.prototype, so
      // `desc` is undefined and this used to restore NOTHING: the 999 override
      // leaked into every test declared after this block, which silently put
      // them all on the ticker path. Found 2026-08-24 when new tests below
      // started rendering the day twice.
      if (desc) Object.defineProperty(HTMLElement.prototype, "scrollHeight", desc);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    });

    // PAUSED IS THE EDITABLE VIEW (2026-08-25). Pausing used to freeze the
    // loop, which left two copies of every row on screen with nothing in
    // either safely reachable. It now renders the real single list.
    // AMENDED 2026-09-22 (Dave, photographing the plain list: "PUT BACK MY FUCKING TV
    // GUIDE SCHEDULE ON THE TODAY PAGE THIS VERSION SUCKS"): paused is the CARD,
    // held still -- never the plain list -- and a pause lasts for the visit.
    it("scrolls as a ticker, and pausing holds the same card still", () => {
      const { container } = render(<YourDay events={many} now="13:00" nowLabel="1:00" onSeeAll={() => {}} />);
      expect(container.querySelector(".sched-ticker")!.className).not.toContain("ticker-still");
      expect(container.querySelectorAll(".ticker-track .sched-row").length, "two copies while it moves")
        .toBeGreaterThan(many.length);
      const toggle = container.querySelector(".ticker-toggle") as HTMLElement;
      expect(toggle).toBeTruthy();
      fireEvent.click(toggle);
      expect(container.querySelector(".sched-ticker")!.className, "paused is the card, still").toContain("ticker-still");
      fireEvent.click(container.querySelector(".ticker-toggle") as HTMLElement);
      expect(container.querySelector(".sched-ticker")!.className).not.toContain("ticker-still");
    });

    // Dave 2026-08-25: "the home page one is supposed to be one that rotates
    // the display with a pause button." It did, except while any proposal
    // stood, which is most mornings for someone who plans their day. The
    // ticker was effectively never on.
    it("still scrolls while a proposal stands", () => {
      const proposed = {
        blocks: [{ taskId: "t1", text: "Finish Jarvis Visuals", category: "work", start: "14:00", end: "14:45" }],
        openId: null as string | null,
        onToggle: () => {},
        onDuration: () => {},
        onDrop: () => {},
      };
      const { container } = render(
        <YourDay events={many} now="13:00" nowLabel="1:00" onSeeAll={() => {}} proposed={proposed} />,
      );
      expect(container.querySelector(".sched-ticker")).toBeTruthy();
    });

    // Reaching for a moving list must stop it, and the tap that stopped it
    // must not also open whatever happened to be passing under the thumb.
    it("a tap on the moving ticker stops it instead of opening a row", () => {
      const onOpenEvent = vi.fn();
      const { container } = render(
        <YourDay events={many} now="13:00" nowLabel="1:00" onSeeAll={() => {}} onOpenEvent={onOpenEvent} />,
      );
      const row = container.querySelector(".sched-ticker .sched-row") as HTMLElement;
      expect(row).toBeTruthy();
      fireEvent.click(row);
      expect(onOpenEvent).not.toHaveBeenCalled();
      // AMENDED 2026-09-22: it stops, and it stays the card.
      expect(container.querySelector(".sched-ticker")!.className).toContain("ticker-still");
    });

    // B6-4 (2026-09-04): "Accept the Day disappears on a busy day." The
    // overflowing-ticker branch rendered planButton but silently dropped
    // footer, so on a busy day with a draft standing, Accept the Day and Not
    // Today were gone entirely, not just scrolled past. The paused view a
    // tap away already carried both.
    it("keeps the draft footer even while the ticker is scrolling", () => {
      const { getByText } = render(
        <YourDay events={many} now="13:00" nowLabel="1:00" onSeeAll={() => {}} footer={<div>Accept the Day</div>} />,
      );
      expect(getByText("Accept the Day")).toBeInTheDocument();
    });

    it("shows the now line and dims past events", () => {
      const { container } = render(<YourDay events={many} now="13:00" nowLabel="1:00" onSeeAll={() => {}} />);
      expect(container.querySelector(".now-line")).toBeTruthy();
      expect(container.querySelector(".sched-row.past")).toBeTruthy();
    });
  });
});

// Evening planning + Running Late on Today (2026-08-09).
import { vi } from "vitest";

describe("YourDay evening and recovery actions", () => {
  it("offers Plan Tomorrow only when the entry point is provided", () => {
    const onPlanTomorrow = vi.fn();
    render(<YourDay events={[]} now="20:00" nowLabel="8:00 PM" onSeeAll={() => {}} onPlanTomorrow={onPlanTomorrow} />);
    fireEvent.click(screen.getByText("Plan Tomorrow"));
    expect(onPlanTomorrow).toHaveBeenCalled();
  });

  it("hides Plan Tomorrow without the prop", () => {
    render(<YourDay events={[]} now="20:00" nowLabel="8:00 PM" onSeeAll={() => {}} onPlanDay={() => {}} />);
    expect(screen.queryByText("Plan Tomorrow")).not.toBeInTheDocument();
  });

  it("an EMPTY evening stands down too when the Tomorrow head already has Plan It (Dave 2026-09-04)", () => {
    // WAVE 4's duplicate-doors rule was applied to the day-with-events
    // branch only. His screenshot: "Nothing else tonight" with Plan My Day
    // and Plan Tomorrow, then a Tomorrow section with its own Plan It. Two
    // doors, one handler, one screen.
    render(<YourDay events={[]} now="20:00" nowLabel="8:00 PM" onSeeAll={() => {}} onPlanTomorrow={() => {}} tomorrowShown />);
    expect(screen.queryByText("Plan Tomorrow")).not.toBeInTheDocument();
    // And when tomorrow is empty the head's door is gone, so this one stays.
    render(<YourDay events={[]} now="20:00" nowLabel="8:00 PM" onSeeAll={() => {}} onPlanTomorrow={() => {}} tomorrowShown={false} />);
    expect(screen.getByText("Plan Tomorrow")).toBeInTheDocument();
  });

  // RUNNING LATE IS THE DAY HEAD'S OVERFLOW (Dave 2026-10-05, D1 and D2): it was a full-width grey pill under Accept the Day.
  // It sits behind the head's one More button and asks how late in a sheet of its own.
  it("Running Late opens from the head's overflow, asks how late, and fires with the chosen shift", () => {
    const onRunningLate = vi.fn();
    const { container } = render(<YourDay events={[ev("a", "15:00")]} now="10:00" nowLabel="10:00" onSeeAll={() => {}} onPlanDay={() => {}} onRunningLate={onRunningLate} />);
    expect(container.querySelector(".plan-cta"), "no Running Late pill under the day").toBeNull();
    fireEvent.click(screen.getByLabelText("Day Actions"));
    fireEvent.click(screen.getByRole("button", { name: "Running Late" }));
    expect(document.querySelector(".action-sheet")!.closest(".card")!.querySelector(".eyebrow")).toHaveTextContent("Running Late");
    fireEvent.click(screen.getByRole("button", { name: "30 Min" }));
    expect(onRunningLate).toHaveBeenCalledWith(30);
  });

  it("offers no Running Late when nothing ahead can move", () => {
    // Only a past event: shifting the past is not a thing.
    render(<YourDay events={[ev("a", "08:00")]} now="10:00" nowLabel="10:00" onSeeAll={() => {}} onPlanDay={() => {}} onRunningLate={() => {}} />);
    fireEvent.click(screen.getByLabelText("Day Actions"));
    expect(screen.queryByRole("button", { name: "Running Late" })).not.toBeInTheDocument();
  });

  // THE HEAD IS ONE LINE (D1, 2026-10-05): the title, the guide's pause and ONE capsule, then every other action behind ONE
  // More button. It never grows a second row of capsules, and Now is a neutral head (brand red is for what you can tap).
  it("the head holds one capsule and a More button, never a wrapped row of four", () => {
    const { container } = render(
      <YourDay events={[ev("a", "15:00")]} now="10:00" nowLabel="10:00" nowHead={<div />} onSeeAll={() => {}} onPlanDay={() => {}} onNewEvent={() => {}}
        onRunningLate={() => {}} onClearPlan={() => {}} />,
    );
    const head = container.querySelector(".sh2")!;
    expect(head).toHaveClass("sh2-quiet");
    expect(head.querySelector(".t")).toHaveTextContent("Now");
    const capsules = [...head.querySelectorAll(".see-all.pill-action:not(.head-more)")].map((b) => b.textContent);
    expect(capsules).toEqual(["Plan My Day"]);
    expect(head.querySelectorAll(".head-more")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Day Actions"));
    const sheet = [...document.querySelectorAll(".action-sheet button")].map((b) => b.textContent);
    expect(sheet).toEqual(["New Event", "Schedule", "Running Late", "Clear This Plan", "Cancel"]);
    expect(screen.getByRole("button", { name: "Clear This Plan" }), "the one destructive action goes last, in its own ink").toHaveClass("destructive");
  });

  it("Clear This Plan exists only while a draft stands", () => {
    render(<YourDay events={[ev("a", "15:00")]} now="10:00" nowLabel="10:00" onSeeAll={() => {}} onPlanDay={() => {}} />);
    fireEvent.click(screen.getByLabelText("Day Actions"));
    expect(screen.queryByRole("button", { name: "Clear This Plan" })).toBeNull();
  });

  it("Clear This Plan fires the clear, and Running Late and Clear This Plan are not loose controls under the card", () => {
    const onClearPlan = vi.fn();
    const { container } = render(
      <YourDay events={[ev("a", "15:00")]} now="10:00" nowLabel="10:00" onSeeAll={() => {}} onPlanDay={() => {}} onRunningLate={() => {}}
        onClearPlan={onClearPlan} primary={<button className="plan-cta plan-cta-block">Accept the Day</button>} />,
    );
    // Accept the Day, the proposal's own question, is the one filled primary and the only control under the card.
    expect(container.querySelectorAll(".plan-cta-row .plan-cta")).toHaveLength(1);
    expect(container.querySelector(".draft-clear")).toBeNull();
    fireEvent.click(screen.getByLabelText("Day Actions"));
    fireEvent.click(screen.getByRole("button", { name: "Clear This Plan" }));
    expect(onClearPlan).toHaveBeenCalledTimes(1);
  });
});

// PAUSING IS A PREFERENCE, NOT A CHORE (Dave, 2026-08-21). Before this, pause
// was component state: every return to Today started the day moving again and
// he had to find the same small button and press it again.
// AMENDED 2026-09-22 (Dave, photographing the plain list: "PUT BACK MY FUCKING TV
// GUIDE SCHEDULE ON THE TODAY PAGE THIS VERSION SUCKS"): paused is the CARD,
// held still -- never the plain list -- and a pause lasts for the visit.
// This block was "the ticker remembers that it was turned off". Remembering
// is what took the guide away: one stray tap wrote "off" and every visit
// after it showed the plain list. It now asserts the opposite.
describe("the ticker never remembers being turned off", () => {
  // Own the overflow mock rather than relying on an earlier describe's,
  // whose afterEach only restores when the descriptor existed on
  // HTMLElement.prototype (it lives on Element.prototype, so it does not).
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 999 });
  });

  it("a phone stuck on 'off' comes back moving, and the stale value is cleared", () => {
    localStorage.setItem("jarvis.today.ticker.v1", "off");
    const { container } = render(<YourDay events={many} locked={[]} now="09:00" nowLabel="Now" onSeeAll={() => {}} />);
    const card = container.querySelector(".sched-ticker");
    expect(card, "the guide is there").not.toBeNull();
    expect(card!.className, "and it is moving").not.toContain("ticker-still");
    expect(localStorage.getItem("jarvis.today.ticker.v1"), "the old off is gone").toBeNull();
  });

  it("pausing is for this visit and writes nothing down", () => {
    const { container } = render(<YourDay events={many} locked={[]} now="09:00" nowLabel="Now" onSeeAll={() => {}} />);
    fireEvent.click(container.querySelector(".ticker-toggle") as HTMLElement);
    expect(localStorage.getItem("jarvis.today.ticker.v1")).toBeNull();
    fireEvent.click(container.querySelector(".ticker-toggle") as HTMLElement);
    expect(localStorage.getItem("jarvis.today.ticker.v1")).toBeNull();
  });
});

// 2026-08-24: Merge B, the nesting bug, and I2. The browser walk measured
// ZERO nested blocks because the demo seed has no focus block holding work,
// so the nesting claim was unverified by anything until these existed.
describe("Merge B: Now as the head", () => {
  it("titles the section Now and bands the rest when a now head is given", () => {
    hold(
      <YourDay events={[ev("Morning", "09:00"), ev("Evening", "18:00")]}
        now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        nowHead={<div>IN LUNCH</div>} />,
    );
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("IN LUNCH")).toBeInTheDocument();
    expect(screen.getByText("The rest of today")).toBeInTheDocument();
  });

  it("drops what has already started, because the head is describing it", () => {
    hold(
      <YourDay events={[ev("Morning", "09:00"), ev("Evening", "18:00")]}
        now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        nowHead={<div>head</div>} />,
    );
    expect(screen.queryByText("Morning")).toBeNull();
    expect(screen.getByText("Evening")).toBeInTheDocument();
  });

  it("keeps the whole day when there is no now head, which is the evening", () => {
    hold(
      <YourDay events={[ev("Morning", "09:00"), ev("Evening", "18:00")]}
        now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    expect(screen.getByText("Morning")).toBeInTheDocument();
    expect(screen.getByText("Your Day")).toBeInTheDocument();
  });

  it("says so instead of rendering an empty strip under the band", () => {
    hold(
      <YourDay events={[ev("Morning", "09:00")]}
        now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        nowHead={<div>head</div>} />,
    );
    expect(screen.getByText("Nothing Else Scheduled")).toBeInTheDocument();
  });
});

describe("the nesting bug", () => {
  const deepWork = { s: 13 * 60, e: 15 * 60, label: "Deep Work", kind: "focus" };
  const prop = (taskId: string, text: string, start: string, end: string) =>
    ({ taskId, text, start, end, category: "orgB" });
  const proposed = (blocks: ReturnType<typeof prop>[]) => ({
    blocks, openId: null,
    onToggle: () => {}, onDuration: () => {}, onDrop: () => {},
  });

  // Dave's screenshot: 1:00 PM Deep Work, then 1:00 PM Finish Jarvis Visuals
  // as an unrelated sibling row at the same minute.
  it("puts a proposal placed into a focus block INSIDE it", () => {
    const { container } = hold(
      <YourDay events={[]} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        proposed={proposed([prop("t1", "Finish Jarvis Visuals", "13:00", "13:55")])} />,
    );
    expect(container.querySelector(".block-nest")).toBeTruthy();
    expect(container.querySelector(".block-held-prop")).toBeTruthy();
    // and NOT also as a top-level proposed row
    expect(container.querySelectorAll(".sched-proposed").length).toBe(0);
    expect(screen.getByText("Finish Jarvis Visuals")).toBeInTheDocument();
  });

  // THE OTHER HALF OF THE SAME RULE, AND IT USED TO SAY THE OPPOSITE (Dave,
  // 2026-09-21, on a screenshot of his own Today: "I also have a job
  // interview at 3 today and Jarvis is aware. How is that not in the
  // schedule?"). It WAS in the schedule -- inside "Deep Work 3:00 PM - 7:00
  // PM", behind a collapsed disclosure that called it one of "5 tasks".
  //
  // A proposal is inside the block BECAUSE of the block: the planner put it
  // there, and drawing it as a sibling reads as a clash that does not exist.
  // A committed event is inside it DESPITE the block: nothing consulted the
  // block, and drawing it inside hides a commitment behind a count. The test
  // above still pins the first; this one now pins the second.
  it("leaves a committed event inside a focus block as its own row, never hidden in the count", () => {
    const { container } = hold(
      <YourDay events={[ev("Job Interview", "15:00")]} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    expect(screen.getByText("Job Interview")).toBeInTheDocument();
    // Its own row in the day, not a child of the block.
    expect(container.querySelector(".block-nest"), "an event is never nested").toBeNull();
    expect(container.querySelector(".block-held"), "and never drawn as held work").toBeNull();
    // The block is still there; the event did not replace it.
    expect(container.querySelectorAll(".sched-row.sched-locked").length).toBe(1);
  });

  it("leaves a task that OVERRUNS the block as its own row, so the overrun stays visible", () => {
    const { container } = hold(
      <YourDay events={[]} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        proposed={proposed([prop("t1", "Runs Long", "14:30", "15:30")])} />,
    );
    expect(container.querySelector(".block-nest")).toBeNull();
    expect(container.querySelectorAll(".sched-proposed").length).toBe(1);
  });

  it("I2: the block says when it ends, alongside what it does", () => {
    // Superseded by the shared LockedRow (2026-08-28, Dave: "edit ALL
    // schedule items THE FUCKING SAME"): Today now renders the identical
    // row Schedule always has, not a stripped-down copy. What kind of time
    // it is reads from the state word (PROTECTED), not the kicker, which
    // stands down beside the word that already says it (2026-09-26): the
    // row reads "PROTECTED · Until 1:00 PM", never "PROTECTED Protected".
    // The row still says when the block ends either way.
    hold(
      <YourDay events={[ev("x", "18:00")]} locked={[{ s: 12 * 60, e: 13 * 60, label: "Lunch", kind: "meal" }]}
        now="09:00" nowLabel="9:00" onSeeAll={() => {}} />,
    );
    expect(screen.getByText("PROTECTED")).toBeInTheDocument();
    expect(screen.queryByText("Protected")).toBeNull();
    expect(screen.getByText(/Until 1:00/)).toBeInTheDocument();
  });
});

// SCHEDULE AUDIT 2026-10-01, item 8: "No explicit New Event on the Today
// page." The day card's head carries a New Event pill beside Schedule.
describe("YourDay: New Event", () => {
  it("is the head's capsule when nothing plans the day, and fires", () => {
    const onNewEvent = vi.fn();
    render(<YourDay events={[ev("a", "09:00")]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} onNewEvent={onNewEvent} />);
    const pill = screen.getByRole("button", { name: "New Event" });
    expect(pill, "in the head").toHaveClass("see-all", "pill-action");
    expect(pill.closest(".sh2")).not.toBeNull();
    fireEvent.click(pill);
    expect(onNewEvent).toHaveBeenCalledTimes(1);
  });

  // With Plan My Day on the head too (the real Today), New Event waits behind the head's More button with Schedule, so the head
  // is one line (Dave 2026-10-05, D1).
  it("sits behind the head's More button beside Plan My Day, and fires from there", () => {
    const onNewEvent = vi.fn();
    render(<YourDay events={[ev("a", "09:00")]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} onPlanDay={() => {}} onNewEvent={onNewEvent} />);
    expect(screen.queryByRole("button", { name: "New Event" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Day Actions"));
    fireEvent.click(screen.getByRole("button", { name: "New Event" }));
    expect(onNewEvent).toHaveBeenCalledTimes(1);
  });

  it("is there on an empty day too, which is when you most want to add one", () => {
    render(<YourDay events={[]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} onNewEvent={() => {}} />);
    expect(screen.getByRole("button", { name: "New Event" })).toBeInTheDocument();
  });

  it("is absent when the page has no sheet to open", () => {
    render(<YourDay events={[ev("a", "09:00")]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} />);
    expect(screen.queryByRole("button", { name: "New Event" })).toBeNull();
  });
});
