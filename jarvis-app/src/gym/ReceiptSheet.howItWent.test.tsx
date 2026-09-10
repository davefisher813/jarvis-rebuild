// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReceiptSheet from "./ReceiptSheet";
import type { Receipt } from "./prs";

// WORKOUT LOGGING BELONGS WITH THE WORKOUT (Dave 2026-09-10: "how hard it was,
// where it hurts, anything related to an actual workout should go where people
// are logging their workout data. It makes no sense for someone to open up a
// workout, log it in one section, and then log the intensity of it on the home
// page. That's not it").
//
// Both were tiles on the health home page, beside bedtime and bodyweight,
// which put a fact about ONE session in the place a person writes down facts
// about their day. The receipt is the moment they actually know the answer.

const receipt: Receipt = {
  minutes: 37, exercises: 7, volume: 12400, volumeUnit: "lb",
  otherSets: 0, prs: [], doneNames: [], goalHits: [],
};

describe("ReceiptSheet: How It Went", () => {
  it("offers the rater and the body map, and closes itself on the way to each", () => {
    const onDone = vi.fn();
    const onRateSession = vi.fn();
    const onLogSoreSpot = vi.fn();
    render(
      <ReceiptSheet dayName="Pull Day 1" receipt={receipt} workouts={[]}
        onDone={onDone} onRateSession={onRateSession} onLogSoreSpot={onLogSoreSpot} />,
    );
    expect(screen.getByText("How It Went")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rate It, 1 to 10"));
    // Each opens a full screen, so the sheet has to be out of the way first.
    expect(onDone).toHaveBeenCalled();
    expect(onRateSession).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Something Hurts"));
    expect(onLogSoreSpot).toHaveBeenCalled();
  });

  it("says nothing about either when the caller has no health module to open", () => {
    render(<ReceiptSheet dayName="Pull Day 1" receipt={receipt} workouts={[]} onDone={() => {}} />);
    expect(screen.queryByText("How It Went")).not.toBeInTheDocument();
    expect(screen.queryByText("Rate It, 1 to 10")).not.toBeInTheDocument();
  });
});
