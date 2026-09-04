import { useCallback, useEffect } from "react";
import { useGoogle } from "../connections/google/GoogleSession";
import type { GoogleApi } from "../connections/google/api";
import { encodeEmail } from "../connections/google/map";
import { humanError } from "../connections/google/humanError";
import { dueNow, loadOutbox, saveOutbox, type OutboxItem } from "./outbox";
import { getTodayOutbox, removeTodaySend, markTodaySendState, type TodaySend } from "./todayOutbox";
import { countNudge } from "./escalate";
import { clearChase } from "./followUp";
import { emit } from "../events";
import { showToast } from "../shared/toast";

// The actual send, plus its side effects, as a standalone function so it is
// testable directly with a fake GoogleApi -- no timers, no GoogleSession
// context, no waiting out a real twelve-second hold. The component below is
// just the timer and the api lookup around this.
export async function processTodaySend(item: TodaySend, api: GoogleApi | null): Promise<void> {
  if (!api) {
    // Not connected right now is not necessarily final (a token refresh, a
    // startup race): revert to held so the next tick retries, rather than
    // leaving the item stuck as "sending" forever with nothing able to pick
    // it up again.
    markTodaySendState(item.id, "held");
    return;
  }
  try {
    await api.sendMessage(
      encodeEmail({ to: item.to, subject: item.subject, body: item.body, inReplyTo: item.inReplyTo }),
      item.threadId,
    );
    // The ladder climbs on what was actually SENT (escalate.ts's own law); a
    // plain reply is not a nudge. N3: any successful send retires a chase on
    // that thread, whatever kind of card it went out from.
    if (item.todayKind !== "reply" && item.threadId) countNudge(item.threadId);
    if (item.threadId) clearChase(item.threadId);
    emit({ type: "email.handled", props: { kind: "reply" } });
    removeTodaySend(item.id);
  } catch (e) {
    // Never silently lost: it graduates into the real outbox -- the one
    // MessagesFlow renders with Retry and Edit -- the same recovery S2-1
    // already built and tested, reused rather than reinvented.
    const failed: OutboxItem = {
      id: item.id, account: item.account, to: item.to, subject: item.subject, body: item.body,
      inReplyTo: item.inReplyTo, threadId: item.threadId, dueMs: item.dueMs, scheduled: false,
      state: "failed", error: humanError(e, "Could not send"),
    };
    saveOutbox([...loadOutbox(), failed]);
    showToast({ message: "Couldn't send · In your email outbox to retry" });
    removeTodaySend(item.id);
  }
}

// See todayOutbox.ts for why this is a second, small queue rather than a
// second copy of MessagesFlow's own. Mounted once in AppShell, inside
// GoogleSessionProvider, alongside GoogleAutoImport -- the same "outlives
// every screen" spot S1 used for notification-tap routing -- so a Today
// card's held send is still pumped even after the user has switched tabs.
// Renders nothing.
export default function TodayOutboxPump() {
  const g = useGoogle();

  const process = useCallback(
    (item: TodaySend) => processTodaySend(item, g.api(item.account)),
    [g],
  );

  useEffect(() => {
    const t = setInterval(() => {
      for (const item of dueNow(getTodayOutbox(), Date.now())) {
        markTodaySendState(item.id, "sending");
        void process(item as TodaySend);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [process]);

  return null;
}
