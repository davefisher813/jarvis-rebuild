// THE LOUD BANNER (Foundation Fix Spec 3, failure-modes section 16a).
//
// A confirmed connection loss is shown at the top of Email, in red with white
// text, for as long as it is true. There is no dismiss button: tapping the
// banner or any of its three ways out ACKNOWLEDGES it, and an acknowledged
// banner compacts to one persistent strip. The failure never leaves the screen
// while it is open, and this component never says "All Caught Up" or shows a
// healthy zero. After the loss resolves, the same place says "Access Restored"
// and, only once a sync has finished after that, "Mail Caught Up", as two
// separate notes.
//
// Reconnect is offered only for a confirmed lost grant. A degraded incident (an
// outage that has lasted) offers the other two ways out and never a reconnect
// loop that cannot help.

import { useState } from "react";
import { pressable } from "../shared/pressable";
import { openExternal } from "../messages/openExternal";
import { OPEN_GMAIL_LABEL, PAUSED_LABEL, RECONNECT_LABEL, gmailUrlFor, type BannerModel, type RecoveryNote } from "../connections/incidentView";
import { CHECKING_LINE } from "../connections/google/reconnect";
import type { Outcome, OutcomeAction } from "./useReconnect";

const ACTION_LABEL: Record<OutcomeAction, string> = { finish: "Finish Reconnecting", not_now: "Not Now", retry: "Try Again", permissions: "Open Google Permissions" };

export default function ConnectionBanner({ models, notes, onReconnect, onViewPaused, onAcknowledge, onSeen, busyEmail = null, outcome = null, checking = false, onOutcomeAction }: {
  models: BannerModel[];
  notes: RecoveryNote[];
  /** One tap, for this exact account. */
  onReconnect: (email: string) => void;
  /** The account whose reconnect is open at Google right now. */
  busyEmail?: string | null;
  /** What the server's checks (or Google) said, when the reconnect did not complete. Silent outcomes never arrive here. */
  outcome?: Outcome | null;
  /** The app was killed mid-reconnect and is asking the server what became of it. */
  checking?: boolean;
  onOutcomeAction?: (a: OutcomeAction) => void;
  /** Omitted where there is nowhere to see paused actions (no mailbox client). */
  onViewPaused?: () => void;
  onAcknowledge: (incidentId: string) => void;
  onSeen: (incidentId: string) => void;
}) {
  // A strip tapped open for another look. Local and per visit: the acknowledgement itself is the ledger's.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The button says exactly which account it reconnects (Spec 4, the first of two wrong-account guards).
  const reconnectLabel = (email: string) => `${RECONNECT_LABEL.replace(" Gmail", "")} ${email}`;
  return (
    <>
      {models.map((m) => {
        const compact = m.strip && !expanded[m.incidentId];
        const act = (fn: () => void) => () => { onAcknowledge(m.incidentId); fn(); };
        if (compact) {
          return (
            <div className="conn-strip" role="alert" key={m.incidentId} data-incident={m.incidentId}>
              <span className="conn-strip-text" {...pressable(() => setExpanded((e) => ({ ...e, [m.incidentId]: true })))}>{m.title} · {m.address}</span>
              {m.reconnect && <button className="conn-strip-act" disabled={busyEmail !== null} onClick={() => onReconnect(m.email)}>{reconnectLabel(m.email)}</button>}
            </div>
          );
        }
        return (
          <div className="conn-banner" role="alert" key={m.incidentId} data-incident={m.incidentId} onClick={() => onAcknowledge(m.incidentId)}>
            <div className="conn-banner-title">{m.title}</div>
            <div className="conn-banner-addr">{m.address}</div>
            <div className="conn-banner-line">{m.lines[0]}</div>
            <div className="conn-banner-line">{m.lines[1]}</div>
            {m.paused && <div className="conn-banner-line conn-banner-paused">{m.paused}</div>}
            <div className="conn-banner-acts">
              {m.reconnect && <button className="conn-banner-act primary" disabled={busyEmail !== null} onClick={(e) => { e.stopPropagation(); act(() => onReconnect(m.email))(); }}>{busyEmail === m.email ? "Connecting" : reconnectLabel(m.email)}</button>}
              {onViewPaused && <button className="conn-banner-act" onClick={(e) => { e.stopPropagation(); act(onViewPaused)(); }}>{PAUSED_LABEL}</button>}
              <button className="conn-banner-act" onClick={(e) => { e.stopPropagation(); act(() => openExternal(gmailUrlFor(m.email)))(); }}>{OPEN_GMAIL_LABEL}</button>
            </div>
          </div>
        );
      })}
      {checking && <div className="email-note quiet" role="status"><span>{CHECKING_LINE}</span></div>}
      {outcome && (
        <div className="email-note conn-outcome" role="status" data-status={outcome.status}>
          <div className="conn-outcome-body">
            <div className="conn-outcome-title">{outcome.copy.title}</div>
            {outcome.copy.lines.map((l) => <div key={l}>{l}</div>)}
          </div>
          <div className="conn-outcome-acts">
            {outcome.copy.actions.map((a) => <button key={a} className="quiet-action" onClick={() => onOutcomeAction?.(a)}>{ACTION_LABEL[a]}</button>)}
          </div>
        </div>
      )}
      {notes.map((n) => (
        <div className="email-note quiet" role="status" key={n.incidentId} data-incident={n.incidentId}>
          <span>{n.title} · {n.detail}</span>
          {n.state === "caught_up" && <button className="quiet-action" onClick={() => onSeen(n.incidentId)}>Done</button>}
        </div>
      ))}
    </>
  );
}
