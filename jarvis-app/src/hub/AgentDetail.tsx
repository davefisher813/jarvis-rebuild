// H4 AGENT DETAIL (IMPLEMENTATION-SPEC.md 09, 04). Name and status, the
// selected project, the three modes with their exact ceiling, what is
// shared now, Share context, Revoke access. A mode change is a mode change:
// the answer is the capability summary, never a new grant. Revoke is one
// tap, immediate, server side, and says what it cannot do.

import { useState } from "react";
import PageHeader from "../shared/PageHeader";
import { Menu } from "../settings/kit";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { modeSummary } from "../substrate/authz/engine";
import type { AgentMode } from "../substrate/contracts";
import { revokeAgent } from "../substrate/agentClient";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { ADMIN_OFF, MODES, MODE_LABEL, NOTHING_SHARED, PICK_PROJECT_FIRST, PREVIEW_AI_OFF, PREVIEW_CONTEXT, PREVIEW_OFFLINE, PREVIEW_REVOKED, REVOKE, REVOKE_NOTE, STATUS_WORD, TRANSPORT_WORD, HUB_TITLE } from "./copy";
import { setMode, type HubConnection, type HubProject, type RpcClient } from "./hubClient";
import { facts, whenLine } from "./format";

export default function AgentDetail({ client, connection, projects, aiAllowed, adminOff, offline, onBack, onChanged, onPreview }: {
  client: RpcClient;
  connection: HubConnection;
  projects: HubProject[];
  aiAllowed: boolean;
  /** An admin has switched AI off: the person cannot turn it back on, so the
   *  Preview toast must not tell them to (2026-10-05). */
  adminOff?: boolean;
  offline: boolean;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onPreview: (connectionId: string, projectId: string) => void;
}) {
  const c = connection;
  const revoked = c.status === "revoked";
  const [projectId, setProjectId] = useState<string>(c.project_id ?? "");
  const [busy, setBusy] = useState<"mode" | "revoke" | null>(null);
  const project = projects.find((p) => p.id === projectId) ?? null;

  const pickMode = async (mode: AgentMode) => {
    if (mode === c.mode || revoked || busy || offline) return;
    haptics.selection();
    setBusy("mode");
    const r = await setMode(client, c, mode);
    setBusy(null);
    if (!r.ok) { showToast({ message: COMMAND_LINES[r.code] }); return; }
    showToast({ message: `${MODE_LABEL[mode]} · ${modeSummary(mode).at(-1) ?? ""}` });
    await onChanged();
  };

  const revoke = async () => {
    if (revoked || busy || offline) return;
    setBusy("revoke");
    const r = await revokeAgent(client, c.id);
    setBusy(null);
    if (!r.ok) { showToast({ message: COMMAND_LINES[r.code] }); return; }
    showToast({ message: `Revoked Access · ${c.display_name}` });
    await onChanged();
  };

  // DIMMED, STILL TAPPABLE (2026-10-04; shared/SheetBar's rule: the tap is what
  // surfaces the missing thing). The row was natively disabled while its onClick
  // opened with the "Pick a Project First" toast, which a disabled button never
  // fires, so a new assistant (no project yet) showed a grey row that did
  // nothing and said nothing. The same went for AI off and for offline.
  const previewWhy = revoked ? PREVIEW_REVOKED : adminOff ? ADMIN_OFF : !aiAllowed ? PREVIEW_AI_OFF : offline ? PREVIEW_OFFLINE : !projectId ? PICK_PROJECT_FIRST : null;

  return (
    <div className="screen ruled hub">
      <PageHeader title={c.display_name} back={HUB_TITLE} onBack={onBack} />

      <div className="sh2 sh2-quiet"><span className="t">Status</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row"><div className="row-grow"><div className="conn-name">{STATUS_WORD[c.status] ?? c.status}</div>
          <div className="conn-meta">{facts(TRANSPORT_WORD[c.transport], c.last_used_at ? `Last Used ${whenLine(c.last_used_at)}` : null, c.revoked_at ? `Revoked ${whenLine(c.revoked_at)}` : null)}</div></div></div>
        {/* row-tap: the row forwards to its own menu, which is the control */}
        <Menu label="Project" meta="One Project · No Access to Your Whole Life" value={projectId} word={project?.title ?? "None"} ariaLabel="Project"
          options={projects.map((p) => ({ value: p.id, label: p.title }))} onPick={(k) => setProjectId(k)} off={revoked} />
      </div></div>

      <div className="sh2 sh2-quiet"><span className="t">Mode</span></div>
      <div className="pad-x"><div className="card list-card-ruled" role="radiogroup" aria-label="Mode">
        {MODES.map((m) => (
          <div key={m} className="row set-row" role="radio" aria-checked={c.mode === m} aria-disabled={revoked || offline || undefined} tabIndex={0}
            onClick={() => void pickMode(m)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); void pickMode(m); } }}>
            <div className="row-grow">
              <div className="conn-name">{MODE_LABEL[m]}</div>
              <div className="hub-mode-lines">{modeSummary(m).map((line) => <span key={line}>{line}</span>)}</div>
            </div>
            <div className={"radio" + (c.mode === m ? " on" : "")} />
          </div>
        ))}
      </div></div>

      <div className="sh2 sh2-quiet"><span className="t">What's Shared</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {c.grants.length === 0 && <div className="row"><div className="conn-name">{NOTHING_SHARED}</div></div>}
        {c.grants.map((g) => (
          <div className="row" key={g.grant_id}>
            <div className="row-grow">
              <div className="conn-name">{g.project_title ?? "Selected Records"}</div>
              <div className="conn-meta">{facts(g.record_count === 1 ? "1 Record" : `${g.record_count} Records`, g.fields.length ? g.fields.join(", ") : null, g.expires_at ? `Until ${whenLine(g.expires_at)}` : "For This Project")}</div>
            </div>
          </div>
        ))}
        <button className={"row row-act" + (previewWhy ? " dim" : "")} aria-disabled={previewWhy ? true : undefined}
          onClick={() => { if (previewWhy) { showToast({ message: previewWhy }); return; } onPreview(c.id, projectId); }}>{PREVIEW_CONTEXT}</button>
      </div></div>

      <div className="pad-x"><div className="card list-card-ruled">
        <button className="row row-act hub-danger" disabled={revoked || busy === "revoke" || offline} onClick={() => void revoke()}>{busy === "revoke" ? "Revoking…" : REVOKE}</button>
      </div></div>
      <div className="hub-note">{REVOKE_NOTE}</div>
      <div className="screen-foot" />
    </div>
  );
}
