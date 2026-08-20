import { describe, it, expect } from "vitest";
import { parseMeetingTimes, optionsAgainst, firstFree, meetingLine, acceptBody, meetingPrompt, mightProposeTimes } from "./meetingTimes";
import { attachKind, amountIn, attachOffer } from "./attachmentKind";
import { loadChases, setChase, clearChase, dueChases, chaseLine, addDays } from "./followUp";
import { loadVips, toggleVip, isVip, applyVips, vipLine, VIP_MAX } from "./vip";
import { collapseNoise, collapseLine } from "./collapse";
import { rungFor, ladderFor, loadNudgeCounts, countNudge } from "./escalate";
import { loadLinks, linkThread, threadsFor } from "./threadLink";
import { staleDrafts, staleLine, loadOffered, markOffered } from "./staleDrafts";
import { shouldAutoReply, autoReplyBody, loadAutoState, markAutoReplied } from "./autoReply";
import { parseSaid, saidQuery, saidPrompt, saidEmpty } from "./saidWhat";
import { speakable } from "./readAloud";
import { closeCandidates, closeLine, closeReceipt, closeDue, markClosed, lastClose } from "./weeklyClose";
import { sweepCandidates, sweepTitle, sweepSub, sweepReceipt } from "./unsubSweep";
import { asksIn, promisedAttachment, suggestAttachment, suggestLine } from "./attachSuggest";
import type { EventItem } from "../schedule/types";
import type { ThreadRow, MailAttachment } from "../connections/google/map";

const mem = () => {
  let v: string | null = null;
  return { getItem: () => v, setItem: (_k: string, s: string) => { v = s; } };
};
const ev = (id: string, date: string, start: string, end: string, title = id): EventItem =>
  ({ id, data: { title, date, start, end } } as unknown as EventItem);
const row = (o: Partial<ThreadRow> & { id: string }): ThreadRow =>
  ({ from: "S", fromEmail: "s@x.com", subject: "s", snippet: "", dateMs: 0, unread: false, inInbox: true, lastMsgId: "m", ...o } as ThreadRow);
const att = (filename: string, mime: string): MailAttachment => ({ filename, mime, attachmentId: "a" });

// ---------------------------------------------------------------- N1
describe("pick a time from your actual calendar", () => {
  const raw = '[{"label":"Wed 2pm","date":"2026-08-26","start":"14:00","durationMin":60},{"label":"Tue 10am","date":"2026-08-25","start":"10:00"}]';

  it("reads the times the sender offered", () => {
    const t = parseMeetingTimes(raw, "2026-08-20");
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({ label: "Wed 2pm", date: "2026-08-26", start: "14:00", end: "15:00" });
    expect(t[1]!.end).toBe("11:00"); // unstated duration defaults to an hour
  });

  it("never invents a time out of an email that proposed none", () => {
    expect(parseMeetingTimes("[]", "2026-08-20")).toEqual([]);
    expect(parseMeetingTimes("Sure, whenever suits you!", "2026-08-20")).toEqual([]);
    expect(parseMeetingTimes("[{not json", "2026-08-20")).toEqual([]);
  });

  it("drops a proposal for a day that has already gone", () => {
    expect(parseMeetingTimes('[{"label":"x","date":"2026-08-01","start":"10:00"}]', "2026-08-20")).toEqual([]);
  });

  it("checks them against real events and NAMES what is in the way", () => {
    const t = parseMeetingTimes(raw, "2026-08-20");
    const o = optionsAgainst(t, [ev("e1", "2026-08-25", "09:30", "10:30", "Board Call")]);
    expect(o[0]!.free).toBe(true);
    expect(o[1]).toMatchObject({ free: false, clash: "Board Call" });
    expect(firstFree(o)!.label).toBe("Wed 2pm");
  });

  it("says so honestly when he is busy for all of them", () => {
    const t = parseMeetingTimes(raw, "2026-08-20");
    const o = optionsAgainst(t, [ev("a", "2026-08-26", "14:00", "15:00"), ev("b", "2026-08-25", "10:00", "11:00")]);
    expect(firstFree(o)).toBeNull();
    expect(meetingLine(o)).toBe("Offered 2 times · You're busy for all of them");
  });

  it("quotes the sender's own phrase back at them", () => {
    const o = optionsAgainst(parseMeetingTimes(raw, "2026-08-20"), []);
    expect(meetingLine(o)).toBe("Offered 2 times · All open");
    expect(acceptBody(o[0]!)).toBe("Wed 2pm works for me. I've put it in.");
  });

  it("gates the expensive call on words a proposal actually uses", () => {
    expect(mightProposeTimes("Does Wed 2pm work for you?")).toBe(true);
    expect(mightProposeTimes("What's your availability next week?")).toBe(true);
    expect(mightProposeTimes("Thanks for the invoice, all looks good.")).toBe(false);
    expect(mightProposeTimes("")).toBe(false);
  });

  it("tells the model what today is, so a weekday can be resolved", () => {
    expect(meetingPrompt("Rob", "Call", "body", "2026-08-20")).toContain("Today is 2026-08-20");
  });
});

// ---------------------------------------------------------------- N2 / N6
describe("attachments become things", () => {
  it("knows a calendar file from a document from a picture", () => {
    expect(attachKind(att("clinic.ics", "text/calendar"))).toBe("calendar");
    expect(attachKind(att("Invoice_D2565.pdf", "application/pdf"))).toBe("bill");
    expect(attachKind(att("notes.pdf", "application/pdf"))).toBe("document");
    expect(attachKind(att("photo.jpg", "image/jpeg"))).toBe("image");
  });

  it("reads money only where money is marked", () => {
    expect(amountIn("Total: $1,240.00 due Sep 3")).toBe(1240);
    expect(amountIn("Net 15 on order #D2565")).toBeNull();
    expect(amountIn("Subtotal $90, tax $10, total $100")).toBe(100);
  });

  it("offers the calendar file first: it is the most actionable thing there", () => {
    const o = attachOffer({ from: "Tucci", subject: "Fall clinics", body: "", attachments: [att("c.ics", "text/calendar"), att("i.pdf", "application/pdf")] });
    expect(o).toMatchObject({ kind: "calendar", action: "Add" });
  });

  it("makes a bill only when there is a real amount to put on it", () => {
    const withMoney = attachOffer({ from: "Nike", subject: "Invoice D2565", body: "Total $1,240.00", attachments: [att("Invoice.pdf", "application/pdf")] });
    expect(withMoney).toMatchObject({ kind: "bill", amount: 1240 });
    const without = attachOffer({ from: "Nike", subject: "Invoice D2565", body: "See attached", attachments: [att("Invoice.pdf", "application/pdf")] });
    expect(without?.kind).toBe("task"); // a document to deal with, not a made-up bill
  });

  it("says nothing about a message with nothing on it", () => {
    expect(attachOffer({ from: "A", subject: "hi", body: "hi", attachments: [] })).toBeNull();
    expect(attachOffer({ from: "A", subject: "hi", body: "hi", attachments: [att("x.jpg", "image/jpeg")] })).toBeNull();
  });
});

// ---------------------------------------------------------------- N3
describe("chase me if they don't reply", () => {
  it("sets a chase for the day he named, and replaces rather than stacks", () => {
    const st = mem();
    setChase({ threadId: "t1", to: "Rob", subject: "Deck", setISO: "2026-08-20", days: 3 }, st);
    setChase({ threadId: "t1", to: "Rob", subject: "Deck", setISO: "2026-08-20", days: 7 }, st);
    const all = loadChases(st);
    expect(all).toHaveLength(1);
    expect(all[0]!.dueISO).toBe("2026-08-27");
  });

  it("never fires for a thread they answered", () => {
    const c = [{ threadId: "t1", to: "R", subject: "S", dueISO: "2026-08-19", setISO: "2026-08-16" }];
    expect(dueChases(c, "2026-08-20", [])).toHaveLength(1);
    expect(dueChases(c, "2026-08-20", ["t1"])).toHaveLength(0);
  });

  it("stays quiet until its day", () => {
    const c = [{ threadId: "t1", to: "R", subject: "S", dueISO: "2026-08-25", setISO: "2026-08-20" }];
    expect(dueChases(c, "2026-08-20", [])).toHaveLength(0);
  });

  it("clears, and survives a corrupt store", () => {
    const st = mem();
    setChase({ threadId: "t1", to: "R", subject: "S", setISO: "2026-08-20", days: 3 }, st);
    clearChase("t1", st);
    expect(loadChases(st)).toEqual([]);
    expect(loadChases({ getItem: () => "{" })).toEqual([]);
  });

  it("counts down in plain words", () => {
    expect(chaseLine({ threadId: "t", to: "R", subject: "S", dueISO: "2026-08-20", setISO: "2026-08-17" }, "2026-08-20")).toBe("Chasing today");
    expect(chaseLine({ threadId: "t", to: "R", subject: "S", dueISO: "2026-08-21", setISO: "2026-08-18" }, "2026-08-20")).toBe("Chasing tomorrow");
    expect(chaseLine({ threadId: "t", to: "R", subject: "S", dueISO: "2026-08-23", setISO: "2026-08-20" }, "2026-08-20")).toBe("Chasing in 3 days");
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
  });
});

// ---------------------------------------------------------------- N4
describe("VIPs", () => {
  it("toggles, lowercases, and caps the list", () => {
    const st = mem();
    for (let i = 0; i < VIP_MAX + 2; i++) toggleVip(`p${i}@x.com`, st);
    expect(loadVips(st)).toHaveLength(VIP_MAX);
    toggleVip("P0@x.com", st);
    expect(loadVips(st)).not.toContain("p0@x.com");
  });

  it("overrules triage, which is the entire point", () => {
    const map = { t1: { bucket: "noise" as const, gist: "g", lastMsgId: "m" } };
    const rows = [{ id: "t1", fromEmail: "Wei@bffsa.org" }];
    expect(applyVips(map, rows, ["wei@bffsa.org"]).t1!.bucket).toBe("needs_you");
    expect(applyVips(map, rows, []).t1!.bucket).toBe("noise");
  });

  it("knows a VIP whatever case the header used", () => {
    expect(isVip("WEI@bffsa.org", ["wei@bffsa.org"])).toBe(true);
    expect(isVip(undefined, ["wei@bffsa.org"])).toBe(false);
  });

  it("says what the list does, even when it is empty", () => {
    expect(vipLine(0)).toBe("Nobody yet · Their mail always surfaces");
    expect(vipLine(1)).toBe("1 Person always gets through");
  });
});

// ---------------------------------------------------------------- N5
describe("same-sender collapse", () => {
  it("collapses a pile and leaves everything else alone", () => {
    const rows = [
      row({ id: "1", fromEmail: "a@s.io", from: "Supabase" }),
      row({ id: "2", fromEmail: "a@s.io", from: "Supabase" }),
      row({ id: "3", fromEmail: "a@s.io", from: "Supabase" }),
      row({ id: "4", fromEmail: "b@x.com", from: "Rob" }),
    ];
    const { groups, loose } = collapseNoise(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(3);
    expect(loose.map((r) => r.id)).toEqual(["4"]);
    expect(collapseLine(groups[0]!)).toBe("3 Notices · Nothing needs you");
  });

  it("two from one sender is not a pile", () => {
    const rows = [row({ id: "1", fromEmail: "a@s.io" }), row({ id: "2", fromEmail: "a@s.io" })];
    expect(collapseNoise(rows).groups).toHaveLength(0);
  });

  it("puts the biggest pile first", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => row({ id: "a" + i, fromEmail: "a@x.com" })),
      ...Array.from({ length: 5 }, (_, i) => row({ id: "b" + i, fromEmail: "b@x.com" })),
    ];
    expect(collapseNoise(rows).groups[0]!.key).toBe("b@x.com");
  });
});

// ---------------------------------------------------------------- N13
describe("the escalation ladder", () => {
  it("climbs with the wait", () => {
    expect(rungFor(2)).toBe("gentle");
    expect(rungFor(9)).toBe("direct");
    expect(rungFor(55)).toBe("switch");
  });

  it("climbs with nudges already sent, even on a short wait", () => {
    expect(rungFor(1, 1)).toBe("direct");
    expect(rungFor(1, 2)).toBe("switch");
  });

  it("the last rung changes channel rather than raising its voice", () => {
    expect(ladderFor(55).label).toBe("Try Calling");
    expect(ladderFor(55).instruction).toMatch(/call/i);
  });

  it("never tells the drafter to shame anyone", () => {
    for (const d of [1, 9, 55]) {
      expect(ladderFor(d).instruction).not.toMatch(/how many times|remind(ed)? you|again/i);
    }
    expect(ladderFor(9).instruction).toMatch(/do not reference the history/i);
  });

  it("counts nudges per thread", () => {
    const st = mem();
    countNudge("t1", st);
    countNudge("t1", st);
    countNudge("t2", st);
    expect(loadNudgeCounts(st)).toEqual({ t1: 2, t2: 1 });
    expect(loadNudgeCounts({ getItem: () => "nope" })).toEqual({});
  });
});

// ---------------------------------------------------------------- N7
describe("linking a thread to a project", () => {
  it("links, relinks to one home only, and unlinks clean", () => {
    const st = mem();
    linkThread("t1", { type: "project", id: "p1", label: "Rebuild" }, st);
    linkThread("t1", { type: "project", id: "p2", label: "Golf" }, st);
    expect(Object.keys(loadLinks(st))).toEqual(["t1"]);
    expect(loadLinks(st).t1!.id).toBe("p2");
    linkThread("t1", null, st);
    expect(loadLinks(st)).toEqual({});
  });

  it("answers which threads a project owns", () => {
    const st = mem();
    linkThread("t1", { type: "project", id: "p1", label: "R" }, st);
    linkThread("t2", { type: "project", id: "p1", label: "R" }, st);
    linkThread("t3", { type: "goal", id: "p1", label: "G" }, st);
    expect(threadsFor(loadLinks(st), "project", "p1").sort()).toEqual(["t1", "t2"]);
  });

  it("survives garbage", () => {
    expect(loadLinks({ getItem: () => "[]" })).toEqual({});
  });
});

// ---------------------------------------------------------------- N10
describe("drafts you never sent", () => {
  const NOW = new Date("2026-08-20T09:00:00").getTime();
  const draft = (id: string, daysAgo: number) =>
    ({ id, to: "Rob", subject: "S", snippet: "x", dateMs: NOW - daysAgo * 86400e3 });

  it("ignores a draft from this morning", () => {
    expect(staleDrafts([draft("d1", 0)], NOW, [])).toEqual([]);
  });

  it("surfaces the oldest first", () => {
    const out = staleDrafts([draft("d1", 3), draft("d2", 9)], NOW, []);
    expect(out.map((d) => d.id)).toEqual(["d2", "d1"]);
  });

  it("asks once per draft, ever", () => {
    const st = mem();
    markOffered("d1", st);
    expect(staleDrafts([draft("d1", 5)], NOW, loadOffered(st))).toEqual([]);
  });

  it("says how long it has sat, and to whom", () => {
    expect(staleLine(draft("d1", 2), NOW)).toBe("2 Days old · Draft to Rob");
    expect(staleLine({ ...draft("d1", 2), to: "" }, NOW)).toBe("2 Days old · Draft with no recipient");
  });
});

// ---------------------------------------------------------------- N8
describe("heads-down auto-reply", () => {
  const base = {
    enabled: true, fromEmail: "wei@bffsa.org", myEmail: "dave@x.com",
    vips: ["wei@bffsa.org"], state: { blockId: "b1", repliedTo: [] }, alreadyRepliedThread: false,
  };

  it("is off unless it is explicitly on", () => {
    expect(shouldAutoReply({ ...base, enabled: false })).toBe(false);
  });

  it("answers VIPs and nobody else", () => {
    expect(shouldAutoReply(base)).toBe(true);
    expect(shouldAutoReply({ ...base, vips: [] })).toBe(false);
  });

  it("never answers a machine, and never answers himself", () => {
    expect(shouldAutoReply({ ...base, fromEmail: "no-reply@x.com", vips: ["no-reply@x.com"] })).toBe(false);
    expect(shouldAutoReply({ ...base, fromEmail: "dave@x.com", vips: ["dave@x.com"] })).toBe(false);
  });

  it("answers each person once per block", () => {
    expect(shouldAutoReply({ ...base, state: { blockId: "b1", repliedTo: ["wei@bffsa.org"] } })).toBe(false);
  });

  it("stays quiet on a thread he already answered himself", () => {
    expect(shouldAutoReply({ ...base, alreadyRepliedThread: true })).toBe(false);
  });

  it("names a real time he will be back", () => {
    expect(autoReplyBody("3:00 PM")).toBe("I'm heads down until 3:00 PM. I'll come back to you then.");
    expect(autoReplyBody("3:00 PM", "Dave")).toBe("Dave is heads down until 3:00 PM. I'll come back to you then.");
  });

  it("forgets everyone when the block changes", () => {
    const st = mem();
    markAutoReplied("b1", "wei@bffsa.org", st);
    expect(loadAutoState("b1", st).repliedTo).toEqual(["wei@bffsa.org"]);
    expect(loadAutoState("b2", st).repliedTo).toEqual([]);
  });
});

// ---------------------------------------------------------------- N11
describe("what did I tell them", () => {
  const items = [
    { subject: "Invoice", dateISO: "2026-08-12", threadId: "t1", body: "I'll get you the deck Tuesday. Thanks for waiting." },
  ];

  it("quotes him, with the date", () => {
    const out = parseSaid('[{"i":0,"quote":"I\'ll get you the deck Tuesday."}]', items);
    expect(out).toEqual([{ quote: "I'll get you the deck Tuesday.", dateISO: "2026-08-12", subject: "Invoice", threadId: "t1" }]);
  });

  it("REFUSES a quote he never wrote: a drifted word is an invented promise", () => {
    expect(parseSaid('[{"i":0,"quote":"I will get you the deck Wednesday."}]', items)).toEqual([]);
  });

  it("no match is a real answer", () => {
    expect(parseSaid("[]", items)).toEqual([]);
    expect(parseSaid("He said nothing about it.", items)).toEqual([]);
    expect(saidEmpty("Wei")).toBe("Nothing you wrote to Wei covers that");
    expect(saidEmpty("")).toBe("Nothing you wrote covers that");
  });

  it("searches his sent mail, scoped to the person when there is one", () => {
    expect(saidQuery("wei@bffsa.org", "invoice")).toBe("in:sent to:wei@bffsa.org invoice");
    expect(saidQuery("", "")).toBe("in:sent");
  });

  it("puts the question and the messages in the prompt", () => {
    const p = saidPrompt("what did I say about the deck", items.map((i) => ({ subject: i.subject, dateISO: i.dateISO, body: i.body })));
    expect(p).toContain("Question: what did I say about the deck");
    expect(p).toContain("[0] 2026-08-12");
  });
});

// ---------------------------------------------------------------- N12
describe("read me the inbox", () => {
  const n = (kind: "deadline" | "reply" | "promised" | "nudge", title: string, sub = "S") =>
    ({ key: kind, kind, threadId: "t", title, sub, action: "A", tone: "t" });

  it("says the same things the cards say", () => {
    const out = speakable([n("reply", "Wei Zhang", "Wants the invoice signed")], "One needs an answer");
    expect(out).toBe("One needs an answer. Wei Zhang is waiting on an answer. Wants the invoice signed.");
  });

  it("has no dot separators to read out loud", () => {
    const out = speakable([n("deadline", "Enrollment", "From Apple · Due today")], "");
    expect(out).not.toContain("·");
    expect(out).toContain("From Apple , Due today");
  });

  it("answers an empty inbox out loud rather than saying nothing", () => {
    expect(speakable([], "")).toBe("Nothing in your inbox needs you.");
  });

  it("reads a nudge as a person, not a headline", () => {
    expect(speakable([n("nudge", "nikestrength Hasn't Replied")], "")).toBe("nikestrength still hasn't replied.");
  });
});

// ---------------------------------------------------------------- N14
describe("the Sunday close", () => {
  const NOW = new Date("2026-08-20T09:00:00").getTime();
  const old = (id: string, bucket: string, from = "Supabase", email = "a@s.io") =>
    ({ r: row({ id, from, fromEmail: email, dateMs: NOW - 20 * 86400e3 }), bucket });

  const build = (rows: { r: ThreadRow; bucket: string }[]) => ({
    rows: rows.map((x) => x.r),
    buckets: Object.fromEntries(rows.map((x) => [x.r.id, { bucket: x.bucket }])),
  });

  it("NEVER sweeps something that needs him, however old", () => {
    const { rows, buckets } = build([old("1", "needs_you"), old("2", "noise")]);
    expect(closeCandidates(rows, buckets, [], NOW).ids).toEqual(["2"]);
  });

  it("never sweeps unsorted mail: not reading it is not evidence", () => {
    const { rows, buckets } = build([old("1", "noise")]);
    expect(closeCandidates(rows, {}, [], NOW).ids).toEqual([]);
    expect(closeCandidates(rows, buckets, [], NOW).ids).toEqual(["1"]);
  });

  it("never sweeps a VIP", () => {
    const { rows, buckets } = build([old("1", "noise", "Wei", "wei@bffsa.org")]);
    expect(closeCandidates(rows, buckets, ["wei@bffsa.org"], NOW).ids).toEqual([]);
  });

  it("leaves recent mail alone", () => {
    const r = row({ id: "1", dateMs: NOW - 2 * 86400e3 });
    expect(closeCandidates([r], { "1": { bucket: "noise" } }, [], NOW).ids).toEqual([]);
  });

  it("names senders so the receipt is checkable, not just a number", () => {
    const { rows, buckets } = build([
      old("1", "noise", "Supabase", "a@s.io"), old("2", "noise", "Apple", "b@a.io"),
      old("3", "noise", "LinkedIn", "c@l.io"), old("4", "noise", "Zoom", "d@z.io"),
    ]);
    const set = closeCandidates(rows, buckets, [], NOW);
    expect(closeLine(set)).toBe("4 Nobody chased · Supabase, Apple, LinkedIn and 1 other");
    expect(closeReceipt(set)).toBe("4 Archived · Still searchable in Gmail");
  });

  it("offers weekly, not daily", () => {
    const st = mem();
    expect(closeDue("2026-08-20", lastClose(st))).toBe(true);
    markClosed("2026-08-20", st);
    expect(closeDue("2026-08-21", lastClose(st))).toBe(false);
    expect(closeDue("2026-08-27", lastClose(st))).toBe(true);
  });
});

// ---------------------------------------------------------------- N9
describe("the unsubscribe sweep", () => {
  const tossed = { "a@x.com": 6, "b@x.com": 4, "c@x.com": 1 };

  it("offers only senders he has thrown away repeatedly, by hand", () => {
    const out = sweepCandidates(tossed, [], {}, []);
    expect(out.map((c) => c.sender)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("asks once per sender, whatever the answer was", () => {
    expect(sweepCandidates(tossed, ["a@x.com"], {}, []).map((c) => c.sender)).toEqual(["b@x.com"]);
  });

  it("knows who can actually be unsubscribed from", () => {
    const out = sweepCandidates(tossed, [], {}, ["a@x.com"]);
    expect(out[0]!.canUnsub).toBe(true);
    expect(out[1]!.canUnsub).toBe(false);
    expect(sweepSub(out)).toBe("End 1, file the rest?");
    expect(sweepSub(sweepCandidates(tossed, [], {}, ["a@x.com", "b@x.com"]))).toBe("End all 2?");
    expect(sweepSub(sweepCandidates(tossed, [], {}, []))).toBe("File all 2 to Noise?");
  });

  it("counts what actually went in the bin", () => {
    expect(sweepTitle(sweepCandidates(tossed, [], {}, []))).toBe("10 Thrown away without opening");
  });

  it("NEVER claims it worked: 'asked them to stop' is the truth", () => {
    expect(sweepReceipt(2, 1)).toBe("Asked 2 senders to stop · filed 1 to Noise");
    expect(sweepReceipt(0, 0)).toBe("Nothing changed");
  });
});

// ---------------------------------------------------------------- N15
describe("the attachment you meant to send", () => {
  const files = [{ id: "n1", name: "Tucci Waiver 2026", kind: "note" }];

  it("hears the ask in their words", () => {
    expect(asksIn("Can you send me the waiver when you get a sec?")).toContain("waiver");
    expect(asksIn("Thanks, talk soon")).toEqual([]);
  });

  it("only offers when his reply reads like it should carry a file", () => {
    expect(suggestAttachment("send me the waiver", "Attached, thanks", files)).toMatchObject({ asked: "waiver" });
    expect(suggestAttachment("send me the waiver", "Will do next week", files)).toBeNull();
  });

  it("offers only something he already has", () => {
    expect(suggestAttachment("send me the invoice", "Here's the invoice", files)).toBeNull();
  });

  it("says nothing when nobody asked for anything", () => {
    expect(suggestAttachment("Thanks!", "Attached", files)).toBeNull();
    expect(suggestAttachment("send me the waiver", "Attached", [])).toBeNull();
  });

  it("knows a promise when it sees one", () => {
    expect(promisedAttachment("Here's the file")).toBe(true);
    expect(promisedAttachment("I'll send it tomorrow")).toBe(false);
  });

  it("names both sides so he can see why it is offering", () => {
    const s = suggestAttachment("please send the waiver", "Attached", files)!;
    expect(suggestLine(s)).toBe('They asked for the waiver. You have "Tucci Waiver 2026".');
  });
});
