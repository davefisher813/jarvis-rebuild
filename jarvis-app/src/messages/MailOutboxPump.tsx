import { useEffect, useMemo, useState } from "react";
import { useGoogle } from "../connections/google/GoogleSession";
import type { AIService } from "../ai/AIService";
import { useOptionalProfile, useOptionalTasks } from "../data/NotesProvider";
import { useOptionalSession } from "../auth/AuthProvider";
import { pumpOutbox, type SendDeps } from "./sendPump";

// EMAIL-F-01 (2026-09-05): the always-alive timer behind the Email tab's
// own outbox (Send, Schedule Send, and the Sweep's Send & Next). Mounted once
// in AppShell, inside GoogleSessionProvider, beside TodayOutboxPump and
// MailSnapshotPump -- the same "outlives every screen" spot -- so a held or
// scheduled send leaves on time whether or not the Email tab is on screen.
// The work is sendPump.ts; this is the api lookup, the live settings, and
// the one-second tick around it. Renders nothing.
export default function MailOutboxPump({ ai }: { ai: AIService }) {
  const g = useGoogle();
  const tasks = useOptionalTasks();
  const profileSvc = useOptionalProfile();
  const session = useOptionalSession();
  // Open tracking is a setting (2026-08-09), read the same way MessagesFlow
  // reads it: missing provider or profile means the default (on).
  const [trackOpens, setTrackOpens] = useState(true);
  useEffect(() => {
    let on = true;
    profileSvc?.get().then((p) => { if (on) setTrackOpens(p?.trackOpens !== false); }).catch(() => {});
    return () => { on = false; };
  }, [profileSvc]);

  const deps = useMemo<SendDeps>(() => ({
    apiFor: (account?: string) => (account ? g.api(account) : null) ?? g.api(),
    ai,
    tasks,
    trackOpens,
    authToken: session?.access_token,
  }), [g, ai, tasks, trackOpens, session]);

  useEffect(() => {
    const t = setInterval(() => pumpOutbox(Date.now(), deps), 1000);
    return () => clearInterval(t);
  }, [deps]);

  return null;
}
