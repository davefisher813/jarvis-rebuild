// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BookingPage from "./BookingPage";
import { readBookingSettings } from "../booking/settings";

// Track 3 (2026-09-14): Your Times, one screen, writes through as it goes.
describe("BookingPage", () => {
  beforeEach(() => { localStorage.clear(); });
  it("turns availability on, toggles a day and a duration, and offers to publish when no link exists yet", () => {
    render(<BookingPage onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Available for Booking" }));
    expect(readBookingSettings().available).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    expect(readBookingSettings().days).toEqual([0, 1, 2, 3, 4, 5]);
    fireEvent.click(screen.getByRole("button", { name: "45 Min" }));
    expect(readBookingSettings().durationMin).toBe(45);
    // AMENDED 2026-09-19 (Track 3): the card offers to publish now. With no
    // session behind the test there is no link, which is the honest empty
    // state rather than an error.
    expect(screen.getByText("No Link Yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish My Times" })).toBeInTheDocument();
  });
});
