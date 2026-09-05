// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { refreshMailSnapshot } from "./snapshotRefresh";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import { loadMailSnapshot } from "./home";
import { loadTriageCache, saveTriageCache } from "./triage";
import { saveSweep } from "./sentSweep";
import { markPromised } from "./commitments";
import { setChase } from "./followUp";

// S6-Q34: "the email band only fills if you visit the Email tab." This is
// the headless build MailSnapshotPump calls -- same MailSnapshot shape as
// MessagesFlow.tsx's own effect, tested directly with no component mounted,
// following TodayOutboxPump.test.tsx's processTodaySend pattern.

const noAI = new AIService({ available: false });
const aiReturning = (text: string) => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ text }), text: async () => "" })) as unknown as typeof fetch,
});

const msg = (id: string, from: string, subject: string, snippet: string, labels: string[], dateMs: number): GmailMeta => ({
  id, snippet, labelIds: labels, internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});

const THREADS: GmailThreadMeta[] = [
  { id: "t1", messages: [
    msg("m1", "Ridgeley <t@x.com>", "Waiver", "Need the waiver by Friday", ["INBOX"], 100),
    msg("m2", "Ridgeley <t@x.com>", "Re: Waiver", "Haven't seen it yet", ["INBOX", "UNREAD"], 300),
  ] },
  { id: "t2", messages: [msg("m3", "DoorDash <no@dd.com>", "20% off", "Order now", ["INBOX"], 200)] },
];

const TRIAGE_REPLY = JSON.stringify([
  { id: "t1", bucket: "needs_you", gist: "Waiver still needed", by: "Friday" },
  { id: "t2", bucket: "noise", gist: "Promo" },
]);

beforeEach(() => localStorage.clear());

describe("refreshMailSnapshot: builds the home snapshot with no component mounted", () => {
  it("fetches, triages, and saves needs-you threads", async () => {
    const api = makeFakeGoogleApi({ listThreads: async () => THREADS });
    await refreshMailSnapshot({ apis: () => [{ email: "me@example.com", api }], ai: aiReturning(TRIAGE_REPLY) });

    const snap = loadMailSnapshot();
    expect(snap.needsYou).toBe(1);
    expect(snap.threads).toHaveLength(1);
    expect(snap.threads[0]!.id).toBe("t1");
    expect(snap.threads[0]!.gist).toBe("Waiver still needed");
    expect(snap.threads[0]!.by).toBe("Friday");
    expect(snap.threads[0]!.account).toBe("me@example.com");
    // The noise thread never counts toward needsYou or appears in threads.
    expect(snap.threads.some((t) => t.id === "t2")).toBe(false);
  });

  it("respects the triage cache: an already-sorted thread is never re-sent to the model", async () => {
    // Pre-seed the cache with BOTH threads already sorted, keyed by their
    // real lastMsgId, so triageDelta sees nothing new.
    saveTriageCache({
      t1: { bucket: "needs_you", gist: "Cached gist", lastMsgId: "m2" },
      t2: { bucket: "noise", gist: "Cached noise", lastMsgId: "m3" },
    });
    let calls = 0;
    const ai = new AIService({
      available: true,
      getToken: () => "tok",
      fetchImpl: (async () => {
        calls++;
        throw new Error("should never be called: cache should have covered every thread");
      }) as unknown as typeof fetch,
    });
    const api = makeFakeGoogleApi({ listThreads: async () => THREADS });
    await refreshMailSnapshot({ apis: () => [{ email: "me@example.com", api }], ai });

    expect(calls).toBe(0);
    const snap = loadMailSnapshot();
    expect(snap.threads[0]!.gist).toBe("Cached gist");
    // The cache on disk is unchanged: nothing new was merged into it.
    expect(loadTriageCache().t1!.gist).toBe("Cached gist");
  });

  it("includes waiting, promises, and chases -- none of which cost an AI call", async () => {
    saveSweep({ head: "sent-9", promises: [{ threadId: "tp1", text: "Send the roster", due: "2026-09-10" }] });
    // tp1 is not in loadPromised(), so liveSweep keeps it.
    markPromised("tp-already-handled");
    setChase({ threadId: "tc1", to: "Coach Sam", subject: "Practice plan", setISO: "2026-09-01", days: 2 });

    const api = makeFakeGoogleApi({
      listThreads: async () => [],
      searchThreads: async () => [
        { id: "tw1", messages: [
          { id: "sw1", snippet: "", internalDate: String(Date.now() - 5 * 86400e3), labelIds: ["SENT"],
            payload: { headers: [
              { name: "From", value: "Me <me@example.com>" },
              { name: "To", value: "Wei <wei@example.com>" },
              { name: "Subject", value: "Following up" },
            ] } },
        ] },
      ],
      getProfile: async () => ({ emailAddress: "me@example.com" }),
    });
    await refreshMailSnapshot({ apis: () => [{ email: "me@example.com", api }], ai: noAI });

    const snap = loadMailSnapshot();
    expect(snap.promises.some((p) => p.threadId === "tp1" && p.text === "Send the roster")).toBe(true);
    expect(snap.waiting.some((w) => w.threadId === "tw1" && w.to === "Wei")).toBe(true);
    // dueChases needs the thread NOT already answered; tc1 never appeared in
    // rows or waiting, so it counts as answered=false and stays due.
    expect(snap.chases?.some((c) => c.threadId === "tc1")).toBe(true);
  });

  it("does nothing when no account has a live token", async () => {
    await refreshMailSnapshot({ apis: () => [], ai: noAI });
    // EMPTY, untouched -- no write happened at all.
    expect(loadMailSnapshot().ts).toBe(0);
  });

  it("a failed AI call leaves threads worth_knowing (never fabricated needs_you), and still saves", async () => {
    const failing = new AIService({
      available: true,
      getToken: () => "tok",
      fetchImpl: (async () => { throw new Error("network down"); }) as unknown as typeof fetch,
    });
    const api = makeFakeGoogleApi({ listThreads: async () => THREADS });
    await expect(refreshMailSnapshot({ apis: () => [{ email: "me@example.com", api }], ai: failing }))
      .resolves.toBeUndefined();

    const snap = loadMailSnapshot();
    expect(snap.ts).toBeGreaterThan(0);
    expect(snap.needsYou).toBe(0);
    expect(snap.threads).toHaveLength(0);
  });

  // EMAIL-F-04 (2026-09-05): the headless pump used to do exactly what the
  // tab did on a dead token: read the 401 as an empty inbox and overwrite a
  // real snapshot with needsYou 0 every four hours.
  it("a failed fetch leaves the last good snapshot standing and reports the failure", async () => {
    const good = makeFakeGoogleApi({ listThreads: async () => THREADS });
    await refreshMailSnapshot({ apis: () => [{ email: "me@example.com", api: good }], ai: aiReturning(TRIAGE_REPLY) });
    const before = loadMailSnapshot();
    expect(before.needsYou).toBe(1);

    const dead = makeFakeGoogleApi({ listThreads: async () => { throw new Error("threads 401"); } });
    await expect(refreshMailSnapshot({ apis: () => [{ email: "me@example.com", api: dead }], ai: noAI }))
      .rejects.toThrow(/401/);
    expect(loadMailSnapshot()).toEqual(before);
  });

  it("a genuinely empty inbox still writes the honest empty snapshot", async () => {
    saveTriageCache({});
    const empty = makeFakeGoogleApi({ listThreads: async () => [] });
    await refreshMailSnapshot({ apis: () => [{ email: "me@example.com", api: empty }], ai: noAI });
    expect(loadMailSnapshot().ts).toBeGreaterThan(0);
    expect(loadMailSnapshot().needsYou).toBe(0);
  });

  it("one dead account out of two still writes what the live one returned", async () => {
    const good = makeFakeGoogleApi({ listThreads: async () => THREADS });
    const dead = makeFakeGoogleApi({ listThreads: async () => { throw new Error("threads 401"); } });
    await refreshMailSnapshot({
      apis: () => [{ email: "a@x.com", api: dead }, { email: "b@x.com", api: good }],
      ai: aiReturning(TRIAGE_REPLY),
    });
    expect(loadMailSnapshot().threads.map((t) => t.account)).toEqual(["b@x.com"]);
  });
});
