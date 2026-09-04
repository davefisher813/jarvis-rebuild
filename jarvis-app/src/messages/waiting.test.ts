import { describe, it, expect } from "vitest";
import { findWaiting, waitingLine, nudgePrompt, loadWaitingCache } from "./waiting";
import { loadTracks, saveTrack, trackForThread } from "./tracking";
import { encodeEmail, type GmailMeta, type GmailThreadMeta } from "../connections/google/map";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";

const DAY = 86400e3;
const NOW = 100 * DAY;

const msg = (id: string, from: string, to: string, subject: string, dateMs: number): GmailMeta => ({
  id, snippet: "s", internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }] },
});

const thread = (id: string, messages: GmailMeta[]): GmailThreadMeta => ({ id, messages });

function apiWith(threads: GmailThreadMeta[]) {
  return makeFakeGoogleApi({
    getProfile: async () => ({ emailAddress: "dave@x.com" }),
    searchThreads: async (q) => {
      expect(q).toContain("in:sent");
      return threads;
    },
  });
}

// findWaiting takes a storage explicitly in every call below (a real
// localStorage default only makes sense in a browser or jsdom -- this file
// runs in vitest's node environment, same reason tracking.ts's tests do
// this) and a fresh fixture per test keeps the cache from leaking between
// them.
function fakeStorage() {
  const s: Record<string, string> = {};
  return { getItem: (k: string) => s[k] ?? null, setItem: (k: string, v: string) => { s[k] = v; } };
}

describe("findWaiting", () => {
  it("keeps only threads where MY message is last, old enough, to a human", async () => {
    const rows = await findWaiting(apiWith([
      thread("t_sarah", [msg("m1", "Dave <dave@x.com>", "Sarah <sarah@y.com>", "LLC docs", NOW - 4 * DAY)]),
      thread("t_replied", [
        msg("m2", "Dave <dave@x.com>", "Bo <bo@y.com>", "Gym", NOW - 5 * DAY),
        msg("m3", "Bo <bo@y.com>", "Dave <dave@x.com>", "Re: Gym", NOW - 4 * DAY), // they replied: out
      ]),
      thread("t_fresh", [msg("m4", "Dave <dave@x.com>", "Al <al@y.com>", "Quick q", NOW - 1 * DAY)]), // too fresh: out
      thread("t_robot", [msg("m5", "Dave <dave@x.com>", "no-reply@apple.com", "Enrollment", NOW - 6 * DAY)]), // machine: out
      thread("t_self", [msg("m6", "Dave <dave@x.com>", "Dave <dave@x.com>", "Note", NOW - 9 * DAY)]), // self: out
    ]), NOW, 5, fakeStorage());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ threadId: "t_sarah", to: "Sarah", toEmail: "sarah@y.com", waitingDays: 4 });
  });

  it("sorts longest wait first and caps the list", async () => {
    const threads = Array.from({ length: 8 }, (_, i) =>
      thread("t" + i, [msg("m" + i, "Dave <dave@x.com>", "P" + i + " <p" + i + "@y.com>", "S" + i, NOW - (i + 2) * DAY)]));
    const rows = await findWaiting(apiWith(threads), NOW, 5, fakeStorage());
    expect(rows).toHaveLength(5);
    expect(rows[0]!.waitingDays).toBe(9);
  });

  // S2-7 (2026-09-04): "Waiting On only looks at 15 threads." Every reply
  // anyone else sends bumps a live thread back into the 15 most recent and
  // pushes an old, dead one one slot further out -- exactly the threads this
  // feature exists to surface.
  describe("the thread that ages out of the 15-thread window", () => {
    it("keeps surfacing once cached, even after it leaves the search results entirely", async () => {
      const storage = fakeStorage();
      // First call: the old ask is still in the 15-thread window.
      await findWaiting(
        apiWith([thread("t_old", [msg("m1", "Dave <dave@x.com>", "Wei <wei@bffsa.org>", "Waiver", NOW - 30 * DAY)])]),
        NOW, 5, storage,
      );
      // Second call, days later: 15 newer threads have pushed it out of the
      // window entirely -- the fake search API simply never returns it again.
      const laterNow = NOW + 5 * DAY;
      const busyWindow = Array.from({ length: 15 }, (_, i) =>
        thread("t_new" + i, [
          msg("a" + i, "Dave <dave@x.com>", "P" + i + " <p" + i + "@y.com>", "S" + i, laterNow - 1 * DAY),
          msg("b" + i, "P" + i + " <p" + i + "@y.com>", "Dave <dave@x.com>", "Re: S" + i, laterNow), // all answered
        ]));
      const rows = await findWaiting(apiWith(busyWindow), laterNow, 5, storage);
      expect(rows.map((r) => r.threadId)).toContain("t_old");
      // Not frozen at whatever it read on day 1 -- it kept counting.
      expect(rows.find((r) => r.threadId === "t_old")!.waitingDays).toBe(35);
    });

    it("clears once the window shows it actually got answered", async () => {
      const storage = fakeStorage();
      await findWaiting(
        apiWith([thread("t_old", [msg("m1", "Dave <dave@x.com>", "Wei <wei@bffsa.org>", "Waiver", NOW - 30 * DAY)])]),
        NOW, 5, storage,
      );
      expect(Object.keys(loadWaitingCache(storage))).toContain("t_old");
      const laterNow = NOW + 5 * DAY;
      const rows = await findWaiting(apiWith([
        thread("t_old", [
          msg("m1", "Dave <dave@x.com>", "Wei <wei@bffsa.org>", "Waiver", NOW - 30 * DAY),
          msg("m2", "Wei <wei@bffsa.org>", "Dave <dave@x.com>", "Re: Waiver", laterNow), // they answered
        ]),
      ]), laterNow, 5, storage);
      expect(rows).toHaveLength(0);
      expect(loadWaitingCache(storage)).not.toHaveProperty("t_old");
    });

    it("a merely-fresh reappearance (still not 2 days old) is dropped, not left stale", async () => {
      const storage = fakeStorage();
      await findWaiting(
        apiWith([thread("t1", [msg("m1", "Dave <dave@x.com>", "Wei <wei@bffsa.org>", "Waiver", NOW - 30 * DAY)])]),
        NOW, 5, storage,
      );
      const laterNow = NOW + 5 * DAY;
      // A brand new message on the same thread, sent today -- too fresh to
      // count on its own, and the old 30-day-old claim about this thread is
      // stale now that there is a newer message to judge it by.
      const rows = await findWaiting(
        apiWith([thread("t1", [msg("m2", "Dave <dave@x.com>", "Wei <wei@bffsa.org>", "Re: Waiver", laterNow)])]),
        laterNow, 5, storage,
      );
      expect(rows).toHaveLength(0);
    });

    it("caps at 200, oldest-sent evicted first", () => {
      const storage = fakeStorage();
      const cache: Record<string, unknown> = {};
      for (let i = 0; i < 205; i++) {
        cache["t" + i] = { threadId: "t" + i, to: "P", toEmail: "p@y.com", subject: "s", dateMs: i, lastMsgId: "m" + i };
      }
      storage.setItem("jarvis.mail.waiting.cache.v1", JSON.stringify(cache));
      // Any call re-saves the cache through saveWaitingCache's cap; an empty
      // search window changes nothing else, so this isolates the cap alone.
      return findWaiting(apiWith([]), NOW + 1000 * DAY, 5, storage).then(() => {
        const after = loadWaitingCache(storage);
        expect(Object.keys(after)).toHaveLength(200);
        // The 5 oldest (lowest dateMs, i.e. sent longest ago: t0..t4) are gone.
        expect(after).not.toHaveProperty("t0");
        expect(after).toHaveProperty("t204");
      });
    });
  });
});

describe("waitingLine", () => {
  const row = { threadId: "t", to: "Sarah", toEmail: "s@y.com", subject: "LLC", waitingDays: 4, lastMsgId: "m" };
  it("no open signal: states the wait, never claims 'not opened'", () => {
    const line = waitingLine(row, null);
    // SPEC MOVED (V4 capitals law, 2026-08-18): segments start capital.
    expect(line).toBe("4 Days · No reply");
    expect(line.toLowerCase()).not.toContain("not opened");
  });
  it("a real open shows the date", () => {
    expect(waitingLine(row, "2026-08-02T10:00:00Z")).toMatch(/^Opened Aug 2 · No reply$/);
  });
});

describe("nudgePrompt", () => {
  const row = { threadId: "t", to: "Sarah", toEmail: "s@y.com", subject: "LLC docs", waitingDays: 4, lastMsgId: "m" };

  it("never guilts and never leaks the tracking", () => {
    const { system, user } = nudgePrompt(row);
    expect(system).toContain("zero guilt");
    expect(system).toContain("Never mention tracking");
    expect(user).toContain("Sarah");
    expect(user).toContain("4 days");
  });

  // Brain Personalization Phase 3: this message is sent over the user's name.
  it("carries the JARVIS voice, which this prompt never had", () => {
    const { system } = nudgePrompt(row);
    expect(system).toContain("You are JARVIS");
    expect(system).toContain("Never use em dashes");
  });

  it("takes the user's writing voice when the app knows it", () => {
    const { system } = nudgePrompt(row, "User: Alex\nWriting voice: short, no greetings");
    expect(system).toContain("Write it as this person would write it:");
    expect(system).toContain("short, no greetings");
  });

  it("still builds a usable prompt when context gathering came back empty", () => {
    const { system } = nudgePrompt(row, "");
    expect(system).not.toContain("Write it as this person would write it:");
    expect(system).toContain("zero guilt"); // the real instructions survive
  });
});

describe("tracking store", () => {
  it("round-trips, maps thread to its LATEST track, caps oldest-first", () => {
    let stored: Record<string, string> = {};
    const storage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v; } };
    saveTrack("aaaaaaaa-0000-4000-8000-000000000001", { threadId: "t1", sentAt: 100 }, storage);
    saveTrack("aaaaaaaa-0000-4000-8000-000000000002", { threadId: "t1", sentAt: 200 }, storage);
    const tracks = loadTracks(storage);
    expect(trackForThread("t1", tracks)).toBe("aaaaaaaa-0000-4000-8000-000000000002"); // a nudge re-tracks
    expect(trackForThread("ghost", tracks)).toBeNull();
    for (let i = 0; i < 105; i++) {
      saveTrack("bbbbbbbb-0000-4000-8000-" + String(i).padStart(12, "0"), { threadId: "t" + i, sentAt: 300 + i }, storage);
    }
    expect(Object.keys(loadTracks(storage)).length).toBe(100);
    expect(loadTracks({ getItem: () => "{broken" })).toEqual({});
  });
});

describe("encodeEmail with pixel", () => {
  const dec = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

  it("plain by default: no html, no pixel", () => {
    const raw = dec(encodeEmail({ to: "a@b.com", subject: "Hi", body: "Yo <friend>" }));
    expect(raw).toContain("text/plain");
    expect(raw).not.toContain("multipart");
    expect(raw).toContain("Yo <friend>");
  });

  it("with pixelUrl: multipart with IDENTICAL text, escaped html, one 1x1 img", () => {
    const raw = dec(encodeEmail({ to: "a@b.com", subject: "Hi", body: "Yo <friend>\nline2", pixelUrl: "https://x.app/api/open?t=abc" }));
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Yo <friend>\nline2"); // the plain part keeps the raw text verbatim
    expect(raw).toContain("Yo &lt;friend&gt;<br>line2"); // html part is escaped
    expect(raw).toContain('src="https://x.app/api/open?t=abc" width="1" height="1"');
    expect(raw).not.toContain("In-Reply-To"); // none was given
  });
});
