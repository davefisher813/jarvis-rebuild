// H1 AGENTS (IMPLEMENTATION-SPEC.md 09). The AI switch, the brief, the
// assistants as cards with their mode and project, Add assistant. No
// verified adapter exists for this deployment, so Add makes a manual
// assistant (export and import); a Connect button that cannot connect is a
// false sign, so there is none.

import { Card, Foot, Switch } from "../settings/kit";
import { pressable } from "../shared/pressable";
import { ADMIN_OFF, AI_OFF, AI_OFF_STILL_WORKS, BRIEF, EMPTY_AGENTS, MODE_LABEL, STATUS_WORD, SWEEP_ROW } from "./copy";
import type { HubConnection } from "./hubClient";
import HubFacts from "./HubFacts";
import { whenFacts } from "./format";

// 2026-10-05 (catalog gate, R1 and R3): an assistant's row is its name, ONE
// grey (what it may do), and a status word that wears the key only when it
// MEANS something: Connected is green, an expired link is red (ran out), an
// unavailable one amber (stalled). "Manual" is how every assistant here is
// added, so it said nothing and sat beside the mode as a second grey; it
// shows nothing now (the detail page still names the transport). The project
// and the open-share count left the row for the same reason (a third and a
// fourth grey, "No Project Yet" a placeholder): the detail page carries both.
const STATUS_TONE: Record<string, string> = { connected: " fg-good", expired: " fact red", unavailable: " fact warn" };

const Chev = () => <div className="chev" />;

export default function AgentsTab({ connections, aiOn, adminOff, canToggle, onToggleAI, onOpenAgent, onAdd, onSweep, sweeping }: {
  connections: HubConnection[];
  aiOn: boolean;
  adminOff: boolean;
  /** False when there is no profile to write the switch to (a build with no backend). */
  canToggle: boolean;
  onToggleAI: () => void;
  onOpenAgent: (id: string) => void;
  onAdd: () => void;
  /** Runs the context sweep: expire what has run out, delete the copies whose time has come. */
  onSweep: () => void;
  sweeping: boolean;
}) {
  const live = connections.filter((c) => c.status !== "revoked");
  const gone = connections.filter((c) => c.status === "revoked");
  const sayLocked = () => onToggleAI();
  return (
    <>
      <Foot>{BRIEF}</Foot>
      <div className="pad-x"><Card>
        <Switch label="AI" meta={adminOff ? ADMIN_OFF : aiOn ? undefined : AI_OFF} on={aiOn} onToggle={onToggleAI} ariaLabel="AI on or off" locked={adminOff || !canToggle} onLocked={sayLocked} />
      </Card></div>

      {live.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">{EMPTY_AGENTS.title}</div>
          <div className="empty-sub">{EMPTY_AGENTS.sub}</div>
          <button className="btn btn-primary" onClick={onAdd}>{EMPTY_AGENTS.action}</button>
        </div>
      )}

      {live.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Assistants</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {live.map((c) => (
              <div {...pressable(() => onOpenAgent(c.id))} className="row" key={c.id}>
                <div className="row-grow">
                  <div className="conn-name">{c.display_name}</div>
                  <HubFacts facts={[{ text: MODE_LABEL[c.mode] }]} />
                </div>
                {STATUS_TONE[c.status] && <span className={"row-status" + STATUS_TONE[c.status]}>{STATUS_WORD[c.status] ?? c.status}</span>}
                <Chev />
              </div>
            ))}
            <button className="row row-act" onClick={onAdd}>Add Assistant</button>
          </div></div>
        </>
      )}

      {gone.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Revoked</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {gone.map((c) => (
              <div {...pressable(() => onOpenAgent(c.id))} className="row" key={c.id}>
                <div className="row-grow">
                  <div className="conn-name">{c.display_name}</div>
                  <HubFacts facts={c.revoked_at ? whenFacts(c.revoked_at) : []} />
                </div>
                <Chev />
              </div>
            ))}
          </div></div>
        </>
      )}

      {/* The sweep's one door (slice 09 QA, 2026-10-04): nothing here runs on a timer, so clearing what has expired is the
          person's own tap. Always shown, because the person's own exports leave packages with no assistant at all. */}
      <div className="pad-x"><div className="card list-card-ruled">
        <button className="row row-act hub-quiet" disabled={sweeping} onClick={onSweep}>{sweeping ? SWEEP_ROW.working : SWEEP_ROW.label}</button>
      </div></div>
      <Foot>{SWEEP_ROW.meta}</Foot>

      <Foot>{AI_OFF_STILL_WORKS}</Foot>
    </>
  );
}
