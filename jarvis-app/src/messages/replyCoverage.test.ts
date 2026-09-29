import { describe, it, expect, vi } from "vitest";
import { coverageKey, coverageSummary, evaluateCoverage, normalizeReplyText, type AttachmentFact } from "./replyCoverage";
import type { ReplyRequirement } from "./mailContracts";

const req = (id: string, label: string, kind: ReplyRequirement["kind"], match: ReplyRequirement["match"], msg = "m1"): ReplyRequirement => ({
  id, sourceMessageId: msg, sourceQuote: label, kind, label, match,
});

// The four asks from the brief: which day, how many are coming, the waiver, and permission to publish.
const DAY = req("day", "Which Day", "question", { kind: "date_time", topicTerms: ["day"] });
const DAY_CHOICE = req("day", "Which Day", "question", { kind: "choice", topicTerms: ["day"], choices: ["tuesday", "thursday"] });
const PLAYERS = req("players", "Attendees", "question", { kind: "quantity", topicTerms: ["players", "attendees", "kids"] });
const WAIVER = req("waiver", "Waiver", "request", { kind: "attachment", topicTerms: ["waiver"], evidenceTerms: ["form"] });
const PUBLISH = req("publish", "Publication Permission", "question", { kind: "free_text", topicTerms: ["publish", "publication", "photos"] });
const FOUR = [DAY, PLAYERS, WAIVER, PUBLISH];
const status = (r: ReturnType<typeof evaluateCoverage>) => Object.fromEntries(r.items.map((i) => [i.requirement.id, i.status]));
const WAIVER_PDF: AttachmentFact = { filename: "Team Waiver.pdf", mime: "application/pdf" };

describe("the four asks: day, attendees, waiver, publication permission", () => {
  it("'Tuesday works, four players, yes you can publish' is 3 of 4", () => {
    const r = evaluateCoverage(FOUR, "Tuesday works, four players, yes you can publish", []);
    expect(r.answered).toBe(3);
    expect(r.total).toBe(4);
    expect(status(r)).toEqual({ day: "addressed", players: "addressed", waiver: "open", publish: "addressed" });
  });

  it("attaching the waiver makes it 4 of 4, through the file and not the words", () => {
    const r = evaluateCoverage(FOUR, "Tuesday works, four players, yes you can publish", [WAIVER_PDF]);
    expect(r.answered).toBe(4);
    const w = r.items.find((i) => i.requirement.id === "waiver")!;
    expect(w).toMatchObject({ status: "addressed", via: "attachment", completes: true });
    expect(w.note).toContain("Team Waiver.pdf");
  });

  it("typing the word waiver does not answer it", () => {
    const r = evaluateCoverage(FOUR, "Tuesday works, four players, yes you can publish, waiver", []);
    expect(r.answered).toBe(3);
    expect(status(r).waiver).toBe("open");
    expect(evaluateCoverage([WAIVER], "waiver", []).items[0]!.status).toBe("open");
    expect(evaluateCoverage([WAIVER], "The waiver form", []).items[0]!.status).toBe("open");
  });

  it("saying it is attached when nothing is attached is called out, and is not an answer", () => {
    for (const text of ["Waiver attached", "I've attached the waiver", "Here is the waiver", "Sending the waiver now"]) {
      const it = evaluateCoverage([WAIVER], text, []).items[0]!;
      expect(it.status, text).toBe("open");
      expect(it.note, text).toBe("Nothing Is Attached");
    }
  });

  it("'Can't send waiver until Friday' addresses the ask and never means it was attached", () => {
    const r = evaluateCoverage([WAIVER], "Can't send waiver until Friday", []);
    expect(r.items[0]).toMatchObject({ status: "addressed", via: "text", completes: false, note: "Deferred" });
    expect(r.answered).toBe(1);
    // Even with the same words, no file appears from nowhere.
    expect(r.items[0]!.via).not.toBe("attachment");
  });

  it("a plain decline addresses it too, and completes nothing", () => {
    const it = evaluateCoverage([WAIVER], "We won't be sending the waiver", []).items[0]!;
    expect(it).toMatchObject({ status: "addressed", completes: false, note: "Declined" });
  });

  it("a file is only the waiver when it is named for it; some other file is a maybe, not an answer", () => {
    const it = evaluateCoverage([WAIVER], "See you Tuesday", [{ filename: "IMG_0042.pdf" }]).items[0]!;
    expect(it).toMatchObject({ status: "uncertain", note: "Is That the Right File?" });
    const yes = evaluateCoverage([WAIVER], "", [{ filename: "signed-waiver-final.pdf" }]).items[0]!;
    expect(yes.status).toBe("addressed");
  });

  it("removing the attachment takes the check back, and so does deleting the sentence: both directions", () => {
    const withFile = evaluateCoverage(FOUR, "Tuesday works, four players, yes you can publish", [WAIVER_PDF]);
    expect(withFile.answered).toBe(4);
    const without = evaluateCoverage(FOUR, "Tuesday works, four players, yes you can publish", []);
    expect(without.answered).toBe(3);
    const shorter = evaluateCoverage(FOUR, "Tuesday works, four players", [WAIVER_PDF]);
    expect(shorter.answered).toBe(3);
    expect(status(shorter).publish).toBe("open");
    expect(evaluateCoverage(FOUR, "", []).answered).toBe(0);
  });

  it("the day as a choice: Tuesday or Thursday", () => {
    expect(status(evaluateCoverage([DAY_CHOICE], "Tuesday works", [])).day).toBe("addressed");
    expect(evaluateCoverage([DAY_CHOICE], "Thursday please", []).items[0]!.note).toBe("Says Thursday");
    expect(status(evaluateCoverage([DAY_CHOICE], "Four players", [])).day).toBe("open");
  });
});

describe("negation and retraction win", () => {
  it("'Tuesday doesn't work' is not Tuesday", () => {
    expect(status(evaluateCoverage([DAY_CHOICE], "Tuesday doesn't work", [])).day).not.toBe("addressed");
    expect(status(evaluateCoverage([DAY], "Tuesday doesn't work", [])).day).toBe("open");
  });

  it("'Tuesday doesn't work but Thursday does' is Thursday", () => {
    const it = evaluateCoverage([DAY_CHOICE], "Tuesday doesn't work but Thursday does", []).items[0]!;
    expect(it.status).toBe("addressed");
    expect(it.note).toBe("Says Thursday");
  });

  it("a retraction after the yes takes it back: 'Tuesday works. Scratch that.'", () => {
    expect(status(evaluateCoverage([DAY_CHOICE], "Tuesday works. Scratch that.", [])).day).not.toBe("addressed");
    expect(status(evaluateCoverage([DAY_CHOICE], "Tuesday works, actually no", [])).day).not.toBe("addressed");
    expect(status(evaluateCoverage([DAY_CHOICE], "Tuesday works. Never mind about Tuesday.", [])).day).not.toBe("addressed");
  });

  it("a yes that comes back after a no is uncertain, not answered", () => {
    const it = evaluateCoverage([DAY_CHOICE], "Tuesday doesn't work. Actually, Tuesday is fine.", []).items[0]!;
    expect(it.status).toBe("uncertain");
  });

  it("no you cannot publish is an answer (a decline), and is not a yes", () => {
    const it = evaluateCoverage([PUBLISH], "No, you can't publish the photos", []).items[0]!;
    expect(it).toMatchObject({ status: "addressed", completes: false, note: "Declined" });
    const yes = evaluateCoverage([PUBLISH], "Yes, you can publish the photos", []).items[0]!;
    expect(yes).toMatchObject({ status: "addressed", completes: true });
  });

  it("'no problem' says yes with the word no in it", () => {
    expect(evaluateCoverage([PUBLISH], "No problem, publish the photos", []).items[0]).toMatchObject({ status: "addressed", completes: true });
  });

  it("neither option works is an answer; one turned down is only half of one", () => {
    expect(evaluateCoverage([DAY_CHOICE], "Neither Tuesday nor Thursday works", []).items[0]).toMatchObject({ status: "addressed", completes: false, note: "Declined" });
    expect(evaluateCoverage([DAY_CHOICE], "Tuesday is not good", []).items[0]!.status).toBe("uncertain");
  });
});

describe("ambiguous prose stays open until the person says otherwise", () => {
  it("hedges are uncertain, never answered", () => {
    for (const text of ["Maybe Tuesday", "Tuesday, we'll see", "Probably Tuesday if possible", "Not sure yet, Tuesday might work"]) {
      expect(status(evaluateCoverage([DAY_CHOICE], text, [])).day, text).toBe("uncertain");
    }
    expect(status(evaluateCoverage([PLAYERS], "Not sure how many players yet", [])).players).toBe("uncertain");
    expect(status(evaluateCoverage([PUBLISH], "Maybe you can publish", [])).publish).toBe("uncertain");
    // A hedge on its own softens the answer before it.
    expect(status(evaluateCoverage([PUBLISH], "Yes you can publish, maybe", [])).publish).toBe("uncertain");
    expect(status(evaluateCoverage([DAY], "Tuesday works, we'll see", [])).day).toBe("uncertain");
  });

  it("a bare yes with nothing to say what it is a yes to is uncertain", () => {
    const r = evaluateCoverage([PUBLISH, WAIVER], "Yes", []);
    expect(r.items[0]).toMatchObject({ status: "uncertain", note: "Yes to What?" });
    expect(r.answered).toBe(0);
  });

  it("a day part is not a day, and a bare number is not the count", () => {
    expect(status(evaluateCoverage([DAY], "Mornings", [])).day).toBe("open");
    expect(evaluateCoverage([PLAYERS], "Four", []).items[0]!.status).toBe("uncertain");
    expect(evaluateCoverage([PLAYERS], "We have 2 questions", []).items[0]!.status).toBe("uncertain");
  });

  it("a time is not the number of players", () => {
    expect(status(evaluateCoverage([PLAYERS], "Tuesday at 3 works", [])).players).toBe("open");
  });

  it("the person's own mark beats the reading, in both directions", () => {
    const maybe = evaluateCoverage([DAY_CHOICE], "Maybe Tuesday", [], { day: "addressed" });
    expect(maybe.items[0]).toMatchObject({ status: "addressed", via: "override", note: "Marked Answered" });
    expect(maybe.answered).toBe(1);
    const forced = evaluateCoverage([DAY_CHOICE], "Tuesday works", [], { day: "open" });
    expect(forced.items[0]).toMatchObject({ status: "open", via: "override" });
    expect(forced.answered).toBe(0);
    // Marking the waiver answered by hand is allowed (it went another way).
    expect(evaluateCoverage([WAIVER], "", [], { waiver: "addressed" }).answered).toBe(1);
  });
});

describe("what is not the reply", () => {
  it("quoted history is not read: a question in the quote is not an answer", () => {
    const draft = "Sounds good.\n\nOn Mon, Sep 21, 2026 at 2:00 PM Coach <coach@club.org> wrote:\n> Yes you can publish, four players, Tuesday works";
    expect(evaluateCoverage(FOUR, draft, []).answered).toBe(0);
    expect(evaluateCoverage(FOUR, "Tuesday works\n> four players\n> yes you can publish", []).answered).toBe(1);
  });

  it("a signature and a valediction are not the reply", () => {
    const draft = "Tuesday works.\n\nThanks,\nDave Fisher\nfour players inc\nSent from my iPhone";
    expect(status(evaluateCoverage(FOUR, draft, []))).toEqual({ day: "addressed", players: "open", waiver: "open", publish: "open" });
    expect(status(evaluateCoverage(FOUR, "Tuesday works.\n-- \nYes you can publish four players", []))).toMatchObject({ players: "open", publish: "open" });
  });

  it("normalizeReplyText: contractions spelled out, quotes and signature removed, case folded", () => {
    expect(normalizeReplyText("Can’t do it. Won't work!\n\nBest,\nDave")).toBe("cannot do it. will not work!");
    expect(normalizeReplyText("Yes\n> quoted\nOn Tue, Sep 22, 2026 at 9:00 AM A <a@b.c> wrote:\n> more")).toBe("yes");
    expect(normalizeReplyText("Don't. Isn't. I'll. We've.")).toBe("do not. is not. i will. we have.");
    expect(normalizeReplyText("")).toBe("");
  });

  it("a requirement whose words never appear stays open, whatever else is typed", () => {
    expect(evaluateCoverage([PUBLISH], "Tuesday works, four players, yes", []).items[0]!.status).not.toBe("addressed");
  });
});

describe("contradictions inside one draft", () => {
  it("'yes you can publish' then 'don't publish anything' is not answered yes", () => {
    const it = evaluateCoverage([PUBLISH], "Yes you can publish. Actually no, do not publish anything.", []).items[0]!;
    expect(it.status).toBe("addressed");
    expect(it.completes).toBe(false);
    expect(it.note).toBe("Declined");
  });

  it("two days answer the question (options offered); a day and its retraction do not", () => {
    expect(status(evaluateCoverage([DAY], "Tuesday works, Thursday works too", [])).day).toBe("addressed");
    expect(status(evaluateCoverage([DAY], "Tuesday works, scratch that, Tuesday doesn't work", [])).day).toBe("open");
  });
});

describe("multiple senders and commitments", () => {
  const A = req("a1", "Roster", "request", { kind: "free_text", topicTerms: ["roster"] }, "m1");
  const B = req("b1", "Bus", "question", { kind: "free_text", topicTerms: ["bus"] }, "m3");
  const C = req("c1", "Snacks", "commitment", { kind: "free_text", topicTerms: ["snacks"] }, "m3");

  it("asks from two different messages are checked one by one", () => {
    const r = evaluateCoverage([A, B], "The roster is fine, no the bus is not available", []);
    expect(r.items.map((i) => [i.requirement.sourceMessageId, i.status])).toEqual([["m1", "addressed"], ["m3", "addressed"]]);
    expect(evaluateCoverage([A, B], "The roster is fine", []).answered).toBe(1);
  });

  it("a commitment needs a commitment, not a yes", () => {
    expect(evaluateCoverage([C], "Snacks are great", []).items[0]!.status).toBe("open");
    expect(evaluateCoverage([C], "I'll bring snacks", []).items[0]).toMatchObject({ status: "addressed", note: "Committed" });
    expect(evaluateCoverage([C], "We will bring the snacks tomorrow", []).items[0]!.status).toBe("addressed");
  });

  it("a cue-less mention takes its answer from a bare yes beside it", () => {
    expect(evaluateCoverage([B], "Bus? Yes.", []).items[0]!.status).toBe("addressed");
    expect(evaluateCoverage([B], "Bus? No.", []).items[0]).toMatchObject({ status: "addressed", completes: false });
  });
});

describe("the summary line", () => {
  it("says Answered 3 of 4 for a complete read", () => {
    const r = evaluateCoverage(FOUR, "Tuesday works, four players, yes you can publish", []);
    expect(coverageSummary(r, true)).toEqual({ label: "Answered 3 of 4", incomplete: false });
  });

  it("says so, and points at the requests, when part of the conversation was not read", () => {
    const r = evaluateCoverage(FOUR, "Tuesday works, four players, yes you can publish", []);
    expect(coverageSummary(r, false)).toEqual({ label: "Answered 3 of 4 Found · Review Requests", incomplete: true });
  });

  it("a complete read that found nothing shows nothing; a partial one that found nothing still says it", () => {
    const none = evaluateCoverage([], "anything", []);
    expect(coverageSummary(none, true)).toBeNull();
    expect(coverageSummary(none, false)).toEqual({ label: "Answered 0 of 0 Found · Review Requests", incomplete: true });
  });

  it("coverageKey is the requirement's own stable id", () => {
    expect(coverageKey(WAIVER)).toBe("waiver");
  });
});

describe("100 keystrokes: no model, no network", () => {
  it("evaluates every prefix of a real reply, calling nothing", () => {
    const fetchSpy = vi.fn();
    const complete = vi.fn();
    const g = globalThis as unknown as { fetch?: unknown };
    const realFetch = g.fetch;
    g.fetch = fetchSpy;
    try {
      const text = "Tuesday works, four players, yes you can publish. Can't send waiver until Friday. Thanks, Dave".repeat(1).slice(0, 100);
      let prev = -1;
      const counts: number[] = [];
      for (let i = 1; i <= 100; i++) {
        const r = evaluateCoverage(FOUR, text.slice(0, i), i > 95 ? [WAIVER_PDF] : []);
        counts.push(r.answered);
        expect(r.total).toBe(4);
        prev = r.answered;
      }
      expect(prev).toBeGreaterThan(0);
      // It rose as the words arrived.
      expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(counts[10]!);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    } finally {
      g.fetch = realFetch;
    }
  });

  it("is a pure function: the same inputs give the same answer, and nothing it is given is changed", () => {
    const reqs = JSON.parse(JSON.stringify(FOUR)) as ReplyRequirement[];
    const files = [WAIVER_PDF];
    const before = JSON.stringify([reqs, files]);
    const a = evaluateCoverage(reqs, "Tuesday works, four players", files);
    const b = evaluateCoverage(reqs, "Tuesday works, four players", files);
    expect(a).toEqual(b);
    expect(JSON.stringify([reqs, files])).toBe(before);
  });

  it("the evaluator's source names no fetch, no model and no storage", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./replyCoverage.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    for (const banned of [/\bfetch\s*\(/, /\.complete\s*\(/, /localStorage/, /XMLHttpRequest/, /\bimport\s+.*ai\//, /AIService/]) {
      expect(src).not.toMatch(banned);
    }
  });
});
