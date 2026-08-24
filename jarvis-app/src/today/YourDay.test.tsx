// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import YourDay from "./YourDay";
import type { EventItem } from "../schedule/types";

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
  it("is a static card (no ticker, no pause) when the day fits", () => {
    const { container } = render(<YourDay events={[ev("a", "09:00")]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} />);
    expect(screen.getByText("Your Day")).toBeInTheDocument();
    expect(container.querySelector(".sched-ticker")).toBeNull();
    expect(container.querySelector(".ticker-toggle")).toBeNull();
  });

  it("shows an empty state when nothing is scheduled", () => {
    const { container } = render(<YourDay events={[]} now="08:00" nowLabel="8:00" onSeeAll={() => {}} />);
    expect(container.querySelector(".empty-state")).toBeTruthy();
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

    it("becomes an auto-scroll ticker with a working pause toggle", () => {
      const { container } = render(<YourDay events={many} now="13:00" nowLabel="1:00" onSeeAll={() => {}} />);
      const ticker = container.querySelector(".sched-ticker");
      expect(ticker).toBeTruthy();
      const toggle = container.querySelector(".ticker-toggle") as HTMLElement;
      expect(toggle).toBeTruthy();
      expect(ticker!.classList.contains("paused")).toBe(false);
      fireEvent.click(toggle);
      expect(container.querySelector(".sched-ticker")!.classList.contains("paused")).toBe(true);
      fireEvent.click(container.querySelector(".ticker-toggle") as HTMLElement);
      expect(container.querySelector(".sched-ticker")!.classList.contains("paused")).toBe(false);
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

  it("Running Late arms, then fires with the chosen shift", () => {
    const onRunningLate = vi.fn();
    render(<YourDay events={[ev("a", "15:00")]} now="10:00" nowLabel="10:00" onSeeAll={() => {}} onRunningLate={onRunningLate} />);
    fireEvent.click(screen.getByText("Running Late?"));
    fireEvent.click(screen.getByText("+30m"));
    expect(onRunningLate).toHaveBeenCalledWith(30);
  });

  it("offers no Running Late when nothing ahead can move", () => {
    // Only a past event: shifting the past is not a thing.
    render(<YourDay events={[ev("a", "08:00")]} now="10:00" nowLabel="10:00" onSeeAll={() => {}} onRunningLate={() => {}} />);
    expect(screen.queryByText("Running Late?")).not.toBeInTheDocument();
  });
});

// PAUSING IS A PREFERENCE, NOT A CHORE (Dave, 2026-08-21). Before this, pause
// was component state: every return to Today started the day moving again and
// he had to find the same small button and press it again.
describe("the ticker remembers that it was turned off", () => {
  // Own the overflow mock rather than relying on an earlier describe's,
  // whose afterEach only restores when the descriptor existed on
  // HTMLElement.prototype (it lives on Element.prototype, so it does not).
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 999 });
  });

  it("starts paused when it was paused last time", () => {
    localStorage.setItem("jarvis.today.ticker.v1", "off");
    const { container } = render(<YourDay events={many} locked={[]} now="09:00" nowLabel="Now" onSeeAll={() => {}} />);
    expect(container.querySelector(".sched-ticker")!.classList.contains("paused")).toBe(true);
  });

  it("writes the choice down when it is toggled", () => {
    const { container } = render(<YourDay events={many} locked={[]} now="09:00" nowLabel="Now" onSeeAll={() => {}} />);
    fireEvent.click(container.querySelector(".ticker-toggle") as HTMLElement);
    expect(localStorage.getItem("jarvis.today.ticker.v1")).toBe("off");
    fireEvent.click(container.querySelector(".ticker-toggle") as HTMLElement);
    expect(localStorage.getItem("jarvis.today.ticker.v1")).toBe("on");
  });
});

// 2026-08-24: Merge B, the nesting bug, and I2. The browser walk measured
// ZERO nested blocks because the demo seed has no focus block holding work,
// so the nesting claim was unverified by anything until these existed.
describe("Merge B: Now as the head", () => {
  it("titles the section Now and bands the rest when a now head is given", () => {
    render(
      <YourDay events={[ev("Morning", "09:00"), ev("Evening", "18:00")]}
        now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        nowHead={<div>IN LUNCH</div>} />,
    );
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("IN LUNCH")).toBeInTheDocument();
    expect(screen.getByText("The rest of today")).toBeInTheDocument();
  });

  it("drops what has already started, because the head is describing it", () => {
    render(
      <YourDay events={[ev("Morning", "09:00"), ev("Evening", "18:00")]}
        now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        nowHead={<div>head</div>} />,
    );
    expect(screen.queryByText("Morning")).toBeNull();
    expect(screen.getByText("Evening")).toBeInTheDocument();
  });

  it("keeps the whole day when there is no now head, which is the evening", () => {
    render(
      <YourDay events={[ev("Morning", "09:00"), ev("Evening", "18:00")]}
        now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    expect(screen.getByText("Morning")).toBeInTheDocument();
    expect(screen.getByText("Your Day")).toBeInTheDocument();
  });

  it("says so instead of rendering an empty strip under the band", () => {
    render(
      <YourDay events={[ev("Morning", "09:00")]}
        now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        nowHead={<div>head</div>} />,
    );
    expect(screen.getByText("Nothing else scheduled")).toBeInTheDocument();
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
    const { container } = render(
      <YourDay events={[]} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        proposed={proposed([prop("t1", "Finish Jarvis Visuals", "13:00", "13:55")])} />,
    );
    expect(container.querySelector(".block-nest")).toBeTruthy();
    expect(container.querySelector(".block-held-prop")).toBeTruthy();
    // and NOT also as a top-level proposed row
    expect(container.querySelectorAll(".sched-proposed").length).toBe(0);
    expect(screen.getByText("Finish Jarvis Visuals")).toBeInTheDocument();
  });

  it("puts a committed event placed into a focus block INSIDE it", () => {
    const { container } = render(
      <YourDay events={[ev("Standup", "13:30")]} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    expect(container.querySelector(".block-nest")).toBeTruthy();
    expect(container.querySelectorAll(".sched-row.sched-locked").length).toBe(1);
  });

  it("leaves a task that OVERRUNS the block as its own row, so the overrun stays visible", () => {
    const { container } = render(
      <YourDay events={[]} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        proposed={proposed([prop("t1", "Runs Long", "14:30", "15:30")])} />,
    );
    expect(container.querySelector(".block-nest")).toBeNull();
    expect(container.querySelectorAll(".sched-proposed").length).toBe(1);
  });

  it("I2: the block says when it ends instead of saying Protected", () => {
    render(
      <YourDay events={[ev("x", "18:00")]} locked={[{ s: 12 * 60, e: 13 * 60, label: "Lunch", kind: "meal" }]}
        now="09:00" nowLabel="9:00" onSeeAll={() => {}} />,
    );
    expect(screen.queryByText("Protected")).toBeNull();
    expect(screen.getByText(/Until 1:00/)).toBeInTheDocument();
  });
});
