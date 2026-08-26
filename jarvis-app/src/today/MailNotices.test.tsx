// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MailNotices from "./MailNotices";
import { saveMailSnapshot, type MailSnapshot } from "../messages/home";

const TODAY = "2026-08-20";

const snap = (over: Partial<MailSnapshot> = {}): MailSnapshot => ({
  ts: Date.now(),
  needsYou: 0,
  threads: [],
  waiting: [],
  promises: [],
  ...over,
});

// Distinct content per thread: mailNotices treats two same-title/sub/action
// cards as one card said twice (2026-08-25) and drops the second, so two
// threads that read identically would collapse to one card and undercount
// the fixture, not test the move this file is actually about.
const thread = (id: string, from: string, subject: string) => ({
  id, from, fromEmail: from.toLowerCase().replace(/\s+/g, ".") + "@northlake.org",
  subject, gist: "Wants " + subject,
});

describe("MailNotices: Clear All", () => {
  beforeEach(() => localStorage.clear());

  // Dave 2026-08-26, from a screenshot: "Clear all should be under the email
  // tabs not above it." It used to sit between the EMAIL head and the first
  // card -- an escape hatch for a pile you have not looked at yet, offered
  // before you have seen a single card in it. It now sits after the cards it
  // actually clears, the same place a bulk action sits under any list.
  it("renders under the cards, not above them", () => {
    saveMailSnapshot(snap({
      needsYou: 2,
      threads: [thread("t1", "Nadia Brandt", "invoice attached"), thread("t2", "Rob Ellis", "the deck for Friday")],
    }));
    const { container } = render(
      <MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />,
    );
    const kids = [...container.children];
    const clearIdx = kids.findIndex((el) => el.classList.contains("notice-clear-row"));
    const cardIdxs = kids.map((el, i) => (el.classList.contains("pad-x") ? i : -1)).filter((i) => i >= 0);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(cardIdxs).toHaveLength(2);
    // Every card comes before Clear All -- it is the last thing in the band.
    expect(Math.max(...cardIdxs)).toBeLessThan(clearIdx);
  });

  it("[edge] stays hidden at one notice, same as before the move", () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    expect(screen.queryByText("Clear All")).toBeNull();
  });

  it("still clears every shown card on tap", () => {
    saveMailSnapshot(snap({
      needsYou: 2,
      threads: [thread("t1", "Nadia Brandt", "invoice attached"), thread("t2", "Rob Ellis", "the deck for Friday")],
    }));
    const { container } = render(
      <MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />,
    );
    expect(container.querySelectorAll(".pad-x")).toHaveLength(2);
    fireEvent.click(screen.getByText("Clear All"));
    // The toast itself renders from a separate host not mounted in this
    // isolated test; what belongs to THIS component is that both cards go.
    expect(container.querySelectorAll(".pad-x")).toHaveLength(0);
  });
});
