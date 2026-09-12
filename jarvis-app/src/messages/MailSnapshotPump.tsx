import { useEffect, useRef } from "react";
import { useGoogle } from "../connections/google/GoogleSession";
import { useAI } from "../ai/useAI";
import { useOptionalPeople } from "../data/NotesProvider";
import { refreshMailSnapshot } from "./snapshotRefresh";
import { loadMailSnapshot } from "./home";
import { loadWindows, peekLine, DEFAULT_WINDOWS } from "./batching";
import { buildMailDigests, inRefreshLead, REFRESH_LEAD_MIN } from "./mailDigest";
import { loadVips } from "./vip";
import { ensureMailDigests } from "../shared/notifications";

// How old the snapshot must be before this pump bothers rebuilding it --
// well inside the 36-hour display ceiling (home.ts's SNAPSHOT_MAX_AGE_MS),
// so a user who opens the app every few hours never sees the band go dark,
// without re-triaging the whole inbox on every single app open.
const REFRESH_STALE_MS = 4 * 3600e3;
// How often this checks, while mounted, whether the snapshot has gone stale
// since the last check. Cheap -- one localStorage read when nothing is due
// -- so a session left open for days still self-heals without a reload.
// 2026-09-11: 5 minutes, not 30. The pre-window look (inRefreshLead) is only
// REFRESH_LEAD_MIN (10) wide, so a half-hourly check landed in it for about
// one window in three and the rest fired off a stale snapshot.
const CHECK_INTERVAL_MS = 5 * 60e3;

// S6-Q34 (2026-09-04): "the email band only fills if you visit the Email
// tab." The home-page snapshot's only writer used to be MessagesFlow's own
// effect, which only runs while that tab is mounted. Mounted once in
// AppShell, inside GoogleSessionProvider, alongside GoogleAutoImport and
// TodayOutboxPump -- the same "outlives every screen" spot -- so the band
// fills whether or not the Email tab has ever been opened. Renders nothing.
export default function MailSnapshotPump() {
  const g = useGoogle();
  const ai = useAI();
  // UP-MIND-10 (2026-09-05): Contacts, so a waiting row and a needs-you
  // thread remember WHO they are about. Optional, same seam every other
  // enhancement in this app uses.
  const people = useOptionalPeople();
  const busy = useRef(false);

  // UP-MIND-14 (2026-09-05): the digest is scheduled from whatever the app
  // last actually read, so it is re-armed after every refresh and again on
  // the first check of a session. The line and the freshness both come from
  // the snapshot; nothing is invented and no count of unread appears.
  const arm = () => {
    const snap = loadMailSnapshot();
    const w = loadWindows();
    const rows = snap.threads.map((t) => ({ id: t.id, from: t.from, fromEmail: t.fromEmail, inInbox: true }));
    // 2026-09-11: every snapshot thread IS a Needs You thread, so say so, and
    // pass the VIPs like the Email tab's peek does. With neither, the digest
    // read "nothing urgent" about exactly the threads that needed him.
    const buckets = Object.fromEntries(snap.threads.map((t) => [t.id, { bucket: "needs_you" }]));
    void ensureMailDigests(buildMailDigests(
      w.windows.length ? w.windows : DEFAULT_WINDOWS.windows,
      peekLine(rows, buckets, loadVips()),
      snap.ts,
    ));
  };

  useEffect(() => {
    const check = () => {
      if (!g.hasToken || busy.current) return;
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const w = loadWindows();
      // UP-MIND-14: ten minutes before a window, look again whatever the
      // staleness clock says. The digest that fires at the window start is
      // supposed to be about this morning, not about breakfast yesterday.
      const age = Date.now() - loadMailSnapshot().ts;
      // 2026-09-11: once per lead, not on every 5-minute check inside it.
      const dueSoon = inRefreshLead(w.windows.length ? w.windows : DEFAULT_WINDOWS.windows, nowMin)
        && age >= REFRESH_LEAD_MIN * 60e3;
      if (!dueSoon && age < REFRESH_STALE_MS) { arm(); return; }
      busy.current = true;
      void refreshMailSnapshot({
        apis: () => g.apis("mail"),
        ai,
        ...(people ? { people: async () => (await people.list()).map((p) => ({ id: p.id, ...(p.data.email ? { email: p.data.email } : {}) })) } : {}),
      })
        .catch(() => { /* best effort: the next check retries */ })
        .finally(() => { busy.current = false; arm(); });
    };
    check();
    const t = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [g, ai, people]);

  return null;
}
