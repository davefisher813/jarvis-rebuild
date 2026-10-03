// H1 AGENTS (IMPLEMENTATION-SPEC.md 09). The AI switch, the brief, the
// assistants as cards with their mode and project, Add assistant. No
// verified adapter exists for this deployment, so Add makes a manual
// assistant (export and import); a Connect button that cannot connect is a
// false sign, so there is none.

import { Card, Switch } from "../settings/kit";
import { pressable } from "../shared/pressable";
import { ADMIN_OFF, AI_OFF, AI_OFF_STILL_WORKS, AI_ON, BRIEF, EMPTY_AGENTS, MODE_LABEL, STATUS_WORD } from "./copy";
import type { HubConnection } from "./hubClient";
import { facts } from "./format";

const Chev = () => <div className="chev" />;

export default function AgentsTab({ connections, aiOn, adminOff, canToggle, onToggleAI, onOpenAgent, onAdd }: {
  connections: HubConnection[];
  aiOn: boolean;
  adminOff: boolean;
  /** False when there is no profile to write the switch to (a build with no backend). */
  canToggle: boolean;
  onToggleAI: () => void;
  onOpenAgent: (id: string) => void;
  onAdd: () => void;
}) {
  const live = connections.filter((c) => c.status !== "revoked");
  const gone = connections.filter((c) => c.status === "revoked");
  const sayLocked = () => onToggleAI();
  return (
    <>
      <div className="hub-brief">{BRIEF}</div>
      <div className="pad-x"><Card>
        <Switch label="AI" meta={adminOff ? ADMIN_OFF : aiOn ? AI_ON : AI_OFF} on={aiOn} onToggle={onToggleAI} ariaLabel="AI on or off" locked={adminOff || !canToggle} onLocked={sayLocked} />
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
                  <div className="conn-meta">{facts(MODE_LABEL[c.mode], c.project_title ?? "No Project Yet", c.open_grants > 0 ? (c.open_grants === 1 ? "1 Share Open" : `${c.open_grants} Shares Open`) : null)}</div>
                </div>
                <span className={"row-status" + (c.status === "connected" ? " fg-good" : "")}>{STATUS_WORD[c.status] ?? c.status}</span>
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
                  <div className="conn-meta">{STATUS_WORD.revoked}</div>
                </div>
                <Chev />
              </div>
            ))}
          </div></div>
        </>
      )}

      <div className="hub-note">{AI_OFF_STILL_WORKS}</div>
    </>
  );
}
