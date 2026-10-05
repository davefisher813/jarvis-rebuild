// H4 AGENT DETAIL (IMPLEMENTATION-SPEC.md 09, 04). Name and status, the
// selected project, the three modes with their exact ceiling, what is
// shared now, Share context, Revoke access. A mode change is a mode change:
// the answer is the capability summary, never a new grant. Revoke is one
// tap, immediate, server side, and says what it cannot do.

import { useState } from "react";
import PageHeader from "../shared/PageHeader";
import { Foot, Menu } from "../settings/kit";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { modeSummary } from "../substrate/authz/engine";
import type { AgentMode } from "../substrate/contracts";
import { revokeAgent } from "../substrate/agentClient";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { ADMIN_OFF, MODES, MODE_LABEL, NOTHING_SHARED, PICK_PROJECT_FIRST, PREVIEW_AI_OFF, PREVIEW_CONTEXT, PREVIEW_OFFLINE, PREVIEW_REVOKED, REVOKE, REVOKE_NOTE, STATUS_WORD, TRANSPORT_WORD, HUB_TITLE } from "./copy";
import { setMode, type HubConnection, type HubGrant, type HubProject, type RpcClient } from "./hubClient";
import { dayLabel, timeOf, whenFacts } from "./format";
import HubFacts, { type HubFact, type HubFactInput } from "./HubFacts";
import { titleCase } from "../shared/casing";

// 2026-10-05 (catalog gate, R1, R3, R6, R8 and the casing rule). The Status
// row, the mode rows and the grant rows each drew a middle-dotted string or a
// stack of grey lines. Now: the status row is the transport (its one grey) and
// the last use or the revoke time (a neutral time, small caps). A mode row is
// ONE grey line, what it may do, with the sentence every mode ends on
// ("Saves and Sends Still Need Your Tap") said once under the group as its
// note, not four times. A grant row is the record count (a white number), the
// fields it carries (the one grey, in Title Case, not the raw keys) and when it
// ends (small caps); a grant with no end says nothing, because "For This
// Project" only repeated the row's own title.
export function statusFacts(c: Pick<HubConnection, "transport" | "last_used_at" | "revoked_at">): HubFactInput[] {
  return [
    { text: TRANSPORT_WORD[c.transport] },
    c.last_used_at && { text: `Last Used ${dayLabel(c.last_used_at)} ${timeOf(c.last_used_at)}`.trim(), tone: "date" },
    ...(c.revoked_at ? whenFacts(c.revoked_at) : []),
  ];
}
export const modeCeiling = (m: AgentMode): string => modeSummary(m).slice(0, -1).join(", ");
export function grantFacts(g: Pick<HubGrant, "record_count" | "fields" | "expires_at">): HubFactInput[] {
  return [
    { text: g.record_count === 1 ? "1 Record" : `${g.record_count} Records`, strong: true },
    g.fields.length > 0 && { text: g.fields.map((f) => titleCase(f.replace(/_/g, " "))).join(", ") },
    g.expires_at && { text: `Until ${dayLabel(g.expires_at)} ${timeOf(g.expires_at)}`.trim(), tone: "date" },
  ];
}

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
          <HubFacts facts={statusFacts(c)} /></div></div>
        {/* row-tap: the row forwards to its own menu, which is the control */}
        <Menu label="Project" meta="One Project, No Access to Your Whole Life" value={projectId} word={project?.title ?? "None"} ariaLabel="Project"
          options={projects.map((p) => ({ value: p.id, label: p.title }))} onPick={(k) => setProjectId(k)} off={revoked} />
      </div></div>

      <div className="sh2 sh2-quiet"><span className="t">Mode</span></div>
      <div className="pad-x"><div className="card list-card-ruled" role="radiogroup" aria-label="Mode">
        {MODES.map((m) => (
          <div key={m} className="row set-row" role="radio" aria-checked={c.mode === m} aria-disabled={revoked || offline || undefined} tabIndex={0}
            onClick={() => void pickMode(m)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); void pickMode(m); } }}>
            <div className="row-grow">
              <div className="conn-name">{MODE_LABEL[m]}</div>
              <HubFacts facts={[{ text: modeCeiling(m) }]} />
            </div>
            <div className={"radio" + (c.mode === m ? " on" : "")} />
          </div>
        ))}
      </div></div>
      <Foot>{modeSummary(MODES[0]!).at(-1)}</Foot>

      <div className="sh2 sh2-quiet"><span className="t">What's Shared</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {c.grants.length === 0 && <div className="row"><div className="conn-name">{NOTHING_SHARED}</div></div>}
        {c.grants.map((g) => (
          <div className="row" key={g.grant_id}>
            <div className="row-grow">
              <div className="conn-name">{g.project_title ?? "Selected Records"}</div>
              <HubFacts facts={grantFacts(g)} />
            </div>
          </div>
        ))}
        <button className={"row row-act" + (previewWhy ? " dim" : "")} aria-disabled={previewWhy ? true : undefined}
          onClick={() => { if (previewWhy) { showToast({ message: previewWhy }); return; } onPreview(c.id, projectId); }}>{PREVIEW_CONTEXT}</button>
      </div></div>

      <div className="pad-x"><div className="card list-card-ruled">
        <button className="row row-act hub-danger" disabled={revoked || busy === "revoke" || offline} onClick={() => void revoke()}>{busy === "revoke" ? "Revoking…" : REVOKE}</button>
      </div></div>
      <Foot>{REVOKE_NOTE}</Foot>
      <div className="screen-foot" />
    </div>
  );
}
