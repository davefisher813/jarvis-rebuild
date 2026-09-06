import { describe, it, expect } from "vitest";
import { inboxSentence } from "./inboxBrief";
import { loadSnoozes, snoozeNotice, sleepingNow, snoozeChoices } from "./snoozeNotice";
import { parseCardDraft, cardReplyPrompt, cardNudgePrompt, CARD_DRAFT_MAX } from "./cardDraft";
import { quickAnswers, DEFAULT_ANSWERS } from "./quickAnswers";
import { byTime, mailNotices } from "./home";
import type { MailNotice, MailSnapshot } from "./home";

const notice = (kind: MailNotice["kind"], threadId: string): MailNotice =>
  ({ key: kind + ":" + threadId, kind, threadId, title: "T", sub: "S", action: "A", tone: "cat-fg-red" });

const snap = (over: Partial<MailSnapshot> = {}): MailSnapshot =>
  ({ ts: 0, needsYou: 0, threads: [], waiting: [], promises: [], ...over });

describe("the morning sentence", () => {
  it("says nothing when there is nothing to say", () => {
    expect(inboxSentence([], snap())).toBe("");
  });

  it("names one thing plainly", () => {
    expect(inboxSentence([notice("reply", "t1")], snap({ needsYou: 1, threads: [{ id: "t1" } as never] })))
      .toBe("One needs an answer");
  });

  it("joins several with an and, not a comma soup", () => {
    const n = [notice("deadline", "t1"), notice("reply", "t2"), notice("promised", "p1")];
    expect(inboxSentence(n, snap({ needsYou: 2, threads: [{ id: "t1" }, { id: "t2" }] as never })))
      .toBe("One has a deadline today, one needs an answer and one is something you promised");
  });

  // EMAIL-F-24 (2026-09-05): this asserted the sentence backwards. Rob has
  // not answered HIM for 55 days; the line announced that somebody was
  // waiting on Dave, which is the opposite fact and the opposite feeling.
  it("says how long someone has actually owed him a reply", () => {
    const s = snap({ waiting: [{ threadId: "w1", to: "Rob", subject: "Deck", days: 55 }] });
    expect(inboxSentence([notice("nudge", "w1")], s)).toBe("Someone has owed you a reply for 55 days");
  });

  it("mentions the rest only when there IS a rest", () => {
    const shown = snap({ needsYou: 4, threads: [{ id: "t1" }] as never });
    expect(inboxSentence([notice("reply", "t1")], shown)).toBe("One needs an answer, and three more that can wait");
    const covered = snap({ needsYou: 1, threads: [{ id: "t1" }] as never });
    expect(inboxSentence([notice("reply", "t1")], covered)).toBe("One needs an answer");
  });
});

describe("snoozing a notice", () => {
  const mem = () => {
    let v: string | null = null;
    return { getItem: () => v, setItem: (_k: string, s: string) => { v = s; } };
  };

  it("round-trips within the day", () => {
    const st = mem();
    snoozeNotice("reply:t1", "16:00", "2026-08-20", st);
    expect(loadSnoozes("2026-08-20", st)).toEqual({ "reply:t1": "16:00" });
  });

  it("last night's snooze cannot silence this morning", () => {
    const st = mem();
    snoozeNotice("reply:t1", "23:00", "2026-08-19", st);
    expect(loadSnoozes("2026-08-20", st)).toEqual({});
  });

  it("wakes a notice the moment its time comes", () => {
    const s = { "a": "16:00", "b": "09:00" };
    expect(sleepingNow(s, "10:00")).toEqual(["a"]);
    expect(sleepingNow(s, "16:00")).toEqual([]);
  });

  it("survives a corrupt store", () => {
    expect(loadSnoozes("2026-08-20", { getItem: () => "{" })).toEqual({});
  });

  it("never offers a time that has already gone", () => {
    const c = snoozeChoices("09:00");
    expect(c.length).toBeGreaterThan(0);
    for (const o of c) expect(o.at > "09:00").toBe(true);
  });

  it("offers nothing once the day is over", () => {
    expect(snoozeChoices("21:45")).toEqual([]);
  });

  it("reads the time like a person", () => {
    expect(snoozeChoices("09:00")[0]).toEqual({ label: "Back at 10 AM", at: "10:00" });
  });
});

describe("a draft on the card", () => {
  it("takes a clean answer as-is", () => {
    expect(parseCardDraft("Signed and sent back this morning.")).toBe("Signed and sent back this morning.");
  });

  it("strips the wrappers models add", () => {
    expect(parseCardDraft('Reply: "Sounds good, Tuesday works."')).toBe("Sounds good, Tuesday works.");
    expect(parseCardDraft("```\nOn it today.\n```")).toBe("On it today.");
  });

  it("a refusal is NOT a draft", () => {
    expect(parseCardDraft("I cannot write that for you.")).toBe("");
    expect(parseCardDraft("As an AI language model, I...")).toBe("");
  });

  it("refuses anything too long to belong on a card", () => {
    expect(parseCardDraft("x".repeat(CARD_DRAFT_MAX + 1))).toBe("");
  });

  it("empty in, empty out: never a blank message to send", () => {
    expect(parseCardDraft("")).toBe("");
    expect(parseCardDraft("   ")).toBe("");
  });

  it("carries his voice into the prompt when there is one", () => {
    const withVoice = cardReplyPrompt("Wei", "Invoice", "Wants it signed", "body", "I write short.");
    expect(withVoice.system).toContain("I write short.");
    expect(withVoice.user).toContain("Subject: Invoice");
    expect(cardReplyPrompt("Wei", "Invoice", "g", "b").system).not.toContain("Write it as this person");
  });

  it("the nudge prompt forbids the shaming version", () => {
    const p = cardNudgePrompt("Rob", "Deck", 9);
    expect(p.system).toMatch(/never mention tracking/i);
    expect(p.user).toContain("9 days ago");
  });
});

describe("quick answers", () => {
  it("uses what the AI already generated", () => {
    expect(quickAnswers(["Yes", "Can't, send times", "Let me check"]))
      .toEqual(["Yes", "Can't, send times", "Let me check"]);
  });

  it("never shows more than three", () => {
    expect(quickAnswers(["a", "b", "c", "d", "e"])).toHaveLength(3);
  });

  it("drops a chip too long to be a whole reply", () => {
    expect(quickAnswers(["Yes", "I will get back to you about that later this week probably"]))
      .toEqual(["Yes"]);
  });

  it("dedupes, case-insensitively", () => {
    expect(quickAnswers(["Yes", "yes", "No"])).toEqual(["Yes", "No"]);
  });

  it("keeps the row one line tall: long chips spend the budget and the rest fold", () => {
    // Dave's Custom Ink screenshot (2026-08-26): three long promo answers
    // stacked three lines high. One survivor beats a tower; the first chip
    // always stays even when it alone is over the row budget.
    expect(quickAnswers(["Not interested right now", "Maybe next promotion", "Unsubscribe me please"]))
      .toEqual(["Not interested right now"]);
    // Short sets still ride together untouched.
    expect(quickAnswers(["Yes", "No", "Call me"])).toEqual(["Yes", "No", "Call me"]);
  });

  it("falls back rather than showing an empty row", () => {
    expect(quickAnswers([])).toEqual(DEFAULT_ANSWERS);
    expect(quickAnswers(undefined)).toEqual(DEFAULT_ANSWERS);
    expect(quickAnswers(["   ", ""])).toEqual(DEFAULT_ANSWERS);
  });

  it("drops a long question back at him: he cannot send that blind", () => {
    expect(quickAnswers(["Do you want me to handle this one or should Rob?"])).toEqual(DEFAULT_ANSWERS);
    expect(quickAnswers(["Which one?"])).toEqual(["Which one?"]);
  });
});

// UP-MIND-07 (2026-09-05): "by 3 PM" on a day booked until 3 is a different
// fact than the same deadline on an empty day. Stated as a fact, never as a
// reschedule offer: JARVIS says what is, it does not advise.
describe("UP-MIND-07: a deadline that lands during a meeting", () => {
  const today = "2026-08-15";
  const at2pm = new Date("2026-08-15T09:00:00");
  // Anchored on purpose: UP-MIND-18 hedges a claim that cannot show the
  // sentence it came from, and these cases are about the collision clause.
  const anchored = { sourceMsgId: "m1", span: "Can you get it back to me by 3 PM?", confidence: "high" as const };
  const snapWith = (by: string): MailSnapshot => ({
    ts: Date.now(), needsYou: 1, waiting: [], promises: [],
    threads: [{ id: "t1", from: "Nadia", fromEmail: "n@x.com", subject: "Roster", gist: "needs the roster", by, byEv: anchored }],
  });

  it("reads a clock out of the sender's phrase, and nothing out of a day word", () => {
    expect(byTime("by 3 PM")).toBe("15:00");
    expect(byTime("before 3pm")).toBe("15:00");
    expect(byTime("15:30")).toBe("15:30");
    expect(byTime("12 am")).toBe("00:00");
    expect(byTime("friday")).toBeNull();
    expect(byTime("end of month")).toBeNull();
    expect(byTime(undefined)).toBeNull();
  });

  it("names the meeting the deadline lands inside", () => {
    const n = mailNotices(snapWith("3 PM"), today, at2pm, 3, [], [
      { title: "Board Prep", date: today, start: "13:00", end: "15:00" },
    ])[0]!;
    expect(n.sub).toBe("From Nadia · Due 3:00 PM · You're in Board Prep until 3:00");
  });

  it("says nothing when the day is clear at that hour", () => {
    const n = mailNotices(snapWith("3 PM"), today, at2pm, 3, [], [
      { title: "Standup", date: today, start: "09:00", end: "09:15" },
    ])[0]!;
    expect(n.sub).toBe("From Nadia · Due 3:00 PM");
  });

  it("never invents a clock from a day word", () => {
    const n = mailNotices(snapWith("today"), today, at2pm, 3, [], [
      { title: "Board Prep", date: today, start: "00:00", end: "23:59" },
    ])[0]!;
    expect(n.sub).toBe("From Nadia · Due today");
  });

  it("reads tomorrow's calendar for tomorrow's deadline", () => {
    const n = mailNotices(snapWith("tomorrow 3 PM"), today, at2pm, 3, [], [
      { title: "Board Prep", date: "2026-08-16", start: "13:00", end: "16:00" },
    ])[0]!;
    expect(n.sub).toBe("From Nadia · Due tomorrow 3:00 PM · You're in Board Prep until 4:00");
  });

  it("keeps working for a caller with no calendar at all", () => {
    const n = mailNotices(snapWith("3 PM"), today, at2pm)[0]!;
    expect(n.sub).toBe("From Nadia · Due 3:00 PM");
  });
});
