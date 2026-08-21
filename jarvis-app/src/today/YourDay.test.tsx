// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import YourDay from "./YourDay";
import type { EventItem } from "../schedule/types";

const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "orgB" } });
const many = Array.from({ length: 8 }, (_, i) => ev("e" + i, String(8 + i).padStart(2, "0") + ":00"));

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
      if (desc) Object.defineProperty(HTMLElement.prototype, "scrollHeight", desc);
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
