import { describe, it, expect } from "vitest";
import { inboxSentence } from "./inboxBrief";
import { loadSnoozes, snoozeNotice, sleepingNow, snoozeChoices } from "./snoozeNotice";
import { parseCardDraft, cardReplyPrompt, cardNudgePrompt, CARD_DRAFT_MAX } from "./cardDraft";
import { quickAnswers, DEFAULT_ANSWERS } from "./quickAnswers";
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

  it("says how long someone has actually been waiting", () => {
    const s = snap({ waiting: [{ threadId: "w1", to: "Rob", subject: "Deck", days: 55 }] });
    expect(inboxSentence([notice("nudge", "w1")], s)).toBe("Someone has been waiting 55 days on you");
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
