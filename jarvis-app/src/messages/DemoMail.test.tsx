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
    // SPEC MOVED (E14, 2026-08-23): the promo card is retired on the live
    // page, so it is retired here. This component exists to show the REAL
    // anatomy, which makes a stale copy of it the one thing it must never be.
    expect(screen.queryByText("3 Threads Need You")).toBeNull();
    expect(document.querySelectorAll(".deck-cta").length).toBe(0);
    expect(screen.getByText("Needs You")).toBeInTheDocument();
    expect(screen.getByText("Waiting On")).toBeInTheDocument();
    expect(screen.getByText("The Rest")).toBeInTheDocument();
    // The verb and the count moved onto the head, and the counts still match
    // the fixtures, so the numbers cannot drift.
    expect(screen.getByText("Deal With It")).toBeInTheDocument();
    const counts = [...document.querySelectorAll(".sh2 .n")].map((e) => e.textContent);
    expect(counts).toEqual(["3", "4"]);
    // E1: a handle is not a name, and "No reply" is not news in a section
    // called Waiting On.
    expect(screen.getByText("Summitgear")).toBeInTheDocument();
    expect(screen.queryByText(/No reply/)).toBeNull();
    expect(screen.queryByText("nadia@northlake.org")).toBeNull();
    // SPEC MOVED 2026-08-21: the demo runs the real action model, so a
    // Waiting On row no longer wears a universal "Nudge". The contract is
    // now the opposite one, and it is the bug Dave reported: rows that want
    // different things must not print the same button.
    const acts = [...document.querySelectorAll(".pill-act")].map((e) => e.textContent);
    expect(acts.length).toBeGreaterThan(2);
    expect(new Set(acts).size).toBeGreaterThan(1);
    expect(acts).toContain("Stop Tracking"); // the receipt owes nothing
    expect(screen.getByText("Northwind Cloud")).toBeInTheDocument();
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
