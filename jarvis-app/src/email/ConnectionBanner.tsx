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

export default function ConnectionBanner({ models, notes, onReconnect, onViewPaused, onAcknowledge, onSeen }: {
  models: BannerModel[];
  notes: RecoveryNote[];
  onReconnect: () => void;
  /** Omitted where there is nowhere to see paused actions (no mailbox client). */
  onViewPaused?: () => void;
  onAcknowledge: (incidentId: string) => void;
  onSeen: (incidentId: string) => void;
}) {
  // A strip tapped open for another look. Local and per visit: the acknowledgement itself is the ledger's.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <>
      {models.map((m) => {
        const compact = m.strip && !expanded[m.incidentId];
        const act = (fn: () => void) => () => { onAcknowledge(m.incidentId); fn(); };
        if (compact) {
          return (
            <div className="conn-strip" role="alert" key={m.incidentId} data-incident={m.incidentId}>
              <span className="conn-strip-text" {...pressable(() => setExpanded((e) => ({ ...e, [m.incidentId]: true })))}>{m.title} · {m.address}</span>
              {m.reconnect && <button className="conn-strip-act" onClick={() => onReconnect()}>{RECONNECT_LABEL}</button>}
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
              {m.reconnect && <button className="conn-banner-act primary" onClick={(e) => { e.stopPropagation(); act(onReconnect)(); }}>{RECONNECT_LABEL}</button>}
              {onViewPaused && <button className="conn-banner-act" onClick={(e) => { e.stopPropagation(); act(onViewPaused)(); }}>{PAUSED_LABEL}</button>}
              <button className="conn-banner-act" onClick={(e) => { e.stopPropagation(); act(() => openExternal(gmailUrlFor(m.email)))(); }}>{OPEN_GMAIL_LABEL}</button>
            </div>
          </div>
        );
      })}
      {notes.map((n) => (
        <div className="email-note quiet" role="status" key={n.incidentId} data-incident={n.incidentId}>
          <span>{n.title} · {n.detail}</span>
          {n.state === "caught_up" && <button className="quiet-action" onClick={() => onSeen(n.incidentId)}>Done</button>}
        </div>
      ))}
    </>
  );
}
