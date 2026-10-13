// @vitest-environment jsdom
// TODAY'S CONNECTION PROBLEM IS THE ONE AMBER ROW (issue 107 X2, then issue 106 V2).
//
// X2 (Dave 2026-10-12, "Banner color: AMBER"; Email Build Spec 2.8): the Email tab draws every open incident, a lost grant (auth)
// and an outage that has lasted (degraded), in amber, and Today's notice for the SAME incident disagreed (slate for a degraded one
// and for every state with no incident yet), so Today and Email said two things about one problem. It was made amber, except for
// the two states where nothing is proven wrong (the phone has no connection, the last answer is too old to trust), which stayed a
// neutral slate disc.
//
// V2 (issue 106, approved by Dave 2026-10-13): "a recoverable problem on Today is ONE slim amber row below the greeting,
// actionable, and it disappears when resolved. Not a large red card at the top." The connection is no longer a ranked notice with
// a tone disc. It is the problem row (the Email strip, whole: one amber, --warn-fill, and no tone of its own), directly under the
// greeting. A strip has no neutral, so the two slate states are this row too, in the key's amber, as the Email tab's own status
// sheet already draws them (amber facts). So what is held here is no longer a disc's tone but the row: that every state is the
// one strip, with the Email banner's words, the verb only where Reconnect can help, a door to Connections, and no card for it
// in the stream.
//
// The REAL Today page, over the real services in an in-memory Store, with the proven status seeded where the status hook reads it
// first (its own stored answer), built by the real deriveStatus.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { deriveStatus, STATUS_STALE_MS, type AccountStatus } from "../connections/connectionStatus";
import { TasksService } from "../tasks/TasksService";
import { addDays, todayISO } from "../schedule/calendar";
import TodayFlow from "./TodayFlow";

const USER = "conn-user";
const ME = "dave@example.test";
const OTHER = "other@example.test";
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
const incident = (kind: "auth" | "degraded", id = kind === "auth" ? "JC-0A1B2C3D" : "JC-AAAA1111") => ({ id, kind, openedAt: new Date(Date.now() - 3600e3).toISOString(), cause: kind === "auth" ? null : "failures" });

// `words` are the row's parts in order; `reconnect` is whether the verb is offered (only for a confirmed loss of the grant).
interface Case { name: string; status: AccountStatus; offline?: boolean; words: string[]; reconnect: boolean }
const CASES: Case[] = [
  { name: "an open auth incident (a lost grant)", status: proof({ ok: false, error: "invalid_grant" }, null, { incident: incident("auth"), paused: { replies: 1, other: 0 } }), words: ["Gmail Needs Reconnecting", ME], reconnect: true },
  { name: "an open degraded incident (an outage that has lasted)", status: proof({ thrown: true }, null, { incident: incident("degraded"), paused: { replies: 0, other: 0 } }), words: ["Gmail Isn't Updating", ME], reconnect: false },
  { name: "a lost grant the server has not opened an incident for yet", status: proof({ ok: false, error: "invalid_grant" }, null, { incident: null }), words: ["Gmail Needs Reconnecting", ME], reconnect: true },
  { name: "rate limiting, no incident", status: proof(OK, { ok: false, status: 429 }, { incident: null }), words: ["Temporarily Limited", ME], reconnect: false },
  { name: "an outage, no incident", status: proof(OK, { ok: false, status: 503 }, { incident: null }), words: ["Service Unavailable", ME], reconnect: false },
  { name: "Gmail refusing the check, no incident", status: proof(OK, { ok: false, status: 403 }, { incident: null }), words: ["Can't Read Mail", ME], reconnect: false },
  { name: "a day without a sync, no incident", status: { ...proof(OK, READ_OK, { incident: null }), delivery: { kind: "poll", liveness: "stale" } }, words: ["Mail Not Updating", ME], reconnect: false },
  // The two states X2 kept neutral. One word for offline (the date line already says so, and the Email status sheet says only that).
  { name: "the phone offline (nothing proven wrong)", status: proof(OK, READ_OK, { incident: null }), offline: true, words: ["Offline"], reconnect: false },
  { name: "an answer too old to trust (nothing proven wrong)", status: proof(OK, READ_OK, { incident: null }, STATUS_STALE_MS + 5 * 60e3), words: ["Status Unconfirmed", ME], reconnect: false },
];

const seedStatus = (accounts: AccountStatus[]) => {
  const answer = { checkedAt: accounts[0]!.checkedAt, accounts };
  localStorage.setItem("jarvis.connections.status.v1", JSON.stringify({ userId: USER, answer }));
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (String(url).includes("/api/connections/status")
    ? ({ ok: true, status: 200, json: async () => answer } as Response)
    : realFetch(url, init)));
};

function mountToday(opts: { onGoConnections?: () => void; store?: Store } = {}) {
  const store = opts.store ?? new Store(new InMemoryAdapter());
  return render(
    <NotesProvider userId={USER} store={store}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} onGoConnections={opts.onGoConnections ?? (() => {})} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

const stripOf = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>(".conn-strip-today[data-problem='connection']");
const partsOf = (strip: HTMLElement): string[] => [...strip.querySelectorAll(".conn-strip-part")].map((p) => p.textContent ?? "");

describe("Today's connection problem is the one amber row (issues 107 X2 and 106 V2)", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });

  it.each(CASES)("$name: one strip, the Email banner's words, the verb only where Reconnect helps", async (c) => {
    // Where the hook looks first, and what the status route answers if it is asked: the same proof.
    seedStatus([c.status]);
    if (c.offline) Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const go = vi.fn();
    const { container } = mountToday({ onGoConnections: go });
    await waitFor(() => expect(stripOf(container), `the row for ${c.words[0]}`).not.toBeNull(), { timeout: 8000 });
    const strip = stripOf(container)!;
    expect(partsOf(strip)).toEqual(c.words);
    expect(strip).toHaveAttribute("role", "alert");
    // ONE row, the Email strip's own amber: no tone, no disc, no notice, and never red.
    expect(container.querySelectorAll(".conn-strip")).toHaveLength(1);
    expect(strip.innerHTML).not.toMatch(/cat-(bg|fg)-|notice-disc|--sys-red/);
    // And not a card in the stream for the same words.
    expect(container.querySelector(".heads-up-stream")?.textContent ?? "").not.toContain(c.words[0]!);
    expect(container.querySelector(".notice-disc.cat-bg-slate, .notice-disc.cat-bg-orange")).toBeNull();
    // Under the greeting, above Your Move.
    const hero = container.querySelector(".today-hero")!;
    expect(hero.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const stream = container.querySelector(".heads-up-stream");
    if (stream) expect(strip.compareDocumentPosition(stream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The verb: Reconnect only for a confirmed loss; its door, like the words', is Connections.
    const verbs = within(strip).queryAllByRole("button", { name: "Reconnect" });
    expect(verbs).toHaveLength(c.reconnect ? 1 : 0);
    if (c.reconnect) { fireEvent.click(verbs[0]!); await waitFor(() => expect(go).toHaveBeenCalledTimes(1)); }
    // The words take you to Connections too (the whole row is a door).
    fireEvent.click(within(strip).getByRole("button", { name: new RegExp(c.words[0]!) }));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(c.reconnect ? 2 : 1));
  });

  it("a healthy connection draws no row", async () => {
    seedStatus([proof(OK, READ_OK, { incident: null })]);
    const { container } = mountToday();
    await waitFor(() => expect(container.querySelector(".today-hero")).not.toBeNull(), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(container.querySelector(".conn-strip")).toBeNull();
  });

  it("two accounts with an open incident are still ONE row: the first is drawn, the other is counted", async () => {
    seedStatus([
      proof({ ok: false, error: "invalid_grant" }, null, { incident: incident("auth") }),
      proof({ thrown: true }, null, { email: OTHER, incident: incident("degraded") }),
    ]);
    const { container } = mountToday();
    await waitFor(() => expect(stripOf(container)).not.toBeNull(), { timeout: 8000 });
    expect(container.querySelectorAll(".conn-strip")).toHaveLength(1);
    expect(partsOf(stripOf(container)!)).toEqual(["Gmail Needs Reconnecting", ME, "1 More"]);
    // The dot between the three is the stylesheet's, never in the words.
    expect(stripOf(container)!.textContent).not.toContain("·");
  });

  // V4, the alert discipline: the weather offer waits while TWO alerts are up. The connection and the failed sweep were notices that
  // counted toward it, and they are one row now, so the count has to be kept by the flow or the offer would start to show where it
  // was held back. (The connection is one alert however many accounts are open: it was one notice.)
  it("the weather offer shows beside one problem, and waits when there are two (the row still counts both)", async () => {
    seedStatus([proof({ ok: false, error: "invalid_grant" }, null, { incident: incident("auth") })]);
    const one = mountToday();
    await waitFor(() => expect(stripOf(one.container)).not.toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(one.container.textContent).toContain("Add Daily Weather"), { timeout: 8000 });
    cleanup();
    localStorage.clear();

    const store = new Store(new InMemoryAdapter());
    const today = todayISO();
    const svc = new TasksService(store, USER);
    const stuck = (await svc.createTask("Call the Plumber", { due: addDays(today, -1) }))!;
    localStorage.setItem("jarvis.sweep.last.v1", today);
    localStorage.setItem("jarvis.sweep.receipt.v1", JSON.stringify({ date: today, moved: [], failed: true, failedIds: [stuck] }));
    seedStatus([proof({ ok: false, error: "invalid_grant" }, null, { incident: incident("auth") })]);
    const two = mountToday({ store });
    await waitFor(() => expect(partsOf(stripOf(two.container)!)).toContain("1 More"), { timeout: 8000 });
    // Settled: the page has drawn its stream, and the offer is not in it.
    await waitFor(() => expect(two.container.querySelector(".heads-up-stream")).not.toBeNull(), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(two.container.textContent).not.toContain("Add Daily Weather");
  });

  it("an incident and a failed sweep are still ONE row: the connection leads and the sweep is counted", async () => {
    const store = new Store(new InMemoryAdapter());
    const today = todayISO();
    const svc = new TasksService(store, USER);
    const stuck = (await svc.createTask("Call the Plumber", { due: addDays(today, -1) }))!;
    localStorage.setItem("jarvis.sweep.last.v1", today);
    localStorage.setItem("jarvis.sweep.receipt.v1", JSON.stringify({ date: today, moved: [], failed: true, failedIds: [stuck] }));
    seedStatus([proof({ ok: false, error: "invalid_grant" }, null, { incident: incident("auth") })]);
    const { container } = mountToday({ store });
    await waitFor(() => expect(stripOf(container)).not.toBeNull(), { timeout: 8000 });
    expect(container.querySelectorAll(".conn-strip")).toHaveLength(1);
    expect(partsOf(stripOf(container)!)).toEqual(["Gmail Needs Reconnecting", ME, "1 More"]);
    expect(container.textContent).not.toContain("Couldn't Move Yesterday's Tasks");
  });
});
