// H6 DECISION DETAIL (IMPLEMENTATION-SPEC.md 06, 09). Statement, rationale,
// alternatives, constraints, dependencies with their state, source and the
// immutable history. Replace and Withdraw are distinct verbs with distinct
// effects; a changed dependency is a review to do, never a rewrite done.

import { useEffect, useState } from "react";
import PageHeader from "../shared/PageHeader";
import { pressable } from "../shared/pressable";
import { showToast } from "../shared/toast";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { DECISION_CHANGED, DEP_CHANGED_NOTE, MARK_REVIEWED, REPLACE_DECISION, WITHDRAW_DECISION, WITHDRAW_LINE, ENTERED_BY_YOU } from "./copy";
import { conflictsOf, decisionHistory, dismissProposal, saveDecision, withdrawDecision, type Conflict, type DecisionHistory, type DecisionVersion, type HubOverview, type RpcClient } from "./hubClient";
import DecisionSheet, { draftToInput, type DecisionDraft, type DependencyOption } from "./DecisionSheet";
import { WithdrawSheet } from "./sheets";
import { facts, whenLine } from "./format";

const STATUS_WORD: Record<DecisionVersion["status"], string> = { active: "Active", superseded: "Superseded", withdrawn: "Withdrawn" };
const DEP_WORD: Record<string, string> = { current: "Current", changed: "Changed", missing: "Missing" };
const ENTITY_KIND: Record<string, string> = { task: "task", event: "event", decision_record: "decision", project: "project", goal: "goal", person: "person" };

export default function DecisionDetail({ client, itemId, overview, offline, taskOptions, onBack, onChanged, onOpenItem }: {
  client: RpcClient;
  itemId: string;
  overview: HubOverview;
  offline: boolean;
  taskOptions: DependencyOption[];
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onOpenItem?: (kind: string, id: string) => void;
}) {
  const [h, setH] = useState<DecisionHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"replace" | "withdraw" | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const r = await decisionHistory(client, itemId);
    if (r.ok) { setH(r.value); setError(null); } else setError(COMMAND_LINES[r.code]);
  };
  useEffect(() => { void load();
  }, [client, itemId]);

  const active = h?.versions.find((v) => v.status === "active") ?? null;
  const latest = h?.versions[0] ?? null;
  const shown = active ?? latest;
  const projectId = typeof h?.data.linkedId === "string" ? h.data.linkedId : (() => { const links = h?.data.links; return Array.isArray(links) ? (links.find((l) => (l as { type?: string }).type === "project") as { id?: string } | undefined)?.id ?? null : null; })();
  const project = overview.projects.find((p) => p.id === projectId) ?? null;
  const changedDeps = shown?.dependencies.filter((d) => d.status !== "current") ?? [];
  const suggestion = overview.proposals.find((p) => p.type === "constraint_change" && p.payload?.decision_item_id === itemId) ?? null;
  const decisionOptions: DependencyOption[] = overview.decisions.filter((d) => d.item_id !== itemId && (!projectId || d.project_id === projectId)).map((d) => ({ id: d.item_id, label: d.title, kindLabel: "Decision" }));

  const replace = async (draft: DecisionDraft) => {
    if (!projectId || offline) { showToast({ message: COMMAND_LINES.OFFLINE }); return; }
    setBusy("replace");
    const r = await saveDecision(client, { projectId, ...draftToInput(draft), source: { kind: "manual", at: new Date().toISOString() }, replaceItemId: itemId });
    setBusy(null);
    if (!r.ok) { const c = conflictsOf(r); if (c.length) { setConflicts(c); return; } showToast({ message: COMMAND_LINES[r.code] }); return; }
    setSheet(null); setConflicts([]);
    showToast({ message: r.value.safe_message });
    await load(); await onChanged();
  };

  const withdraw = async (reason: string) => {
    if (!active || !h || offline) { showToast({ message: COMMAND_LINES.OFFLINE }); return; }
    setBusy("withdraw");
    const r = await withdrawDecision(client, active.version_id, h.item_updated_at, reason);
    setBusy(null);
    if (!r.ok) { showToast({ message: COMMAND_LINES[r.code] }); if (r.code === "DESTINATION_CHANGED") await load(); return; }
    setSheet(null);
    showToast({ message: r.value.safe_message });
    await load(); await onChanged();
  };

  const reviewed = async () => {
    if (!suggestion || offline) return;
    setBusy("reviewed");
    const r = await dismissProposal(client, suggestion);
    setBusy(null);
    if (!r.ok) showToast({ message: COMMAND_LINES[r.code] });
    await load(); await onChanged();
  };

  const title = shown?.title ?? "Decision";
  return (
    <div className="screen ruled hub">
      <PageHeader title="Decision" back="AI Hub" onBack={onBack} />
      {!h && !error && <div className="hub-note">Loading…</div>}
      {error && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="conn-name">{error}</div></div>
          <button className="row row-act hub-quiet" onClick={() => void load()}>Retry</button>
        </div></div>
      )}
      {h && shown && (
        <>
          {!active && <div className="hub-note">{DECISION_CHANGED}</div>}
          {changedDeps.length > 0 && <div className="hub-note">{DEP_CHANGED_NOTE}</div>}

          <div className="sh2 sh2-quiet"><span className="t">{STATUS_WORD[shown.status]} · Version {shown.version}</span></div>
          <div className="pad-x"><div className="card pad hub-card">
            <div className="conn-name">{title}</div>
            <div className="hub-text hub-text-strong">{shown.statement}</div>
            <div className="facts"><span className="fact">{facts(project?.title ?? null, whenLine(shown.committed_at))}</span></div>
          </div></div>

          <div className="sh2 sh2-quiet"><span className="t">Because</span></div>
          <div className="pad-x"><div className="card pad"><div className="hub-text">{shown.rationale}</div></div></div>

          {shown.alternatives.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Ruled Out</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {shown.alternatives.map((a) => <div className="row" key={a}><div className="conn-name">{a}</div></div>)}
              </div></div>
            </>
          )}

          {shown.constraints.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Constraints</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {shown.constraints.map((c) => <div className="row" key={c.key}><div className="row-grow"><div className="conn-name">{c.key}</div><div className="conn-meta">{c.value}</div></div></div>)}
              </div></div>
            </>
          )}

          <div className="sh2 sh2-quiet"><span className="t">Depends On</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {shown.dependencies.length === 0 && <div className="row"><div className="conn-name">Nothing Yet</div></div>}
            {shown.dependencies.map((d) => {
              const kind = d.entity_type ? ENTITY_KIND[d.entity_type] : undefined;
              const door = onOpenItem && kind && d.status !== "missing" ? pressable(() => onOpenItem(kind, d.item_id)) : {};
              return (
                <div {...door} className="row" key={d.id}>
                  <div className="row-grow">
                    <div className="conn-name">{d.title || "A Record"}</div>
                    <div className="conn-meta">{facts(d.kind.replace("_", " ").replace(/^\w/, (ch) => ch.toUpperCase()), d.entity_type ? d.entity_type.replace("_", " ").replace(/^\w/, (ch) => ch.toUpperCase()) : null)}</div>
                  </div>
                  <span className={"hub-cap" + (d.status === "current" ? "" : " hub-cap-waiting")}>{DEP_WORD[d.status] ?? d.status}</span>
                </div>
              );
            })}
            {suggestion && changedDeps.length > 0 && <button className="row row-act hub-quiet" disabled={busy === "reviewed" || offline} onClick={() => void reviewed()}>{MARK_REVIEWED}</button>}
          </div></div>

          <div className="sh2 sh2-quiet"><span className="t">Source</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            <div className="row"><div className="row-grow"><div className="conn-name">{typeof h.data.source === "object" && h.data.source && (h.data.source as { kind?: string }).kind === "chat" ? "Project Conversation" : ENTERED_BY_YOU}</div>
              {h.evidence.length > 0 && <div className="conn-meta">{h.evidence.length === 1 ? "1 Evidence Excerpt" : `${h.evidence.length} Evidence Excerpts`}</div>}</div></div>
            {h.evidence.map((e) => <div className="row" key={e.id}><div className="row-grow"><div className="hub-text">{e.excerpt}</div><div className="conn-meta">{facts(e.type === "email" ? "Email" : e.type === "import" ? "Import" : "Entered", e.availability !== "available" ? "Source No Longer Available" : null)}</div></div></div>)}
          </div></div>

          <div className="sh2 sh2-quiet"><span className="t">History</span></div>
          <div className="pad-x"><div className="card pad">
            {h.versions.map((v) => (
              <div className="hub-version" key={v.version_id}>
                <div className="facts"><span className="fact">{facts(`Version ${v.version}`, STATUS_WORD[v.status], whenLine(v.committed_at))}</span></div>
                <div className="hub-text hub-text-strong">{v.statement}</div>
                <div className="hub-text">{v.rationale}</div>
                {v.withdrawal_reason && <div className="hub-text">Withdrawn · {v.withdrawal_reason}</div>}
              </div>
            ))}
          </div></div>

          {active && (
            <div className="pad-x"><div className="card list-card-ruled">
              <button className="row row-act" disabled={offline} onClick={() => { setConflicts([]); setSheet("replace"); }}>{REPLACE_DECISION}</button>
              <button className="row row-act hub-danger" disabled={offline} onClick={() => setSheet("withdraw")}>{WITHDRAW_DECISION}</button>
            </div></div>
          )}
          {!active && <div className="hub-note">{WITHDRAW_LINE}</div>}
        </>
      )}
      <div className="screen-foot" />
      {sheet === "replace" && shown && project && (
        <DecisionSheet mode="replace" projectTitle={project.title} sourceLine={ENTERED_BY_YOU}
          initial={{ title: shown.title, statement: shown.statement, rationale: shown.rationale, alternatives: shown.alternatives.join("\n"), constraintKey: shown.constraints[0]?.key ?? "", constraintValue: shown.constraints[0]?.value ?? "", dependencies: shown.dependencies.filter((d) => d.status !== "missing").map((d) => ({ item_id: d.item_id, kind: d.kind })) }}
          options={[...taskOptions, ...decisionOptions]} conflicts={conflicts} busy={busy === "replace"}
          onSave={(d) => void replace(d)} onReplace={(d) => void replace(d)} onCancel={() => { setSheet(null); setConflicts([]); }} />
      )}
      {sheet === "withdraw" && shown && <WithdrawSheet title={shown.title} busy={busy === "withdraw"} onSave={(r) => void withdraw(r)} onCancel={() => setSheet(null)} />}
    </div>
  );
}
