import { useEffect, useRef } from "react";
import { useGoogle } from "../connections/google/GoogleSession";
import { useOptionalProfile, useOptionalRoutine, useOptionalBrainDocs } from "../data/NotesProvider";
import { emit } from "../events";
import { runAutoReplyPass } from "./autoReplyPump";
import { autoReplyEnabled } from "./autoReply";

// How often a pass runs. Two minutes is prompt enough for a courtesy (the
// point is that the VIP hears back while he is heads down, not instantly)
// and cheap: the routine read is local, and the inbox is only read at all
// once the switch is on AND a focus block is actually running.
export const AUTO_REPLY_TICK_MS = 2 * 60e3;

// EMAIL-F-16 (2026-09-05): "Heads-Down Auto-Reply only runs while the Email
// tab is open, on threads already loaded." Mounted once in AppShell, inside
// GoogleSessionProvider, beside MailOutboxPump and MailSnapshotPump -- the
// same "outlives every screen" spot -- so the one thing in this app that
// sends without a tap keeps its promise while the phone is face down. The
// work is autoReplyPump.ts; this is the api lookup, the services, the tick,
// and the re-entrancy guard. Renders nothing.
export default function AutoReplyPump() {
  const g = useGoogle();
  const routineSvc = useOptionalRoutine();
  const profileSvc = useOptionalProfile();
  // One pass at a time. Two overlapping passes (a tick landing while the
  // first is still awaiting getThread) could both clear shouldAutoReply for
  // the same VIP before either marked them, which is how a person gets the
  // same auto-reply twice.
  const docs = useOptionalBrainDocs();
  const busy = useRef(false);

  useEffect(() => {
    const tick = () => {
      if (busy.current || !g.hasToken || !routineSvc || !autoReplyEnabled()) return;
      busy.current = true;
      void (async () => runAutoReplyPass({
        apis: () => g.apis("mail"),
        routine: () => routineSvc.get(),
        myName: async () => (await profileSvc?.get())?.name ?? "",
        onSent: () => emit({ type: "action", props: { name: "email.autoreply" } }),
        // UP-MIND-20 (2026-09-05): the user's stated hard lines. Read fresh
        // each pass: a line added at lunchtime holds this afternoon.
        hardLines: docs ? await docs.hardLines().catch(() => []) : [],
      }))()
        .catch(() => { /* best effort: the next tick retries */ })
        .finally(() => { busy.current = false; });
    };
    tick();
    const t = setInterval(tick, AUTO_REPLY_TICK_MS);
    return () => clearInterval(t);
  }, [g.apis, g.hasToken, routineSvc, profileSvc, docs]);

  return null;
}
