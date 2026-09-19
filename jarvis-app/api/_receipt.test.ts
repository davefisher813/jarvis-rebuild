import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendBookingReceipt, sendBookingCancellation } from "./_receipt";
import { encrypt } from "./_google";

// THE SEAM (Track 3, 2026-09-19). The one place where the public booking
// endpoint is allowed to see the live project. What is tested here is mostly
// what it does NOT do: it does not write, it does not throw, and it does not
// claim a confirmation went out when it did not.

const KEY = Buffer.alloc(32, 3).toString("base64");
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const bad = (body: unknown, status = 400) => ({ ok: false, status, json: async () => body }) as Response;

const JOB = {
  ownerId: "u-1",
  bookingId: "b-9",
  typeName: "Intro Call",
  startMs: Date.parse("2026-09-22T18:00:00.000Z"),
  endMs: Date.parse("2026-09-22T18:30:00.000Z"),
  guestName: "Ada Lovelace",
  guestEmail: "ada@example.com",
  hostZone: "America/New_York",
};

/** A deployment with everything set and a connected mailbox. */
async function wired(): Promise<ReturnType<typeof vi.fn>> {
  const packed = await encrypt("1//grant", KEY);
  const f = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("google_tokens")) return ok([{ email: "dave@example.com", token_enc: packed }]);
    if (u.includes("oauth2")) return ok({ access_token: "fresh" });
    if (u.includes("messages/send")) return ok({ id: "m-1" });
    return bad({}, 404);
  });
  vi.stubGlobal("fetch", f);
  return f;
}

/** The raw RFC822 message Gmail was handed, decoded back into text. */
function sentMessage(f: ReturnType<typeof vi.fn>): string {
  const call = f.mock.calls.find((c) => String(c[0]).includes("messages/send"))!;
  const { raw } = JSON.parse((call[1] as RequestInit).body as string) as { raw: string };
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://live.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc");
  vi.stubEnv("GOOGLE_TOKEN_KEY", KEY);
  vi.stubEnv("GOOGLE_CLIENT_ID", "web.apps");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("sendBookingReceipt", () => {
  it("sends the confirmation from the host's own mailbox", async () => {
    const f = await wired();
    expect(await sendBookingReceipt(JOB)).toBe(true);
    const msg = sentMessage(f);
    expect(msg).toContain("To: ada@example.com");
    expect(msg).toContain("Subject: Confirmed: Intro Call");
  });

  it("attaches a calendar file the visitor can add", async () => {
    const f = await wired();
    await sendBookingReceipt(JOB);
    const msg = sentMessage(f);
    expect(msg).toContain('filename="invite.ics"');
    expect(msg).toContain("text/calendar");
    const b64 = /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]+?)\r\n--/.exec(msg)![1]!;
    const ics = Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf8");
    expect(ics).toContain("DTSTART:20260922T180000Z");
    expect(ics).toContain("UID:b-9@jarvis.booking");
  });

  it("writes the time on the visitor's clock when they told us which one", async () => {
    const f = await wired();
    await sendBookingReceipt({ ...JOB, guestZone: "America/Los_Angeles" });
    const msg = sentMessage(f);
    expect(msg).toContain("11:00 AM to 11:30 AM");
    expect(msg).toContain("2:00 PM in America/New_York");
  });

  // A stranger's browser is not a trusted source, and a bad zone name makes
  // Intl throw. It has to fall back to the host's clock, not take the booking
  // down with it.
  it("falls back to the host's clock when the zone the visitor sent is nonsense", async () => {
    const f = await wired();
    expect(await sendBookingReceipt({ ...JOB, guestZone: "Mars/Olympus" })).toBe(true);
    expect(sentMessage(f)).toContain("2:00 PM to 2:30 PM");
  });

  it("is false, and sends nothing, when the host has no mailbox connected", async () => {
    const f = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", f);
    expect(await sendBookingReceipt(JOB)).toBe(false);
    expect(f.mock.calls.some((c) => String(c[0]).includes("messages/send"))).toBe(false);
  });

  it("is false when the server has no Google configuration at all", async () => {
    vi.stubEnv("GOOGLE_TOKEN_KEY", "");
    const f = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", f);
    expect(await sendBookingReceipt(JOB)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("is false, not an exception, when Gmail refuses the message", async () => {
    const packed = await encrypt("1//grant", KEY);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("google_tokens")) return ok([{ email: "dave@example.com", token_enc: packed }]);
      if (u.includes("oauth2")) return ok({ access_token: "fresh" });
      return bad({ error: { message: "insufficient scope" } }, 403);
    }));
    expect(await sendBookingReceipt(JOB)).toBe(false);
  });

  // The reason this file is allowed to read the live project at all.
  it("only ever reads the live project, and writes only to Gmail", async () => {
    const f = await wired();
    await sendBookingReceipt(JOB);
    for (const call of f.mock.calls) {
      const url = String(call[0]);
      const method = ((call[1] as RequestInit | undefined)?.method || "GET").toUpperCase();
      if (url.includes("live.test")) expect(method).toBe("GET");
    }
  });
});

describe("sendBookingCancellation", () => {
  it("tells the guest, with a calendar file that removes the event", async () => {
    const f = await wired();
    expect(await sendBookingCancellation(JOB)).toBe(true);
    const msg = sentMessage(f);
    expect(msg).toContain("To: ada@example.com");
    expect(msg).toContain("Subject: Cancelled: Intro Call");
    expect(msg).toContain('filename="cancelled.ics"');
    const b64 = /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]+?)\r\n--/.exec(msg)![1]!;
    const ics = Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf8");
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("UID:b-9@jarvis.booking");
  });

  it("passes the host's own line through to them", async () => {
    const f = await wired();
    await sendBookingCancellation({ ...JOB, reason: "Double booked myself" });
    expect(sentMessage(f)).toContain("Double booked myself");
  });

  // The meeting is already off in the database by the time this runs, so a
  // mail that cannot go must be reported rather than thrown.
  it("is false, not an exception, when there is no mailbox to send from", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([])));
    expect(await sendBookingCancellation(JOB)).toBe(false);
  });
});
