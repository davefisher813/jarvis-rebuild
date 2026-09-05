// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MailNotices from "./MailNotices";
import { saveMailSnapshot, type MailSnapshot } from "../messages/home";
import { enqueueTodaySend, getTodayOutbox, resetTodayOutboxForTest } from "../messages/todayOutbox";
import { subscribeToast, hideToast, type ToastState } from "../shared/toast";

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
    // ONE CARD (2026-09-01): the rows ride inside one .stream-card; Clear
    // All sits under that card, the last thing in the band.
    const kids = [...container.children];
    const clearIdx = kids.findIndex((el) => el.classList.contains("notice-clear-row"));
    const cardIdx = kids.findIndex((el) => el.classList.contains("stream-card"));
    expect(clearIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(-1);
    expect(kids[cardIdx]!.querySelectorAll(".pad-x")).toHaveLength(2);
    expect(cardIdx).toBeLessThan(clearIdx);
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

// THE DELETE SWIPE (2026-08-26). Dave, off a real screenshot: "I should be
// able to delete from here." Dismiss already sat on the swipe and only ever
// hid the card -- the email stayed exactly where it was, and this same
// notice came back on the next snapshot refresh. onDelete is wired through
// to a real Gmail trash by the caller (TodayFlow); this file only owns the
// card-side contract -- clear on a true success, stay put and say so on a
// false one, and never touch the card on a network throw the caller
// couldn't resolve to either.
describe("MailNotices: Delete", () => {
  beforeEach(() => localStorage.clear());

  it("Delete is absent with no onDelete prop -- the pre-existing behavior for every caller that hasn't wired it up", () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    expect(container.querySelector(".notice-delete")).toBeNull();
  });

  it("clears the card on a true success", async () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    const { container } = render(
      <MailNotices
        today={TODAY}
        nowHHMM="09:00"
        onAddTask={async () => true}
        onDelete={async () => ({ ok: true })}
      />,
    );
    expect(container.querySelectorAll(".pad-x")).toHaveLength(1);
    fireEvent.click(container.querySelector(".notice-delete")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelectorAll(".pad-x")).toHaveLength(0);
  });

  it("leaves the card exactly where it was on a false result -- a failed trash is not a hidden one", async () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    const { container } = render(
      <MailNotices
        today={TODAY}
        nowHHMM="09:00"
        onAddTask={async () => true}
        onDelete={async () => ({ ok: false })}
      />,
    );
    fireEvent.click(container.querySelector(".notice-delete")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelectorAll(".pad-x")).toHaveLength(1);
  });

  it("leaves the card in place when the account cannot be resolved (null)", async () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    const { container } = render(
      <MailNotices
        today={TODAY}
        nowHHMM="09:00"
        onAddTask={async () => true}
        onDelete={async () => null}
      />,
    );
    fireEvent.click(container.querySelector(".notice-delete")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelectorAll(".pad-x")).toHaveLength(1);
  });
});

// TODAY-F-06 (2026-09-05): "Quick-reply chips and Send: one tap, a real
// email, no undo, 'Reply sent' before anything is sent." One tap of a chip,
// no confirm, and the toast said "Reply sent" while the message sat in a
// 12-second hold that no screen rendered and nothing could cancel. The hold
// was always there; the way back was not.
describe("MailNotices: a chip holds the send", () => {
  beforeEach(() => { localStorage.clear(); resetTodayOutboxForTest(); hideToast(); });

  const withChips = (onSend: (n: unknown, body: string) => Promise<string | null>) => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    return render(
      <MailNotices
        today={TODAY}
        nowHHMM="09:00"
        onAddTask={async () => true}
        onDraft={async () => "Yes"}
        onSend={onSend as never}
      />,
    );
  };

  it("says what is actually happening, and the Undo pulls the message back", async () => {
    let toast: ToastState | null = null;
    const unsub = subscribeToast((t) => { if (t) toast = t; });
    withChips(async (_n, body) => enqueueTodaySend({ to: "nadia@x.com", subject: "Re: Invoice", body, threadId: "t1", todayKind: "reply" }));
    fireEvent.click(screen.getByText("Thanks"));
    await new Promise((r) => setTimeout(r, 0));
    // Held, not sent, and the words say so.
    expect(getTodayOutbox()).toHaveLength(1);
    expect(toast!.message).toBe("Sending in 12s");
    expect(toast!.actionLabel).toBe("Undo");
    // And the way back actually empties the queue.
    toast!.onAction!();
    expect(getTodayOutbox()).toHaveLength(0);
    unsub();
  });

  it("a send that never made the queue says so and keeps the words", async () => {
    let toast: ToastState | null = null;
    const unsub = subscribeToast((t) => { if (t) toast = t; });
    withChips(async () => null);
    fireEvent.click(screen.getByText("Thanks"));
    await new Promise((r) => setTimeout(r, 0));
    expect(getTodayOutbox()).toHaveLength(0);
    expect(toast!.message).toBe("Couldn't send · Nothing was lost");
    unsub();
  });
});
