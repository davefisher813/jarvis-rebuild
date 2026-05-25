// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import YourDay from "./YourDay";
import type { EventItem } from "../schedule/types";

const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "tucci" } });
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
