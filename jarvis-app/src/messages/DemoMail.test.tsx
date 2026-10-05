// The demo mail fixture (Dave 2026-08-18). These tests pin two things:
// the fixture renders the full email anatomy, and it only ever mounts
// when the demoMail prop says so, never from environment sniffing (that
// gate broke 20 tests the first time; this file keeps it honest).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DemoMail from "./DemoMail";

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../shared/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("../shared/toast")>()), showToast }));
beforeEach(() => showToast.mockReset());

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
    // E-02 (2026-09-12): the Sweep is the Needs You head's capsule, not a card.
    expect(screen.getByText(/^Sweep \u00b7 About/)).toBeInTheDocument();
    // Needs You shows first; Waiting On's rows are one tap over.
    expect(screen.getByText("Northwind Cloud")).toBeInTheDocument();
    // A seed's subject travels to Today as the gist, drawn whole, so it
    // carries no typed dot (§AM R6): a comma joins its two halves.
    expect(screen.getByText("Invoice attached, Net 15 starts Monday")).toBeInTheDocument();
    for (const l of document.querySelectorAll(".mline2")) expect(l.textContent).not.toContain("\u00b7");
    expect(screen.queryByText(/Summitgear: Missing Items/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Waiting On/ }));
    // E2 (2026-08-24): THE ASK LEADS. The verb is the headline and the sender
    // is context beneath it, so the name shares a line with the subject now.
    expect(screen.getByText(/Summitgear: Missing Items/)).toBeInTheDocument();
    // Who, then the subject half: a subject that asks in a clause of its own
    // ("Harper v Northline: can you call me?") never reads as two colons.
    expect(screen.getByText("Marcus Delaney: Harper v Northline")).toBeInTheDocument();
    for (const g of document.querySelectorAll(".msg-gist")) expect(g.textContent!.split(": ").length).toBeLessThanOrEqual(2);
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

// DEAD-BUTTON AUDIT (2026-10-04): For You, All and Drafts only toasted, so the
// active chip never moved and All and Drafts could not be reached. They select
// now, like the live page's.
describe("DemoMail view chips", () => {
  const chip = (name: string) => screen.getByRole("button", { name });

  it("starts on For You, and each chip becomes the active one when tapped", () => {
    render(<DemoMail />);
    expect(chip("For You").className).toContain("on");
    expect(chip("All").className).not.toContain("on");
    expect(chip("Drafts").className).not.toContain("on");

    fireEvent.click(chip("All"));
    expect(chip("All").className).toContain("on");
    expect(chip("For You").className).not.toContain("on");

    fireEvent.click(chip("Drafts"));
    expect(chip("Drafts").className).toContain("on");
    expect(chip("All").className).not.toContain("on");

    fireEvent.click(chip("For You"));
    expect(chip("For You").className).toContain("on");
    expect(chip("Drafts").className).not.toContain("on");
    // Selecting a view is not a demo-only apology.
    expect(showToast).not.toHaveBeenCalled();
  });

  it("All is the flat list of the demo's inbox rows, with no triage anatomy around it", () => {
    render(<DemoMail />);
    fireEvent.click(chip("All"));
    expect(screen.getByText("Northwind Cloud")).toBeInTheDocument();
    expect(screen.getByText("Nadia Brandt")).toBeInTheDocument();
    expect(screen.getByText("App Store Team")).toBeInTheDocument();
    expect(document.querySelectorAll(".mrow")).toHaveLength(3);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("The Rest")).toBeNull();
    // Back on For You the outcome switch and the fold return.
    fireEvent.click(chip("For You"));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText("The Rest")).toBeInTheDocument();
  });

  it("Drafts is the live page's empty state, and its New Email opens the composer", () => {
    render(<DemoMail />);
    fireEvent.click(chip("Drafts"));
    expect(screen.getByText("No Drafts")).toBeInTheDocument();
    expect(screen.queryByText("Northwind Cloud")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New Email" }));
    expect(screen.getByPlaceholderText("To")).toBeInTheDocument();
  });

  it("the demo toast still speaks for the rows that stay demo-only", () => {
    render(<DemoMail />);
    fireEvent.click(screen.getByText("Northwind Cloud"));
    expect(showToast).toHaveBeenCalledWith({ message: "Demo Mail · Connect Google for the Real Thing" });
  });
});


// THE CATALOG, CHECKED ON WHAT THE DEMO DRAWS (Dave 2026-10-05). The demo
// mirrors the live Tools rows, so a sub line the live page cases the demo must
// case too: "14 Threads from 6 senders" and "About 2 min" had lowercase words
// behind a number, and the three Tools descriptions were in sentence case.
describe("DemoMail fixture: the catalog (2026-10-05)", () => {
  const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  const lowercaseWords = (t: string) => t.split(/[\s·]+/).slice(1).filter((w) => /^[a-z]{2,}$/.test(w) && !SMALL.has(w));

  it("every meta line under a Tools row is Title Case, the count's unit capitalized", () => {
    render(<DemoMail />);
    const metas = Array.from(document.querySelectorAll(".conn-meta")).map((m) => m.textContent ?? "");
    expect(metas).toContain("14 Threads from 6 Senders");
    expect(metas).toContain("A Timed Drain That Stops Itself");
    expect(metas).toContain("Senders and Gists, Never the Message");
    expect(metas).toContain("Open Email on a Schedule");
    for (const t of metas) expect(lowercaseWords(t), t).toEqual([]);
  });

  it("the Sweep capsule says About 2 Min, as the live head does", () => {
    render(<DemoMail />);
    expect(screen.getByText("Sweep · About 2 Min")).toBeInTheDocument();
  });
});
