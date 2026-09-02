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
    // THE OUTCOME SWITCH (2026-09-02): the sections are segments now, one
    // shown at a time, counts on the labels; The Rest stays the one row.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Needs You3", "Waiting On4"]);
    expect(screen.getByText("The Rest")).toBeInTheDocument();
    expect(screen.getByText("The Sweep")).toBeInTheDocument();
    // Needs You shows first; Waiting On's rows are one tap over.
    expect(screen.getByText("Northwind Cloud")).toBeInTheDocument();
    expect(screen.queryByText(/Summitgear · Missing Items/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Waiting On/ }));
    // E2 (2026-08-24): THE ASK LEADS. The verb is the headline and the sender
    // is context beneath it, so the name shares a line with the subject now.
    expect(screen.getByText(/Summitgear · Missing Items/)).toBeInTheDocument();
    expect(screen.queryByText(/No reply/)).toBeNull();
    expect(screen.queryByText(/nadia@northlake\.org/)).toBeNull();
    // SPEC MOVED 2026-08-21: the demo runs the real action model, so a
    // Waiting On row no longer wears a universal "Nudge". The contract is
    // now the opposite one, and it is the bug Dave reported: rows that want
    // different things must not print the same button.
    // The verbs moved from pills to headlines (E2), and the contract is the
    // same one Dave reported: rows that want different things must not print
    // the same words.
    const acts = [...document.querySelectorAll(".msg-line .conn-name")].map((e) => e.textContent);
    expect(acts.length).toBeGreaterThan(2);
    expect(new Set(acts).size).toBeGreaterThan(1);
    expect(acts).toContain("Stop Tracking"); // the receipt owes nothing
    // One section at a time: Needs You's rows left when Waiting On came.
    expect(screen.queryByText("Northwind Cloud")).toBeNull();
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
