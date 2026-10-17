// NOTHING TYPED IS LOST (the Logging Standard, rule 8, 2026-10-17: "Drafts
// persist per keystroke; a killed app, a dead battery, or airplane mode
// loses nothing"). The two places a workout holds unsaved typing are the Now
// card's fields (a weight changed but not yet logged) and the receipt's
// note. Both ride shared/draftStore, written on every keystroke, read back
// on remount, and spent by the log or the save that used them. Never written
// on blur or dismiss: those are not saves.
//
// Keyed per session (its startedAt, the one stamp a live session carries from
// its first second) and, for the Now card, per exercise, so a half-typed
// Bench number never lands on Squat's card. clearLive sweeps every key on
// the way out of a session, whichever door it leaves by.

import { draftStore, type DraftStore } from "../shared/draftStore";
import type { SetDraft } from "./nextSet";

const NOW_KEY = "jarvis.gym.now.draft.v1";
const RECEIPT_KEY = "jarvis.gym.receipt.draft.v1";

/** The Now card's draft for one exercise in one session. */
export function nowDraftStore(sessionStartedAt: number, exerciseId: string): DraftStore {
  return draftStore(`${NOW_KEY}:${sessionStartedAt}:${exerciseId}`);
}

/** What was typed, or null when nothing was (or the stored shape is not one
 *  this build wrote; a draft is advisory and a bad one is dropped). */
export function readNowDraft(store: DraftStore): SetDraft | null {
  const raw = store.read();
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as unknown;
    if (!d || typeof d !== "object" || typeof (d as SetDraft).w !== "string" || typeof (d as SetDraft).r !== "string") return null;
    return d as SetDraft;
  } catch { return null; }
}

export function writeNowDraft(store: DraftStore, draft: SetDraft | null): void {
  if (draft) store.write(JSON.stringify(draft)); else store.clear();
}

/** The receipt's note for one session. */
export function receiptDraftStore(sessionStartedAt: number): DraftStore {
  return draftStore(`${RECEIPT_KEY}:${sessionStartedAt}`);
}

/** Every gym draft, whichever session or exercise wrote it. Only one session
 *  is ever live, so a finished or cancelled one leaves nothing behind. */
export function clearSessionDrafts(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const gone: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(NOW_KEY + ":") || k.startsWith(RECEIPT_KEY + ":"))) gone.push(k);
    }
    for (const k of gone) localStorage.removeItem(k);
  } catch { /* private mode: there was nothing stored to clear */ }
}
