import { clearPreload } from "../data/preloadCache";

// S3-Q17 (2026-09-04): "Clear Local Data destroys things with no other
// copy." The row's footnote reads "This device only, no undo," which is the
// truth for a corrupt cache -- and a lie for what localStorage.clear() also
// took with it: the outbox, a LIVE in-progress gym session (not just its
// pending-sync queue), the health offline queue, the budget envelopes, the
// learned-rules corrections in progress, the offline write queue the core
// Store now keeps (S3-Q14), and dozens of other real, one-of-a-kind user
// decisions. None of those have a second copy anywhere, and none of them
// are in the backup bundle.
//
// So this is an ALLOWLIST now, not a wipe: only keys confirmed to be a
// cache (recomputable from the Store, the AI, or a fresh network fetch), a
// preload, or a dismissal/seen/ask marker (whose only effect is whether a
// UI nudge reappears) are removed. Everything else -- including a key
// nobody has written yet -- is left alone by default. That asymmetry is
// deliberate: a cache this list forgets to clear is a minor inconvenience
// next time; a queue or a decision this list wrongly clears is the exact
// bug this item exists to close.
//
// Each entry names the file that actually owns the key, so that file stays
// the one place its meaning is defined -- this list only decides whether
// Clear Local Data is allowed to touch it. When adding a new localStorage
// key elsewhere in the app: it is protected by default and needs no edit
// here unless it is genuinely a cache, a preload, or a dismissal.
const SAFE_TO_CLEAR: readonly string[] = [
  // --- Backup (settings/BackupPage.tsx) ---
  "jarvis.backup.lastExport", // cosmetic "last exported" stamp; the file itself already left the device (S3-Q16)

  // --- Review / Brain (review/seal.ts, brain/nightly.ts) ---
  "jarvis.seal.done.v1", // fast-path marker; the real seal lives in the Store
  "jarvis.brain.nightly.v1", // today's proposal picks, a day cache

  // --- Search (search/SearchFlow.tsx) ---
  "jarvis.recent-searches", // recent search history, pure convenience

  // --- Shell (shell/chunkRecovery.ts) ---
  "jarvis.chunk.reloaded.v1", // technical, session-scoped stale-chunk reload guard

  // --- Schedule (schedule/overlapAck.ts, schedule/ScheduleFlow.tsx) ---
  "jarvis.overlap.kept.v1", // "UI quieting, not data" per its own comment
  "jarvis.attach.asked", // once-per-event ask marker

  // --- Weather (weather/weather.ts, weather/WeatherLine.tsx) ---
  "jarvis.location.v1", // geolocation cache
  "jarvis.weather.v1", // forecast cache
  "jarvis.weather.offer.v1", // "have we asked to use location" marker

  // --- Today (today/YourDay.tsx, today/goalPulse.ts, today/welcomeBack.ts, today/patterns.ts) ---
  "jarvis.today.ticker.v1", // cosmetic ticker-paused toggle
  "jarvis.goalnudge.dismissed.v1",
  "jarvis.lastseen.v1", // welcome-back marker
  "jarvis.pattern.dismissed",

  // --- Restore (restore/whereYouWere.ts) ---
  "jarvis.whereyouwere.v1", // a bookmark into real data that lives elsewhere
  "jarvis.whereyouwere.dismissed.v1",

  // --- Quick Capture (paste/captureLog.ts) ---
  "jarvis.captures.v1", // recent-captures display log; the real items it points at are saved elsewhere
  "jarvis.paste.dedupe.v1",

  // --- People (people/lastContact.ts) ---
  "jarvis.people.lastcontact.v1", // explicit day-cache, "never persisted server-side" by design

  // --- Tasks (bigger/related.ts, bigger/stalled.ts, tasks/momentum.ts, tasks/overwhelmed.ts, tasks/autoSweep.ts, tasks/lifecycle.ts) ---
  "jarvis.link.dismissed.v1",
  "jarvis.projstep.dismissed",
  "jarvis.firststep.dismissed",
  "jarvis.momentum.v1",
  "jarvis.overwhelmed.v1", // "hiding is a view, not a write" per its own comment
  "jarvis.sweep.last.v1",
  "jarvis.sweep.receipt.v1", // "receipt is display" per its own comment
  "jarvis.sweep.offered.v2",
  "jarvis.sweep.dismissed.v1",

  // --- Notifications (notifications/feed.ts) ---
  "jarvis.notifications.dismissed.v1",

  // --- AI (ai/pregen.ts) ---
  "jarvis.pregen.v1", // pre-generation cache, "a luxury, never an error" per its own comment

  // --- Events (connections/google/sync.ts, events/pipeline.ts) ---
  "jarvis.gcal.imported.v1", // cold-read guard; the real imported events live in the Store
  "jarvis.eventlog.imported.v1", // best-effort one-time import flag

  // --- Email (messages/*) ---
  "jarvis.mail.home.v1", // 36h snapshot, rebuilt on the next Email visit
  "jarvis.mail.home.dismissed.v1",
  "jarvis.mail.waiting.cache.v1",
  "jarvis.mail.voice.v1", // re-fetched from Gmail on demand
  "jarvis.mail.triage.v3", // re-triaged from the thread on its next open
  "jarvis.mail.brief.v1", // re-generated from the thread on its next open
  "jarvis.mail.tossasked.v1",
  "jarvis.mail.close.v1", // last-run marker for the weekly close offer
  "jarvis.mail.snooze.v1", // same-day, self-expiring notice state
];

export function clearLocalData(storage: Pick<Storage, "removeItem"> = localStorage): void {
  for (const key of SAFE_TO_CLEAR) {
    try { storage.removeItem(key); } catch { /* ignore */ }
  }
  // The preload cache is its own family (jarvis.preload.v1.<entityType>, one
  // key per type) with an existing sweep that already knows how to find all
  // of them; reuse it instead of re-deriving the prefix here.
  clearPreload();
}
