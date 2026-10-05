// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { FeedbackProvider } from "../encourage/FeedbackProvider";
import { QUIET_KEY, readFeedback, setLiveFeedback } from "../encourage/prefs";
import { todayISO } from "../tasks/grouping";
import FeedbackStylePage from "./FeedbackStylePage";

vi.mock("../shared/toast", () => ({ showToast: () => {}, subscribeToast: () => () => {} }));

const page = () => render(
  <NotesProvider userId="fb-page"><FeedbackProvider><FeedbackStylePage onBack={() => {}} /></FeedbackProvider></NotesProvider>,
);

beforeEach(() => { localStorage.clear(); setLiveFeedback(null); });

describe("FeedbackStylePage", () => {
  it("opens on the good defaults with nothing to set up", () => {
    page();
    expect(screen.getByLabelText("Celebration")).toHaveTextContent("Gentle");
    expect(screen.getByLabelText("Motion")).toHaveTextContent("Follow System");
    expect(screen.getByLabelText("Encouragement")).toHaveTextContent("Brief Factual");
    expect(screen.getByRole("switch", { name: "Completion Sound" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Haptics" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Quiet Today" })).toHaveAttribute("aria-checked", "false");
    // ACCOUNTABILITY IS A FIELD NOTE, NOT A CARD (round 2 review): a bold-title card with no control read as a setting that does nothing.
    // The one fact is said once, at the foot, and there is no "Private" beside it.
    expect(screen.queryByText("Accountability"), "no settings card for a fact").toBeNull();
    expect(screen.getByText("Nothing about your tasks is shared with anyone")).toHaveClass("input-hint");
    expect(screen.queryByText("Private")).toBeNull();
  });

  it("the sound switch changes only sound", () => {
    page();
    fireEvent.click(screen.getByRole("switch", { name: "Completion Sound" }));
    const now = readFeedback();
    expect(now.sound).toBe(true);
    expect(now.haptics).toBe(false);
    expect(now.celebration).toBe("gentle");
  });

  it("Quiet Today lasts until midnight on this device and changes no saved choice", () => {
    page();
    fireEvent.click(screen.getByRole("switch", { name: "Quiet Today" }));
    expect(localStorage.getItem(QUIET_KEY)).toBe(todayISO());
    expect(readFeedback().celebration).toBe("gentle");
    expect(document.documentElement.dataset.celebrate).toBe("off");
    fireEvent.click(screen.getByRole("switch", { name: "Quiet Today" }));
    expect(localStorage.getItem(QUIET_KEY)).toBeNull();
    expect(document.documentElement.dataset.celebrate).toBe("gentle");
  });

  it("says nothing that scores, ranks or promises a reward", () => {
    const { container } = page();
    expect(container.textContent).not.toMatch(/streak|score|points|level|rank|leaderboard|reward|mystery|surprise|badge/i);
  });
});
