// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import MailNotices from "./MailNotices";
import { saveMailSnapshot, type MailSnapshot } from "../messages/home";
import { countNudge } from "../messages/escalate";
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

  // CLEAR ALL IS THE BAND HEAD'S (Dave 2026-10-05, locked: a section-level action lives in the section head, never under a card;
  // it hung under the card since Dave 2026-08-26). The band owns what it has hidden, so it REPORTS the one function to the page
  // (onClearAllChange), which draws it as the head's capsule: a function from two notices up, and null below that.
  const twoThreads = () => saveMailSnapshot(snap({
    needsYou: 2,
    threads: [thread("t1", "Nadia Brandt", "invoice attached"), thread("t2", "Rob Ellis", "the deck for Friday")],
  }));

  it("hands Clear All to the head from two notices up, and draws nothing under the card", () => {
    twoThreads();
    const reports: Array<(() => void) | null> = [];
    const { container } = render(
      <MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onClearAllChange={(f) => reports.push(f)} />,
    );
    expect(typeof reports.at(-1)).toBe("function");
    // ONE CARD (2026-09-01): the rows ride inside one .stream-card, and nothing else is in the band: no clear row, no button.
    const kids = [...container.children];
    expect(kids.some((el) => el.classList.contains("notice-clear-row")), "no Clear All row under the card").toBe(false);
    expect(screen.queryByText("Clear All"), "the word is the head's, not the band's").toBeNull();
    expect(kids[0]!.classList.contains("stream-card")).toBe(true);
    expect(kids[0]!.querySelectorAll(".pad-x")).toHaveLength(2);
  });

  it("[edge] reports nothing to clear at one notice, same as before the move", () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    const reports: Array<(() => void) | null> = [];
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onClearAllChange={(f) => reports.push(f)} />);
    expect(reports.at(-1)).toBeNull();
    expect(screen.queryByText("Clear All")).toBeNull();
  });

  it("still clears every shown card when the head calls it", () => {
    twoThreads();
    let clear: (() => void) | null = null;
    const { container } = render(
      <MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onClearAllChange={(f) => { clear = f; }} />,
    );
    expect(container.querySelectorAll(".pad-x")).toHaveLength(2);
    act(() => { clear!(); });
    // The toast itself renders from a separate host not mounted in this
    // isolated test; what belongs to THIS component is that both cards go.
    expect(container.querySelectorAll(".pad-x")).toHaveLength(0);
  });

  // 2026-10-05, Dave's visual catalog gate: every word the app writes is Title Case, the word after a number too
  // ("45 Min"). This toast said "2 cleared", the one lowercase line the band wrote.
  it("says how many it cleared in Title Case, with an Undo", () => {
    hideToast();
    let toast: ToastState | null = null;
    const unsub = subscribeToast((t) => { if (t) toast = t; });
    saveMailSnapshot(snap({
      needsYou: 2,
      threads: [thread("t1", "Nadia Brandt", "invoice attached"), thread("t2", "Rob Ellis", "the deck for Friday")],
    }));
    let clear: (() => void) | null = null;
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onClearAllChange={(f) => { clear = f; }} />);
    act(() => { clear!(); });
    expect(toast!.message).toBe("2 Cleared");
    expect(toast!.message).toMatch(/^\d+ [A-Z]/);
    expect(toast!.actionLabel).toBe("Undo");
    unsub();
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

  // 2026-10-05, Dave's visual catalog gate (the Capsule, section AL): every tappable control that is not the screen's one
  // filled primary is a capsule, never bare words. Send was a capsule; Discard and Open It beside it were bare red words.
  it("the draft's quiet verbs are capsules beside Send, not bare words", async () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onDraft={async () => "Yes"} onSend={(async () => null) as never} onOpenThread={() => {}} />);
    fireEvent.click(screen.getByText("Write Back"));
    await screen.findByText("Discard");
    expect(screen.getByText("Send")).toHaveClass("pill-act");
    for (const word of ["Discard", "Open It"]) {
      const b = screen.getByText(word);
      expect(b, word).toHaveClass("quiet-action");
      expect(b, word).not.toHaveClass("plan-drop");
    }
  });

  it("a send that never made the queue says so and keeps the words", async () => {
    let toast: ToastState | null = null;
    const unsub = subscribeToast((t) => { if (t) toast = t; });
    withChips(async () => null);
    fireEvent.click(screen.getByText("Thanks"));
    await new Promise((r) => setTimeout(r, 0));
    expect(getTodayOutbox()).toHaveLength(0);
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    expect(toast!.message).toBe("Couldn't Send · Nothing Was Lost");
    unsub();
  });
});

// §AM R6, R8 (2026-09-26): the notices whose line carries a meaning draw it
// with the key, the way the Today bill card above them draws its bill. A
// bill due tomorrow reads amber on both cards, never amber on one and grey
// on the other, and a wait's age wears the ladder rather than Quiet's red.
describe("MailNotices: the line wears the key", () => {
  beforeEach(() => localStorage.clear());

  it("draws a bill's amount white and its due day amber, the dot the stylesheet's", () => {
    saveMailSnapshot(snap({
      needsYou: 1,
      threads: [{ ...thread("t1", "Northlake Power", "your bill"), act: { kind: "bill", title: "Power", date: "2026-08-21", amount: 12 } }],
    }));
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    // 2026-09-27 (the audit leftover): a card that carries facts draws them
    // as the wrapping form, .fact spans straight in the card's .conn-meta,
    // so every fact shows whole beside the capsule.
    const facts = container.querySelector(".stream-card .conn-meta");
    expect(facts).not.toBeNull();
    expect(facts!.querySelector(".fact b")!.textContent).toBe("$12.00");
    expect(facts!.querySelector(".fact.warn")!.textContent).toBe("Tomorrow");
    expect(facts!.textContent).not.toContain("·");
  });

  it("draws a wait's age on the ladder and the subject after it", () => {
    saveMailSnapshot(snap({ waiting: [{ threadId: "w1", to: "Rob", subject: "The deck", days: 9 }] }));
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    const facts = [...container.querySelectorAll(".stream-card .conn-meta > .fact")];
    expect(facts.map((f) => f.textContent)).toEqual(["9 Days", "The deck"]);
    expect(facts[0]!.classList.contains("warn")).toBe(true);
    expect(container.querySelector(".qd-hot")).toBeNull();
  });

  // The ladder climbs on nudges as well as on the clock, and the rail reads
  // them, so the card reads the same counts: a three-day wait he has chased
  // twice is red here as it is red on the rail.
  it("puts a wait he has already nudged on the rung the rail gives it", () => {
    countNudge("w1");
    countNudge("w1");
    saveMailSnapshot(snap({ waiting: [{ threadId: "w1", to: "Rob", subject: "The deck", days: 3 }] }));
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    const age = container.querySelector(".stream-card .conn-meta > .fact")!;
    expect(age.textContent).toBe("3 Days");
    expect(age.classList.contains("red")).toBe(true);
  });
});

// A NOTICE IS A ROW OF THE BAND, NOT A CARD WITH A BUTTON (Dave 2026-10-05, locked: "Clean rows, no pills anywhere"; the review's
// P0: Add Bill, Add Task and Reply were three capsules inside one card, each taking 90px of a 326px row so the titles
// truncated to "Dental Clea..." and the grey lines to "Looks Like Wedne..."). The verb is the swipe's first button, the long
// press and, once it is LATE, one quiet word on the row; the tap opens the thread; the words get the width.
describe("MailNotices: the rows wear no capsule", () => {
  beforeEach(() => localStorage.clear());

  it("draws a row with its disc, its words and a chevron, and no pill, row action or button on it", () => {
    saveMailSnapshot(snap({
      needsYou: 2,
      threads: [thread("t1", "Nadia Brandt", "invoice attached"), thread("t2", "Rob Ellis", "the deck for Friday")],
    }));
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onOpenThread={() => {}} />);
    const rows = [...container.querySelectorAll(".stream-card .notice-card")];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r, "a card drawn as a row").toHaveClass("notice-card-asrow");
      expect(r.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action"), "no capsule on the row").toBeNull();
      expect(r.querySelector(".notice-disc"), "its type disc").not.toBeNull();
      expect(r.querySelector(".chev"), "the row is a door").not.toBeNull();
      expect(r.querySelector(".row-ctx"), "not late, so no word on the row").toBeNull();
    }
  });

  it("keeps the verb on the swipe tray, first, and the tap opens the thread", () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [thread("t1", "Nadia Brandt", "invoice attached")] }));
    const onOpenThread = vi.fn();
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onOpenThread={onOpenThread} />);
    const tray = [...container.querySelectorAll(".notice-swipe > button")].map((b) => b.textContent);
    expect(tray[0], "the row's verb leads its tray").toBe("Reply");
    fireEvent.click(container.querySelector(".notice-card .row")!);
    expect(onOpenThread).toHaveBeenCalledWith("t1");
  });

  it("a LATE notice shows its one verb as a quiet word on the row, the same verb as the swipe", () => {
    countNudge("w1");
    countNudge("w1");
    saveMailSnapshot(snap({ waiting: [{ threadId: "w1", to: "Rob", subject: "The deck", days: 3 }] }));
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    const ctx = container.querySelector(".notice-card .row-ctx")!;
    expect(ctx).not.toBeNull();
    expect(ctx).not.toHaveClass("pill-act");
    expect(ctx.textContent).toBe(container.querySelector(".notice-swipe > button")!.textContent);
    expect(container.querySelectorAll(".notice-card .pill-act, .notice-card .row-act").length).toBe(0);
  });

  it("a bill's day is its DUE date, so it wears the key's amber even when it is days off, not a grey small cap", () => {
    saveMailSnapshot(snap({
      needsYou: 1,
      threads: [{ ...thread("t1", "Northlake Power", "your bill"), act: { kind: "bill", title: "Power", date: "2026-08-26", amount: 12 } }],
    }));
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    const day = container.querySelector(".stream-card .conn-meta > .fact")!;
    expect(day).toHaveClass("warn");
    expect(day).not.toHaveClass("date");
    expect(day.textContent).toMatch(/^[A-Z][a-z]+$/); // a day of the week in Title Case, not caps
  });

  it("writes its grey line in Title Case and never bakes a dot into a fact", () => {
    saveMailSnapshot(snap({
      needsYou: 2,
      threads: [
        thread("t1", "Nadia Brandt", "signature needed before monday"),
        { ...thread("t2", "Northlake Power", "your bill"), act: { kind: "bill", title: "Power", date: "2026-08-21", amount: 12 } },
      ],
    }));
    const { container } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    const metas = [...container.querySelectorAll(".stream-card .conn-meta")];
    const gist = metas.find((m) => /Signature/i.test(m.textContent ?? ""))!;
    expect(gist.textContent).toBe("Wants Signature Needed Before Monday");
    for (const f of container.querySelectorAll(".stream-card .fact")) expect(f.textContent, "a fact has no typed dot").not.toContain("·");
    // The facts are the wrapping form: spans straight in the card's own .conn-meta, so the stylesheet can lead each separator.
    expect(container.querySelector(".notice-card-wrap .conn-meta > .fact")).not.toBeNull();
  });
});
