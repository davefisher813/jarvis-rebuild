import { useEffect, useRef } from "react";
import { useGoogle } from "../connections/google/GoogleSession";
import { useAI } from "../ai/useAI";
import { refreshMailSnapshot } from "./snapshotRefresh";
import { loadMailSnapshot } from "./home";

// How old the snapshot must be before this pump bothers rebuilding it --
// well inside the 36-hour display ceiling (home.ts's SNAPSHOT_MAX_AGE_MS),
// so a user who opens the app every few hours never sees the band go dark,
// without re-triaging the whole inbox on every single app open.
const REFRESH_STALE_MS = 4 * 3600e3;
// How often this checks, while mounted, whether the snapshot has gone stale
// since the last check. Cheap -- one localStorage read when nothing is due
// -- so a session left open for days still self-heals without a reload.
const CHECK_INTERVAL_MS = 30 * 60e3;

// S6-Q34 (2026-09-04): "the email band only fills if you visit the Email
// tab." The home-page snapshot's only writer used to be MessagesFlow's own
// effect, which only runs while that tab is mounted. Mounted once in
// AppShell, inside GoogleSessionProvider, alongside GoogleAutoImport and
// TodayOutboxPump -- the same "outlives every screen" spot -- so the band
// fills whether or not the Email tab has ever been opened. Renders nothing.
export default function MailSnapshotPump() {
  const g = useGoogle();
  const ai = useAI();
  const busy = useRef(false);

  useEffect(() => {
    const check = () => {
      if (!g.hasToken || busy.current) return;
      if (Date.now() - loadMailSnapshot().ts < REFRESH_STALE_MS) return;
      busy.current = true;
      void refreshMailSnapshot({ apis: () => g.apis("mail"), ai })
        .catch(() => { /* best effort: the next check retries */ })
        .finally(() => { busy.current = false; });
    };
    check();
    const t = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [g, ai]);

  return null;
}
