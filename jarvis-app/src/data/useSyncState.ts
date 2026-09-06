import { useEffect, useState } from "react";
import type { SyncState } from "@core";
import { useStore } from "./NotesProvider";
import { capAfterNumber } from "../shared/casing";

// UP-PLAT-05 (2026-09-06): "A sync line that tells the truth."
//
// Settings, Backup's Account Sync card said a hardcoded "On" whatever was
// actually happening (settings/BackupPage.tsx), and the Store's own
// queueLen() had been sitting there since S3-Q14 read by nothing but spec
// harnesses. So a person who watched a note vanish had exactly one place to
// look and it was a decoration.
//
// Pushed, not polled: the Store fires on every moment that changes the answer
// (going offline, reconnecting, a write landing, the queue growing or
// draining), and subscribe() fires once immediately, so there is never a
// frame of "unknown" to render.
export function useSyncState(): SyncState | null {
  const store = useStore();
  const [state, setState] = useState<SyncState | null>(() => store?.syncState() ?? null);

  useEffect(() => {
    if (!store) { setState(null); return; }
    return store.subscribe(setState);
  }, [store]);

  return state;
}

// "2 min ago". Minutes, then hours, then the date: a stamp older than a day
// is not a duration anybody reads in minutes. Under a minute is "just now"
// rather than "0 min ago", which reads as broken.
export function syncedAgo(at: number, now = Date.now()): string {
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return new Date(at).toLocaleDateString();
}

// The one sentence for the card and the eyebrow, so they can never disagree.
// Every branch is a fact: what is waiting, and when something last left the
// phone. Nothing here guesses, and nothing says "Synced" on the strength of
// having been online once.
export function syncLine(s: SyncState, now = Date.now()): string {
  const waiting = capAfterNumber(s.queued === 1 ? "1 change waiting" : `${s.queued} changes waiting`);
  const synced = s.lastSyncedAt === null ? null : `Last synced ${syncedAgo(s.lastSyncedAt, now)}`;
  if (!s.online) return s.queued > 0 ? `Offline · ${waiting}` : "Offline";
  if (s.queued > 0) return synced ? `${waiting} · ${synced}` : waiting;
  return synced ?? "Nothing waiting";
}
