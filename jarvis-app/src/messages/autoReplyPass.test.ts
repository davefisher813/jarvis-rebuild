// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { runAutoReplyPass, blockIdOf, runningFocusBlock } from "./autoReplyPass";
import { setAutoReplyEnabled, loadAutoState } from "./autoReply";
import { toggleVip } from "./vip";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import type { GmailThreadMeta, GmailThreadFull } from "../connections/google/map";
import { DEFAULT_ROUTINE, type RoutineData } from "../routine/types";

// EMAIL-F-16 (2026-09-05): "Heads-Down Auto-Reply only runs while the Email
// tab is open, on threads already loaded." The pass is a function over an api
// and a routine now, so these tests are what the old effect could never have:
// mail arriving mid-block, with no Email tab anywhere.

const vipMsg = (id: string, from: string, labels: string[]) => ({
  id, snippet: "quick question", labelIds: labels, internalDate: "1000",
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: "The waiver" }] },
});

const THREAD: GmailThreadMeta = { id: "t1", messages: [vipMsg("m1", "Rob <rob@x.com>", ["INBOX", "UNREAD"])] };

const FULL = {
  id: "t1",
  messages: [{ id: "m1", threadId: "t1", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("Quick question") },
    headers: [{ name: "From", value: "Rob <rob@x.com>" }, { name: "Subject", value: "The waiver" }, { name: "Message-ID", value: "<a@x>" }] } }],
} as unknown as GmailThreadFull;

// A focus block every day, 7pm to 8pm local.
const routine = (): RoutineData => ({
  ...DEFAULT_ROUTINE,
  protectedBlocks: [{ id: "b1", label: "Deep Work", startMin: 19 * 60, endMin: 20 * 60, days: [0, 1, 2, 3, 4, 5, 6], kind: "focus" }],
});

function api(sent: string[], threads: GmailThreadMeta[] = [THREAD]) {
  return makeFakeGoogleApi({
    listThreads: async () => threads,
    getThread: async () => FULL,
    sendMessage: async (raw: string) => { sent.push(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))); return { id: "s1" }; },
  });
}

function deps(sent: string[], now: Date, threads?: GmailThreadMeta[]) {
  return {
    apis: () => [{ email: "dave@x.com", api: api(sent, threads) }],
    routine: async () => routine(),
    myName: async () => "Dave",
    now: () => now,
  };
}

beforeEach(() => {
  localStorage.clear();
  setAutoReplyEnabled(true);
  toggleVip("rob@x.com");
});

describe("the heads-down auto-reply pass", () => {
  it("answers a VIP that lands mid-block, with no Email tab mounted", async () => {
    const sent: string[] = [];
    const n = await runAutoReplyPass(deps(sent, new Date("2026-09-07T19:30:00")));
    expect(n).toBe(1);
    expect(sent[0]).toContain("To: rob@x.com");
    expect(sent[0]).toContain("Subject: Re: The waiver");
    expect(sent[0]).toContain("Dave is heads down until 8:00 PM");
  });

  it("sends nothing when no focus block is running", async () => {
    const sent: string[] = [];
    expect(await runAutoReplyPass(deps(sent, new Date("2026-09-07T10:00:00")))).toBe(0);
    expect(sent).toEqual([]);
  });

  it("sends nothing while the switch is off", async () => {
    setAutoReplyEnabled(false);
    const sent: string[] = [];
    expect(await runAutoReplyPass(deps(sent, new Date("2026-09-07T19:30:00")))).toBe(0);
  });

  it("answers each VIP once per block, not once per pass", async () => {
    const sent: string[] = [];
    await runAutoReplyPass(deps(sent, new Date("2026-09-07T19:30:00")));
    await runAutoReplyPass(deps(sent, new Date("2026-09-07T19:32:00")));
    expect(sent.length).toBe(1);
  });

  // The block id used to be toISOString().slice(0, 10), the UTC day. An
  // evening block in Eastern time runs into the next UTC day, so the id
  // changed inside the block, loadAutoState came back empty, and a VIP
  // already answered got a second identical auto-reply.
  it("keeps one block id across UTC midnight, so a VIP is not answered twice", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const evening: RoutineData = {
        ...DEFAULT_ROUTINE,
        protectedBlocks: [{ id: "b2", label: "Deep Work", startMin: 19 * 60 + 30, endMin: 20 * 60 + 30, days: [0, 1, 2, 3, 4, 5, 6], kind: "focus" }],
      };
      const early = new Date("2026-09-07T19:40:00");
      const late = new Date("2026-09-07T20:10:00");
      // Both are inside the one block, on either side of UTC midnight.
      expect(runningFocusBlock(evening, early)).toMatchObject({ s: 19 * 60 + 30, e: 20 * 60 + 30 });
      expect(runningFocusBlock(evening, late)).toMatchObject({ s: 19 * 60 + 30, e: 20 * 60 + 30 });
      expect(late.toISOString().slice(0, 10)).not.toBe(early.toISOString().slice(0, 10));
      expect(blockIdOf({ s: 19 * 60 + 30 }, late)).toBe(blockIdOf({ s: 19 * 60 + 30 }, early));
    } finally {
      process.env.TZ = prevTz;
    }
  });

  it("never answers a thread from one of his own addresses", async () => {
    toggleVip("dave@x.com");
    const sent: string[] = [];
    const mine: GmailThreadMeta = { id: "t2", messages: [vipMsg("m2", "Dave <dave@x.com>", ["INBOX", "UNREAD"])] };
    expect(await runAutoReplyPass(deps(sent, new Date("2026-09-07T19:30:00"), [mine]))).toBe(0);
    expect(loadAutoState(blockIdOf({ s: 19 * 60 }, new Date("2026-09-07T19:30:00"))).repliedTo).toEqual([]);
  });
});
