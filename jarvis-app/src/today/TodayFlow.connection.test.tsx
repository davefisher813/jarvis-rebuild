// @vitest-environment jsdom
// TODAY'S CONNECTION NOTICE WEARS THE EMAIL BANNER'S COLOUR (issue 107, X2; Dave 2026-10-12, "Banner color: AMBER"; Email Build Spec
// 2.8). The Email tab draws every open incident, a lost grant (auth) and an outage that has lasted (degraded), in amber. Today's
// notice for the SAME incident was amber for a lost grant and the neutral slate for a degraded one, and slate for every state with
// no incident yet (Temporarily Limited, Service Unavailable, Can't Read Mail, Mail Not Updating), so Today and Email disagreed about
// one problem. Now: an open incident is amber, whichever kind; a proven problem with no incident yet is amber; and only the two
// states where nothing is proven wrong (the phone has no connection, the last answer is too old to trust) stay the neutral slate.
//
// The REAL Today page, over the real services in an in-memory Store, with the proven status seeded where the status hook reads it
// first (its own stored answer), built by the real deriveStatus. The notice's tone is the colour of its disc (cat-bg-*).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { deriveStatus, STATUS_STALE_MS, type AccountStatus } from "../connections/connectionStatus";
import TodayFlow from "./TodayFlow";

const USER = "conn-user";
const ME = "dave@example.test";
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
// The status hook is keyed to the signed-in person; the real AuthProvider is not mounted, so the session is the one the hook reads.
vi.mock("../auth/AuthProvider", async (orig) => ({ ...(await orig<typeof import("../auth/AuthProvider")>()), useOptionalSession: () => ({ access_token: "tok", user: { id: "conn-user" } }) }));
// The legacy mail band is its own suite, and the Email flag is off here, so neither takes part.
vi.mock("./MailNotices", () => ({ default: () => null }));
vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false }) }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
// The whole Today page mounts in each case; a loaded machine (the full suite, several runs at once) needs more than 5 seconds.
vi.setConfig({ testTimeout: 30000 });

const realFetch = globalThis.fetch;
const proof = (refresh: Parameters<typeof deriveStatus>[0]["refresh"], read: Parameters<typeof deriveStatus>[0]["read"], o: Partial<AccountStatus> = {}, checkedAgoMs = 0): AccountStatus => {
  const now = new Date(Date.now() - checkedAgoMs);
  return { ...deriveStatus({ email: ME, refresh, read, lastSyncAt: now.toISOString(), now }), ...o };
};
const OK = { ok: true as const, scope: SCOPE };
const READ_OK = { ok: true, status: 200, emailAddress: ME };
const incident = (kind: "auth" | "degraded") => ({ id: kind === "auth" ? "JC-0A1B2C3D" : "JC-AAAA1111", kind, openedAt: new Date(Date.now() - 3600e3).toISOString(), cause: kind === "auth" ? null : "failures" });

interface Case { name: string; status: AccountStatus; offline?: boolean; title: string; tone: "orange" | "slate" }
const CASES: Case[] = [
  { name: "an open auth incident (a lost grant)", status: proof({ ok: false, error: "invalid_grant" }, null, { incident: incident("auth"), paused: { replies: 1, other: 0 } }), title: "Gmail Needs Reconnecting", tone: "orange" },
  { name: "an open degraded incident (an outage that has lasted)", status: proof({ thrown: true }, null, { incident: incident("degraded"), paused: { replies: 0, other: 0 } }), title: "Gmail Isn't Updating", tone: "orange" },
  { name: "a lost grant the server has not opened an incident for yet", status: proof({ ok: false, error: "invalid_grant" }, null, { incident: null }), title: "Gmail Needs Reconnecting", tone: "orange" },
  { name: "rate limiting, no incident", status: proof(OK, { ok: false, status: 429 }, { incident: null }), title: "Temporarily Limited", tone: "orange" },
  { name: "an outage, no incident", status: proof(OK, { ok: false, status: 503 }, { incident: null }), title: "Service Unavailable", tone: "orange" },
  { name: "Gmail refusing the check, no incident", status: proof(OK, { ok: false, status: 403 }, { incident: null }), title: "Can't Read Mail", tone: "orange" },
  { name: "a day without a sync, no incident", status: { ...proof(OK, READ_OK, { incident: null }), delivery: { kind: "poll", liveness: "stale" } }, title: "Mail Not Updating", tone: "orange" },
  { name: "the phone offline (nothing proven wrong)", status: proof(OK, READ_OK, { incident: null }), offline: true, title: "Offline", tone: "slate" },
  { name: "an answer too old to trust (nothing proven wrong)", status: proof(OK, READ_OK, { incident: null }, STATUS_STALE_MS + 5 * 60e3), title: "Status Unconfirmed", tone: "slate" },
];

function mountToday() {
  const store = new Store(new InMemoryAdapter());
  return render(
    <NotesProvider userId={USER} store={store}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} onGoConnections={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

/** The connection notice's row: the one whose words are the title, found by the words (a degraded title is not a state word). */
const noticeRow = (root: HTMLElement, title: string): HTMLElement | null =>
  ([...root.querySelectorAll(".conn-name, .vrow-fact")].find((n) => (n.textContent ?? "").trim() === title)?.closest(".row") as HTMLElement | null) ?? null;

describe("Today's connection notice is amber for a problem that can be mended (issue 107, X2)", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });

  it.each(CASES)("$name: $title, $tone", async (c) => {
    // Where the hook looks first, and what the status route answers if it is asked: the same proof.
    const answer = { checkedAt: c.status.checkedAt, accounts: [c.status] };
    localStorage.setItem("jarvis.connections.status.v1", JSON.stringify({ userId: USER, answer }));
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (String(url).includes("/api/connections/status")
      ? ({ ok: true, status: 200, json: async () => answer } as Response)
      : realFetch(url, init)));
    if (c.offline) Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { container } = mountToday();
    await waitFor(() => expect(noticeRow(container, c.title), `the notice titled ${c.title}`).not.toBeNull(), { timeout: 8000 });
    const row = noticeRow(container, c.title)!;
    const disc = row.querySelector(".notice-disc") as HTMLElement;
    expect(disc, "the notice's tone disc").toBeTruthy();
    expect(disc).toHaveClass("cat-bg-" + c.tone);
    // The other tone is not on it, and the notice is never red (laws: red is rationed).
    expect(disc).not.toHaveClass("cat-bg-" + (c.tone === "orange" ? "slate" : "orange"));
    expect(disc.className).not.toMatch(/cat-bg-(red|rose|coral|rust|pink)\b/);
  });
});
