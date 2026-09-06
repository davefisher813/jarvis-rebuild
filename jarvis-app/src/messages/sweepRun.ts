import type { GoogleApi } from "../connections/google/api";
import { fullThreadsFor } from "./sentBodies";
import { alreadyPromised } from "./commitments";
import { cleanBody } from "./bodyText";
import { displayName } from "./names";
import { needsSweep, saveSweep, sweepPrompt, parseSweep, SWEEP_SYSTEM, type SentItem } from "./sentSweep";
import { todayISO } from "../schedule/calendar";

// THE PROMISE SWEEP, HEADLESS (UP-MIND-13).
//
// The sweep lived inside MessagesFlow, which meant it ran only while the
// Email tab was mounted. The first thirty seconds of this app happen in
// onboarding, before that tab has ever existed, and the whole point of the
// connect screen is to show the user something real about their own mail
// immediately.
//
// So the pass moved here, unchanged in what it does: capped, cached against
// the newest sent message id so it costs nothing when nothing new has gone
// out, and refusing to invent. The Email tab calls this now instead of
// keeping its own copy, because two implementations of one AI pass is how
// they drift.
//
// Laws it keeps, all from sentSweep.ts:
//   - Only the user's OWN words.
//   - Only threads the commitment catcher has not already handled.
//   - An unreadable reply means no promises, never a guessed one.

export const SWEEP_CAP = 8;

export interface SweepRunDeps {
  apis: () => { email: string; api: GoogleApi }[];
  complete: (messages: { role: string; content: string }[], system: string) => Promise<string>;
  /** The Gmail search. The tab sweeps recent sent mail; the connect screen
   *  sweeps the last thirty days, which is the window its copy promises. */
  query?: string;
  /** Force the pass even when the head has not moved. The connect screen
   *  does: it has never swept this account and its cache is another
   *  device's, or empty. */
  force?: boolean;
}

/** Runs the pass and writes the cache. Returns how many promises it found,
 *  or null when it did not run at all (no accounts, nothing new). Never
 *  throws: a missed promise is silent, a wrong task is not. */
export async function runSentSweep(deps: SweepRunDeps): Promise<number | null> {
  try {
    const list = deps.apis();
    if (list.length === 0) return null;
    const items: SentItem[] = [];
    let head = "";
    for (const { api } of list) {
      // EMAIL-F-03: search hits are metadata with no bodies. sentBodies.ts
      // fetches the real threads, capped and bounded, so the model reads
      // what was written rather than eight subject lines.
      const metas = await api.searchThreads(deps.query ?? "in:sent -in:chats", SWEEP_CAP).catch(() => []);
      for (const full of await fullThreadsFor(api, metas)) {
        const last = full.messages[full.messages.length - 1];
        if (!last) continue;
        if (!head) head = last.id;
        if (alreadyPromised(full.id)) continue;
        items.push({
          threadId: full.id,
          to: displayName(last.to),
          subject: full.subject,
          body: cleanBody(last.body),
          msgId: last.id,
        });
      }
    }
    if (!deps.force && !needsSweep(head)) return null;
    if (items.length === 0) { saveSweep({ head, promises: [] }); return 0; }
    const raw = await deps.complete(
      [{ role: "user", content: sweepPrompt(items.slice(0, SWEEP_CAP), todayISO()) }],
      SWEEP_SYSTEM,
    );
    const promises = parseSweep(raw, items);
    saveSweep({ head, promises });
    return promises.length;
  } catch {
    return null;
  }
}
