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

/** One fact on the sync line, and the Colour Key variant it is drawn in:
 *  "warn" for what is held and waiting on the person (§AM amber), "date" for
 *  the neutral time something last left the phone (F5 small caps). A fact
 *  with neither is the line's one grey. */
export type SyncFact = { text: string; tone?: "warn" | "date" };

// The facts for the Account Sync row, in order. Every branch is a fact: what
// is waiting, and when something last left the phone. Nothing here guesses,
// and nothing says "Synced" on the strength of having been online once.
//
// §AM F3 (2026-09-26): this was one string with a middle dot typed into it,
// so both facts drew in one grey. They are separate facts now; the page
// renders each as a .fact and the stylesheet draws the separator.
export function syncFacts(s: SyncState, now = Date.now()): SyncFact[] {
  const waiting: SyncFact = { text: capAfterNumber(s.queued === 1 ? "1 change waiting" : `${s.queued} changes waiting`), tone: "warn" };
  const synced: SyncFact | null = s.lastSyncedAt === null ? null : { text: `Last synced ${syncedAgo(s.lastSyncedAt, now)}`, tone: "date" };
  if (!s.online) return s.queued > 0 ? [{ text: "Offline" }, waiting] : [{ text: "Offline" }];
  if (s.queued > 0) return synced ? [waiting, synced] : [waiting];
  return [synced ?? { text: "Nothing waiting" }];
}
