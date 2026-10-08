// THE REBUILT RECONNECT TAP (Foundation Fix Spec 4): what the Email banner does when Dave taps Reconnect.
//
// One tap opens Google for the exact account (the broker has the server mint the attempt first). When the server has proved
// everything it came back with, the status is re-read, the mailbox catches up from its last committed checkpoint, and the status
// is read again, so the banner says "Access Restored" the moment it is true and "Mail Up to Date" only after the catch-up has
// actually finished. This hook owns the three ways it can end without that:
//   * the window was closed         silent: no alarm, no error line
//   * Google refused                the provider's reason, said as it gave it
//   * the server's checks failed    the wrong account, no way to renew, no mail permission, could not read the mailbox
// and the one way it can be interrupted: the app was killed while Google had it. On the next launch it asks the SERVER what
// became of the attempt and says so honestly. It never reopens Google by itself, so there is never a duplicate flow, and it
// never shows green on its own say-so.

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../shared/apiBase";
import { openExternal } from "../messages/openExternal";
import {
  GOOGLE_PERMISSIONS_URL, PENDING_KEY, ReconnectCancelled, ReconnectDenied, ReconnectOutcomeError, clearPending, copyFor, interruptedCopy, providerReason, readPending,
  type AttemptStatus, type OutcomeCopy,
} from "../connections/google/reconnect";

export interface Outcome { email: string; status: AttemptStatus | "interrupted" | "failed"; copy: OutcomeCopy }
export type OutcomeAction = "finish" | "not_now" | "retry" | "permissions";

export interface ReconnectDeps {
  token: string | null | undefined;
  /** The Google session's reconnect, or null when this build has none (the button then goes to Connections). */
  reconnect: ((email: string) => Promise<unknown>) | null;
  /** The accounts this screen knows, so a leftover note about an account that is gone is dropped. */
  knownEmails: string[];
  /** Re-read the proven status now. */
  refreshStatus: (force?: boolean) => Promise<void>;
  /** Catch the mailbox up from where it stopped. Resolves when it has finished (or failed: the status says which). */
  catchUp: () => Promise<void>;
  /** Where the old button went, for a build with no Google session. */
  fallback: () => void;
}

export function useReconnect(d: ReconnectDeps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(false);
  const tries = useRef<Record<string, number>>({});
  const live = useRef(d);
  live.current = d;

  const restore = useCallback(async () => {
    // Access is back: say so now, catch up, then say again with what the catch-up found.
    await live.current.refreshStatus(true);
    await live.current.catchUp();
    await live.current.refreshStatus(true);
  }, []);

  const start = useCallback(async (email: string) => {
    const { reconnect, fallback } = live.current;
    if (!reconnect) { fallback(); return; }
    setOutcome(null);
    setBusy(email);
    try {
      await reconnect(email);
      tries.current[email] = 0;
      await restore();
    } catch (e) {
      if (e instanceof ReconnectCancelled) return; // the window was closed: silent, by design
      if (e instanceof ReconnectDenied) {
        setOutcome({ email, status: "denied", copy: copyFor("denied", { intended: email, reason: providerReason(e.reason) })! });
      } else if (e instanceof ReconnectOutcomeError) {
        if (e.status === "needs_step") tries.current[email] = (tries.current[email] ?? 0) + 1;
        const copy = copyFor(e.status, { intended: e.intended || email, ...(e.selected ? { selected: e.selected } : {}), again: (tries.current[email] ?? 0) >= 2 });
        if (copy) setOutcome({ email, status: e.status, copy });
      } else {
        setOutcome({ email, status: "failed", copy: { title: "Couldn't Reconnect", lines: [e instanceof Error && e.message ? e.message : "Try again."], actions: ["retry", "not_now"] } });
      }
      // The server decided: whatever it decided, what the screen says about the account is re-read, never assumed.
      void live.current.refreshStatus(true);
    } finally {
      setBusy(null);
    }
  }, [restore]);

  const act = useCallback((a: OutcomeAction) => {
    const o = outcome;
    if (a === "not_now") { setOutcome(null); return; }
    if (a === "permissions") { openExternal(GOOGLE_PERMISSIONS_URL); return; }
    if (o) void start(o.email);
  }, [outcome, start]);

  // A KILLED APP, ON REOPEN. The device remembers that it left for Google; the server remembers what became of the attempt.
  const asked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (asked.current || !d.token) return;
    const p = readPending();
    if (!p) return;
    if (d.knownEmails.length > 0 && !d.knownEmails.map((e) => e.toLowerCase()).includes(p.email)) { clearPending(); return; }
    asked.current = true;
    setChecking(true);
    (async () => {
      let status: AttemptStatus | "none" = "none";
      try {
        const r = await fetch(apiUrl("/api/google"), { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + d.token }, body: JSON.stringify({ reconnectStatus: p.email }) });
        if (r.ok) status = ((await r.json()) as { status?: AttemptStatus }).status ?? "none";
      } catch { /* offline: nothing is known, which is said as such below */ }
      if (!mounted.current) return;
      clearPending();
      setChecking(false);
      if (status === "verified") { await restore(); return; }
      const copy = status === "none" || status === "started" || status === "cancelled" || status === "superseded" ? interruptedCopy() : copyFor(status, { intended: p.email }) ?? interruptedCopy();
      setOutcome({ email: p.email, status: "interrupted", copy });
      await live.current.refreshStatus(true);
    })();
  }, [d.token, d.knownEmails, restore]);

  return { busy, outcome, checking, start, act };
}

export { PENDING_KEY };
