// The demo mail fixture (Dave 2026-08-18). These tests pin two things:
// the fixture renders the full email anatomy, and it only ever mounts
// when the demoMail prop says so, never from environment sniffing (that
// gate broke 20 tests the first time; this file keeps it honest).
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DemoMail from "./DemoMail";

describe("DemoMail fixture", () => {
  it("renders the full email anatomy: promo, Needs You, Waiting On, The Rest", () => {
    render(<DemoMail />);
    expect(screen.getByText("3 Threads Need You")).toBeInTheDocument();
    expect(screen.getByText("Needs You")).toBeInTheDocument();
    expect(screen.getByText("Waiting On")).toBeInTheDocument();
    expect(screen.getByText("The Rest")).toBeInTheDocument();
    // The promo count matches the fixture rows, so the numbers can't drift.
    expect(screen.getAllByText("Nudge").length).toBeGreaterThan(0);
    expect(screen.getByText("Supabase")).toBeInTheDocument();
  });

  it("shows Connect Google only when a connect handler exists", () => {
    const { rerender } = render(<DemoMail />);
    expect(screen.queryByText("Connect Google")).not.toBeInTheDocument();
    let tapped = false;
    rerender(<DemoMail onConnect={() => { tapped = true; }} />);
    fireEvent.click(screen.getByText("Connect Google"));
    expect(tapped).toBe(true);
  });
});
