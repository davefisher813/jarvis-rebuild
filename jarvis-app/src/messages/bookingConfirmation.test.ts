// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ensureThreadBrief, type ThreadBriefAI, type ThreadBriefArgs } from "./threadBrief";
import { briefPrompt, parseBrief, scheduledState } from "./brief";
import { meetingOffers } from "./meetingOffers";
import type { SourceInput } from "./briefSource";
import { resetInboxRefreshState } from "./inboxRefresh";

// THE LIVE MISS (Dave 2026-09-29). A tee-time booking confirmation came back
// Settled, with no Add to Schedule. The mail:
//
//   Your Tee Time Booking at Brennan Golf has been accepted for:
//   Date: Thursday - October 01, 2026, Time: 11:20 AM, 18 holes, 2 players,
//   Confirm #15172.
//
// Nobody negotiated; the club confirmed. The requirement is a CONFIRMED date
// and time, not a two-party agreement. The guards (never a proposal, an
// option, a conditional or an invented time) are unchanged and pinned here.

const ME = "dave@me.com";
const scope = { userId: "u1", account: ME };
const SENT = Date.UTC(2026, 8, 29, 15, 0); // Tuesday 2026-09-29, 11:00 AM in New York

const TEE = [
  "Your Tee Time Booking at Brennan Golf has been accepted for:",
  "Date: Thursday - October 01, 2026, Time: 11:20 AM, 18 holes, 2 players, Confirm #15172.",
].join("\n");
const QUOTE = "Date: Thursday - October 01, 2026, Time: 11:20 AM";

const tee = (body = TEE): SourceInput[] => [{ id: "m1", from: "Brennan", fromEmail: "Brennan@chelseareservations.net", dateMs: SENT, body }];
const args = (ai: ThreadBriefAI, messages = tee()): ThreadBriefArgs => ({
  ai, scope, threadId: "t-tee", subject: "Tee Time Booking Confirmation", messages, selfEmails: [ME], zone: "America/New_York",
});
function fakeAI(answer: Record<string, unknown>) {
  const prompts: string[] = [];
  const ai: ThreadBriefAI = {
    available: true,
    complete: vi.fn(async (m) => { prompts.push(m[0]!.content); return JSON.stringify({ summary: "Tee time Thu Oct 1, 11:20 AM", replies: ["Thanks", "Got it", "See you"], ...answer }); }),
  };
  return { ai, prompts };
}
const cand = (over: Record<string, unknown> = {}) => ({ messageId: "m1", quote: QUOTE, title: "Tee time at Brennan Golf", status: "agreed", ...over });

beforeEach(() => { localStorage.clear(); resetInboxRefreshState(); });

describe("the tee-time confirmation is a schedule addition", () => {
  it("reads the confirmed day and time, with the default 60 minutes", async () => {
    const { ai } = fakeAI({ state: "settled", meetingCandidates: [cand()] });
    const r = await ensureThreadBrief(args(ai));
    expect(r.brief?.meetingCandidates).toHaveLength(1);
    expect(r.brief?.meetingCandidates?.[0]).toMatchObject({
      status: "agreed", date: "2026-10-01", start: "11:20", end: "12:20", durationSource: "default", missing: [],
    });
  });

  it("the thread is scheduled, not settled, whatever the model called it", async () => {
    for (const state of ["settled", "no_action", undefined]) {
      localStorage.clear(); resetInboxRefreshState();
      const { ai } = fakeAI({ ...(state ? { state } : {}), meetingCandidates: [cand()] });
      const r = await ensureThreadBrief(args(ai));
      expect(r.brief?.state, String(state)).toBe("scheduled");
    }
  });

  it("a thread still waiting on somebody keeps saying so", async () => {
    const { ai } = fakeAI({ state: "waiting_on_you", meetingCandidates: [cand()] });
    expect((await ensureThreadBrief(args(ai))).brief?.state).toBe("waiting_on_you");
  });

  it("the card offers one tap Add, and nothing has been written", async () => {
    const { ai } = fakeAI({ state: "settled", meetingCandidates: [cand()] });
    const r = await ensureThreadBrief(args(ai));
    const offers = meetingOffers({ candidates: r.brief!.meetingCandidates!, order: ["m1"], filed: {}, today: "2026-09-29" });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ kind: "add", candidate: { date: "2026-10-01", start: "11:20" } });
  });

  it("the same confirmation on one line, and with the times run together, reads the same", async () => {
    const oneLine = TEE.replace("\n", " ");
    const { ai } = fakeAI({ meetingCandidates: [cand()] });
    const r = await ensureThreadBrief(args(ai, tee(oneLine)));
    expect(r.brief?.meetingCandidates?.[0]).toMatchObject({ date: "2026-10-01", start: "11:20" });
  });
});

describe("the guards are unchanged", () => {
  it("a proposal is not scheduled", async () => {
    const body = "How about Thursday - October 01, 2026, Time: 11:20 AM for the tee time?";
    const { ai } = fakeAI({ state: "waiting_on_you", meetingCandidates: [cand({ quote: "Thursday - October 01, 2026, Time: 11:20 AM", status: "proposed" })] });
    const r = await ensureThreadBrief(args(ai, tee(body)));
    expect(r.brief?.state).toBe("waiting_on_you");
    const offers = meetingOffers({ candidates: r.brief!.meetingCandidates!, order: ["m1"], filed: {}, today: "2026-09-29" });
    expect(offers).toEqual([]);
  });

  it("a proposal the model filed as settled stays settled: only an agreed candidate schedules", async () => {
    const { ai } = fakeAI({ state: "settled", meetingCandidates: [cand({ status: "proposed" }), cand({ status: "requested", quote: "Time: 11:20 AM" })] });
    expect((await ensureThreadBrief(args(ai))).brief?.state).toBe("settled");
  });

  it("several options are not scheduled", async () => {
    const body = "We have Thursday - October 01, 2026, Time: 11:20 AM or Friday - October 02, 2026, Time: 9:00 AM open.";
    const { ai } = fakeAI({ state: "settled", meetingCandidates: [cand({ quote: "Thursday - October 01, 2026, Time: 11:20 AM or Friday - October 02, 2026, Time: 9:00 AM" })] });
    const r = await ensureThreadBrief(args(ai, tee(body)));
    // Two days and two times in one sentence is nothing picked, nothing to add.
    expect(r.brief?.meetingCandidates?.[0]).toMatchObject({ missing: expect.arrayContaining(["time"]) });
    expect(r.brief?.meetingCandidates?.[0]?.start).toBeUndefined();
    expect(r.brief?.state).toBe("settled");
  });

  it("a date with no time is asked about, not scheduled", async () => {
    const body = "Your Tee Time Booking has been accepted for Thursday - October 01, 2026. We will confirm the time later.";
    const { ai } = fakeAI({ state: "settled", meetingCandidates: [cand({ quote: "Thursday - October 01, 2026" })] });
    const r = await ensureThreadBrief(args(ai, tee(body)));
    expect(r.brief?.meetingCandidates?.[0]?.start).toBeUndefined();
    expect(r.brief?.state).toBe("settled");
  });

  it("a time the email does not contain is dropped: nothing is invented", async () => {
    const { ai } = fakeAI({ state: "settled", meetingCandidates: [cand({ quote: "Date: Thursday - October 01, 2026, Time: 3:45 PM" })] });
    const r = await ensureThreadBrief(args(ai));
    expect(r.brief?.meetingCandidates).toEqual([]);
    expect(r.brief?.state).toBe("settled");
  });

  it("a cancelled booking is not scheduled", async () => {
    const { ai } = fakeAI({ state: "settled", meetingCandidates: [cand({ status: "cancelled" })] });
    expect((await ensureThreadBrief(args(ai))).brief?.state).toBe("settled");
  });
});

describe("the prompt asks for a confirmed date and time, not a two-party agreement", () => {
  it("names the one-sided confirmations and keeps every guard (v4, the live call)", async () => {
    const { ai, prompts } = fakeAI({ meetingCandidates: [] });
    await ensureThreadBrief(args(ai));
    const p = prompts[0]!;
    expect(p).toMatch(/CONFIRMED date and time/);
    for (const w of ["tee time", "flight", "hotel", "car rental", "restaurant reservation", "appointment confirmation"]) expect(p).toContain(w);
    expect(p).toMatch(/one-sided/);
    expect(p).toMatch(/never for a proposal, one of several options or a conditional time/);
    expect(p).toMatch(/Do NOT work out dates or times yourself/);
    expect(p).toMatch(/scheduled when the thread holds a CONFIRMED date and time/);
    expect(p).not.toMatch(/BOTH sides/);
  });

  it("the older meeting prompt says the same, with its own guards and the 60 minute default", () => {
    const p = briefPrompt("convo", "2026-09-29");
    expect(p).toMatch(/CONFIRMED date and time/);
    expect(p).toContain("tee time");
    expect(p).not.toMatch(/BOTH sides/);
    expect(p).toMatch(/PROPOSED, is one of several options, is conditional/);
    expect(p).toMatch(/Never invent a date, a time or a duration/);
    expect(p).toMatch(/default the duration to 60/);
  });
});

describe("the older confirmed meeting schedules the thread too", () => {
  it("a parsed meeting turns settled into scheduled, with 60 minutes when none is stated", () => {
    const b = parseBrief('{"summary":"Tee time Thu 11:20","replies":["a","b","c"],"state":"settled","meeting":{"title":"Tee time at Brennan Golf","date":"2026-10-01","start":"11:20"}}');
    expect(b?.meeting).toEqual({ title: "Tee time at Brennan Golf", date: "2026-10-01", start: "11:20", end: "12:20" });
    expect(b?.state).toBe("scheduled");
  });
  it("no meeting, no change", () => {
    expect(parseBrief('{"summary":"Thanks","replies":["a","b","c"],"state":"settled"}')?.state).toBe("settled");
  });
});

describe("scheduledState", () => {
  const ok = { id: "x", sourceMessageId: "m1", sourceQuote: "q", title: "t", status: "agreed" as const, date: "2026-10-01", start: "11:20", end: "12:20", missing: [], durationSource: "default" as const };
  it("only a complete agreed candidate schedules", () => {
    expect(scheduledState("settled", null, [ok])).toBe("scheduled");
    expect(scheduledState("settled", null, [{ ...ok, status: "proposed" }])).toBe("settled");
    expect(scheduledState("settled", null, [{ ...ok, missing: ["time"] }])).toBe("settled");
    expect(scheduledState("settled", null, [{ ...ok, start: undefined as never }])).toBe("settled");
    expect(scheduledState("settled", null, undefined)).toBe("settled");
    expect(scheduledState("waiting_on_them", null, [ok])).toBe("waiting_on_them");
    expect(scheduledState(undefined, null, [ok])).toBe("scheduled");
    expect(scheduledState(undefined, null, [])).toBeUndefined();
  });
});
