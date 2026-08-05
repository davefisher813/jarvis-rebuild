import { apiUrl } from "../shared/apiBase";

// Open tracking, client side (email 3). Each tracked send gets an unguessable
// uuid; the uuid-to-thread mapping lives ONLY on this device (localStorage).
// The server table knows the uuid and the open time, nothing else, it cannot
// say who was emailed or about what.
//
// Honesty rule for every surface that reads this: "Opened" is shown only on a
// real pixel hit. The absence of a hit is shown as nothing (or "no reply
// yet"), NEVER "not opened": image-blocking clients read mail invisibly, and
// privacy proxies sometimes preload pixels early. The signal is one-sided.

const KEY = "jarvis.mail.tracks.v1";
const CAP = 100;

export interface TrackRecord { threadId: string; sentAt: number }
type TrackStore = Record<string, TrackRecord>; // trackId -> record

export function loadTracks(storage: Pick<Storage, "getItem"> = localStorage): TrackStore {
  try {
    const raw = storage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: TrackStore = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const r = v as { threadId?: unknown; sentAt?: unknown };
      if (typeof r?.threadId === "string" && typeof r?.sentAt === "number") out[k] = { threadId: r.threadId, sentAt: r.sentAt };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveTrack(
  trackId: string,
  rec: TrackRecord,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  try {
    const store = loadTracks(storage);
    store[trackId] = rec;
    const keys = Object.keys(store);
    if (keys.length > CAP) {
      const oldestFirst = keys.sort((a, b) => store[a]!.sentAt - store[b]!.sentAt);
      for (const k of oldestFirst.slice(0, keys.length - CAP)) delete store[k];
    }
    storage.setItem(KEY, JSON.stringify(store));
  } catch { /* tracking is optional, sending is not */ }
}

// trackId for the latest tracked send in a thread (a nudge re-tracks it).
export function trackForThread(threadId: string, store: TrackStore): string | null {
  let best: string | null = null;
  let bestTs = -1;
  for (const [id, r] of Object.entries(store)) {
    if (r.threadId === threadId && r.sentAt > bestTs) { best = id; bestTs = r.sentAt; }
  }
  return best;
}

export function newTrackId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // No crypto (old jsdom): random uuid-shaped fallback, still unguessable enough for a pixel.
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  }
}

export function pixelUrlFor(trackId: string): string {
  // The pixel must be an ABSOLUTE url: it renders inside the recipient's mail
  // client, where a relative path points nowhere.
  const base = apiUrl("/api/open");
  const absolute = base.startsWith("http") ? base : (typeof location !== "undefined" ? location.origin : "") + base;
  return absolute + "?t=" + trackId;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function registerTrack(trackId: string, token: string | undefined, doFetch: FetchLike = fetch): Promise<void> {
  if (!token) return;
  try {
    await doFetch(apiUrl("/api/open"), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ t: trackId }),
    });
  } catch { /* the send already succeeded; tracking silently degrades */ }
}

export async function checkOpens(
  trackIds: string[],
  token: string | undefined,
  doFetch: FetchLike = fetch,
): Promise<Record<string, string>> {
  if (!token || trackIds.length === 0) return {};
  try {
    const r = await doFetch(apiUrl("/api/open"), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ check: trackIds.slice(0, 50) }),
    });
    if (!r.ok) return {};
    const j = (await r.json()) as { opens?: Record<string, string> };
    return j.opens || {};
  } catch {
    return {};
  }
}
