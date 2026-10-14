// THE APP'S ONE READ OF A CONNECTION'S STATUS (Foundation Fix Spec 1).
//
// Connections, the Email header and the Today band all read this and nothing
// else. It asks api/connections/status.ts, keeps the last answer so an offline
// device can say "here is the last status I knew" instead of inventing a fresh
// one, and hands every surface the SAME judgment (viewOf) computed against
// this device's clock: a frozen "healthy" answer cannot mask staleness.
//
// The answer holds machine codes and timestamps, never a token or mail, so
// keeping it on the device is the same as keeping any other cache. It is
// stored with the user it belongs to and ignored for anyone else.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../shared/apiBase";
import { STATUS_PATH, viewOf, type AccountStatus, type ClientView, type StatusResponse } from "./connectionStatus";

const KEY = "jarvis.connections.status.v1";
/** How often an open surface re-asks. Well inside the fifteen minutes a revoked grant must show within. */
export const POLL_MS = 5 * 60e3;

interface Stored { userId: string; answer: StatusResponse }

function readStored(userId: string | null): StatusResponse | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return s.userId === userId && Array.isArray(s.answer?.accounts) ? s.answer : null;
  } catch {
    return null;
  }
}

function writeStored(userId: string, answer: StatusResponse): void {
  try { localStorage.setItem(KEY, JSON.stringify({ userId, answer } satisfies Stored)); } catch { /* private mode: it lives in memory only */ }
}

/** How long one ask may take. A phone that was asleep can hand back a socket that never answers; without a deadline the ask never ends,
 *  the one-at-a-time guard never lets go, and the last answer ages into "Status Unconfirmed" for the rest of the day. */
export const ASK_DEADLINE_MS = 15_000;

/** THE ANSWER, ON THIS DEVICE'S CLOCK (the root of the false amber banner, Dave 2026-10-13). The server stamps each proof with ITS clock, and
 *  every age was then judged against this phone's. A phone a few minutes fast read a fresh proof as old; one that came back from sleep
 *  judged a proof by how long ago the SERVER made it. The ages that matter are how long ago this device last HEARD, plus how old the proof
 *  already was when it was sent (the gap between the answer's own time and the proof's, both the server's clock, so skew cancels). The
 *  answer is rewritten once, when it arrives, so every consumer (the views, the incident ledger) reads one skew-free clock. */
export function onDeviceClock(j: StatusResponse, receivedAt: number): StatusResponse {
  const top = Date.parse(j.checkedAt);
  if (!Number.isFinite(top)) return { ...j, checkedAt: new Date(receivedAt).toISOString() };
  return {
    checkedAt: new Date(receivedAt).toISOString(),
    accounts: j.accounts.map((a) => {
      const proved = Date.parse(a.checkedAt);
      const gap = Number.isFinite(proved) ? Math.max(0, top - proved) : 0;
      return { ...a, checkedAt: new Date(receivedAt - gap).toISOString() };
    }),
  };
}

async function fetchStatus(token: string, force: boolean, doFetch: typeof fetch): Promise<StatusResponse | null> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ASK_DEADLINE_MS) : null;
  try {
    const r = await doFetch(apiUrl(STATUS_PATH + (force ? "?refresh=1" : "")), { headers: { Authorization: "Bearer " + token }, ...(ctl ? { signal: ctl.signal } : {}) });
    if (!r.ok) return null;
    const j = (await r.json()) as StatusResponse;
    return Array.isArray(j?.accounts) && typeof j.checkedAt === "string" ? onDeviceClock(j, Date.now()) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ConnectionStatus {
  /** The last answer this device has, or null when it has never had one. */
  answer: StatusResponse | null;
  /** Each account judged by this device's clock, keyed by lowercase address. */
  views: Map<string, ClientView>;
  /** Any account that is PROVEN not plainly connected, worst first; null when all are, or when all that is left is "not heard lately". An answer too old to
   *  trust is the absence of proof, never proof of a problem, so it is never what a banner is drawn from (it is `unconfirmed`, for the quiet surfaces). */
  worst: { account: AccountStatus; view: ClientView } | null;
  /** True when a confirmed auth loss on any account means Reconnect is the right offer. */
  needsReconnect: boolean;
  /** Some account's last answer is too old to say anything. Not a problem with the account; a surface may say it quietly, never as a banner. */
  unconfirmed: boolean;
  online: boolean;
  refresh: (force?: boolean) => Promise<void>;
}

const SEVERITY: Record<ClientView["state"], number> = { pending_auth: 5, error: 4, warning: 3, stale: 2, offline: 1, connected: 0 };

/** The states a loud surface (the Today row, the Email headline) may be drawn from: a proven problem, or the phone being offline. */
const BANNERABLE = (s: ClientView["state"]) => s !== "connected" && s !== "stale";

/** Pure: the views and the worst of them, so a test needs no hook. */
export function summarize(answer: StatusResponse | null, now: Date, online: boolean): Pick<ConnectionStatus, "views" | "worst" | "needsReconnect" | "unconfirmed"> {
  const views = new Map<string, ClientView>();
  let worst: ConnectionStatus["worst"] = null;
  for (const a of answer?.accounts ?? []) {
    const v = viewOf(a, now, online);
    views.set(a.email.toLowerCase(), v);
    if (BANNERABLE(v.state) && (!worst || SEVERITY[v.state] > SEVERITY[worst.view.state])) worst = { account: a, view: v };
  }
  return { views, worst, needsReconnect: [...views.values()].some((v) => v.offerReconnect), unconfirmed: [...views.values()].some((v) => v.state === "stale") };
}

export function useConnectionStatus(token: string | null | undefined, userId: string | null | undefined, doFetch: typeof fetch = fetch): ConnectionStatus {
  const uid = userId ?? null;
  const [answer, setAnswer] = useState<StatusResponse | null>(() => readStored(uid));
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const [now, setNow] = useState<Date>(() => new Date());
  const busy = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (!token || !uid || busy.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setOnline(false); return; }
    busy.current = true;
    try {
      const got = await fetchStatus(token, force, doFetch);
      if (got) { setAnswer(got); writeStored(uid, got); }
    } finally {
      busy.current = false;
      setNow(new Date());
    }
  }, [token, uid, doFetch]);

  useEffect(() => { setAnswer(readStored(uid)); }, [uid]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    // The judgment is re-made on this clock even when nothing new arrived.
    const tick = setInterval(() => setNow(new Date()), 60e3);
    const goOnline = () => { setOnline(true); void refresh(true); };
    const goOffline = () => setOnline(false);
    // COMING BACK IS A FRESH ASK, AND THE JUDGMENT IS RE-MADE AT ONCE. A phone that slept froze every timer above, so the last answer is as old as
    // the sleep; the moment the app is in front again it asks (forced, so it proves rather than repeats) and re-reads the clock, instead of showing
    // the old answer's age until the next tick. iOS home-screen apps do not always raise visibilitychange on resume, so pageshow and focus ask too.
    const back = () => { if (document.visibilityState === "visible") { setNow(new Date()); void refresh(true); } };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("pageshow", back);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(poll); clearInterval(tick);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("pageshow", back);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [refresh]);

  const summary = useMemo(() => summarize(answer, now, online), [answer, now, online]);
  return { answer, online, refresh, ...summary };
}

