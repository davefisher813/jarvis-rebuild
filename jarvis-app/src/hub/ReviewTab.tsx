// H2 REVIEW (IMPLEMENTATION-SPEC.md 06, 09). "Save what we decided": a
// project picker, Decided and Mentioned, each proposal with its statement,
// reason, evidence, dependencies and Edit; Decided wears Not saved yet.
// Save decision makes a durable version; Keep as note makes an exploration
// note that no constraint query returns; the person can move an item either
// way. Email suggestions appear only as a count and a door into Email.

import { useMemo, useState } from "react";
import { pressable } from "../shared/pressable";
import { showToast } from "../shared/toast";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { whenFacts } from "./format";
import { lineCase, titleCase } from "../shared/casing";
import HubFacts, { type HubFact } from "./HubFacts";
import {
  DISMISS_SUGGESTION, EDIT_DETAILS, EMPTY_REVIEW, ENTERED_BY_YOU, EXPLORATION, KEEP_AS_NOTE, MOVE_TO_DECIDED, MOVE_TO_MENTIONED, NEEDS_REVIEW, NOT_SAVED_YET,
  PASTE_CONVERSATION, PICK_PROJECT_FIRST, REVIEW_HEAD, SAVE_DECISION, emailItemsLine,
} from "./copy";
import { classifyProposal, conflictsOf, dismissProposal, keepExploration, proposalSegment, saveDecision, text, type Conflict, type HubOverview, type HubProposal, type ProposalSegment, type RpcClient } from "./hubClient";
import DecisionSheet, { draftToInput, type DecisionDraft, type DependencyOption } from "./DecisionSheet";

const Chev = () => <div className="chev" />;

export default function ReviewTab({ client, overview, projectId, onPickProject, segment, onSegment, offline, taskOptions, onOpenDecision, onOpenEmail, onImport, onChanged }: {
  client: RpcClient;
  overview: HubOverview;
  projectId: string | null;
  onPickProject: (id: string) => void;
  segment: ProposalSegment;
  onSegment: (s: ProposalSegment) => void;
  offline: boolean;
  /** The project's open tasks, from the Tasks service, as dependency options. */
  taskOptions: DependencyOption[];
  onOpenDecision: (itemId: string) => void;
  onOpenEmail?: () => void;
  onImport: (projectId: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const project = overview.projects.find((p) => p.id === projectId) ?? null;
  const proposals = useMemo(() => overview.proposals.filter((p) => p.type !== "constraint_change" && (!projectId || p.project_id === projectId)), [overview.proposals, projectId]);
  const inSegment = proposals.filter((p) => proposalSegment(p) === segment);
  const decided = overview.decisions.filter((d) => !projectId || d.project_id === projectId);
  const notes = overview.exploration_notes.filter((n) => !projectId || n.project_id === projectId);
  const [sheet, setSheet] = useState<{ proposal: HubProposal | null; conflicts: Conflict[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const decisionOptions: DependencyOption[] = decided.map((d) => ({ id: d.item_id, label: d.title, kindLabel: "Decision" }));
  const options = [...taskOptions, ...decisionOptions];

  const guard = (): boolean => {
    if (offline) { showToast({ message: COMMAND_LINES.OFFLINE }); return false; }
    if (!projectId) { showToast({ message: PICK_PROJECT_FIRST }); return false; }
    return true;
  };

  const save = async (draft: DecisionDraft, replaceItemId?: string) => {
    if (!projectId || !guard()) return;
    const p = sheet?.proposal ?? null;
    setBusy("save");
    const r = await saveDecision(client, {
      projectId, ...draftToInput(draft), evidence: p?.evidence_refs ?? [],
      source: p ? { kind: "chat", at: p.created_at } : { kind: "manual", at: new Date().toISOString() },
      proposalId: p?.id, proposalRevision: p?.revision, replaceItemId,
    });
    setBusy(null);
    if (!r.ok) {
      const conflicts = conflictsOf(r);
      if (conflicts.length) { setSheet((s) => (s ? { ...s, conflicts } : s)); return; }
      showToast({ message: COMMAND_LINES[r.code] });
      if (r.code === "SOURCE_CHANGED") { setSheet(null); await onChanged(); }
      return;
    }
    setSheet(null);
    showToast({ message: r.value.safe_message });
    await onChanged();
  };

  const keep = async (p: HubProposal) => {
    if (!projectId || !guard()) return;
    setBusy(p.id);
    const r = await keepExploration(client, projectId, text(p, "statement") || "Explore This", p.evidence_refs, p.id);
    setBusy(null);
    showToast({ message: r.ok ? r.value.safe_message : COMMAND_LINES[r.code] });
    await onChanged();
  };

  const move = async (p: HubProposal, to: ProposalSegment) => {
    if (offline) { showToast({ message: COMMAND_LINES.OFFLINE }); return; }
    setBusy(p.id);
    const r = await classifyProposal(client, p, to);
    setBusy(null);
    if (!r.ok) showToast({ message: COMMAND_LINES[r.code] });
    await onChanged();
  };

  const dismiss = async (p: HubProposal) => {
    if (offline) { showToast({ message: COMMAND_LINES.OFFLINE }); return; }
    setBusy(p.id);
    const r = await dismissProposal(client, p);
    setBusy(null);
    setSheet(null);
    if (!r.ok) showToast({ message: COMMAND_LINES[r.code] });
    await onChanged();
  };

  const draftOf = (p: HubProposal): Partial<DecisionDraft> => ({
    title: text(p, "title") || text(p, "statement").slice(0, 60),
    statement: text(p, "statement"),
    rationale: text(p, "rationale"),
    alternatives: Array.isArray(p.payload?.alternatives) ? (p.payload!.alternatives as unknown[]).filter((a): a is string => typeof a === "string").join("\n") : "",
  });
  // 2026-10-05 (catalog gate, R1 and R6): who suggested it and how much it
  // rests on are ONE grey fact ("Suggested by Claude, 2 Evidence Links"); the
  // moment is two small-caps date facts. It used to be one string with two
  // middle dots baked in, drawn inside a single .fact.
  const sourceOf = (p: HubProposal | null): { line: string; when: HubFact[] } => {
    if (!p) return { line: ENTERED_BY_YOU, when: [] };
    const who = p.agent_name ?? (p.created_by === "import" ? "Pasted Conversation" : "You");
    const n = p.evidence_refs.length;
    return { line: `Suggested by ${who}` + (n ? `, ${n === 1 ? "1 Evidence Link" : `${n} Evidence Links`}` : ""), when: whenFacts(p.created_at) };
  };

  const empty = inSegment.length === 0 && (segment === "decided" ? decided.length === 0 : notes.length === 0);
  const emailLine = emailItemsLine(overview.email_review_count);

  return (
    <>
      <div className="sh2 sh2-quiet"><span className="t">{REVIEW_HEAD}</span></div>
      {overview.projects.length > 0 && (
        <div className="chip-row" role="tablist" aria-label="Project">
          {overview.projects.map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === projectId} className={"chip" + (p.id === projectId ? " active" : "")} onClick={() => onPickProject(p.id)}>{p.title}</button>
          ))}
        </div>
      )}
      <div className="pad-x">
        <div className="segmented" role="tablist" aria-label="Review">
          {(["decided", "mentioned"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={segment === s} className={"seg" + (segment === s ? " active" : "")} onClick={() => onSegment(s)}>{s === "decided" ? "Decided" : "Mentioned"}</button>
          ))}
        </div>
      </div>

      {/* Paste or Import a Conversation is this tab's own action, so it stands under the choosers as the one capsule (Dave
          2026-10-05, locked: never a row at the foot of a card, and never a box round a lone action, rule 12). A head
          could not hold it: the title is "Save What We Decided" and the capsule is as long again, so it took the title's
          place with an ellipsis. */}
      {!empty && <div className="notice-clear-row"><button className="row-act hub-quiet" onClick={() => { if (projectId) onImport(projectId); else showToast({ message: PICK_PROJECT_FIRST }); }}>{PASTE_CONVERSATION}</button></div>}

      {/* An empty tab is its own words and its one primary (the same action, so the capsule above stands down). */}
      {empty && (
        <div className="empty-state">
          <div className="empty-title">{EMPTY_REVIEW.title}</div>
          <div className="empty-sub">{EMPTY_REVIEW.sub}</div>
          <button className="btn btn-primary" onClick={() => { if (projectId) onImport(projectId); else showToast({ message: PICK_PROJECT_FIRST }); }}>{EMPTY_REVIEW.action}</button>
        </div>
      )}

      {inSegment.map((p) => (
        <div className="pad-x" key={p.id}><div className="card pad hub-card">
          <span className={"hub-cap" + (segment === "decided" ? " hub-cap-waiting" : "")}>{segment === "decided" ? NOT_SAVED_YET : EXPLORATION}</span>
          <div className="conn-name">{titleCase(text(p, "statement") || "Untitled Suggestion")}</div>
          {text(p, "rationale") && <div className="hub-text">{text(p, "rationale")}</div>}
          <HubFacts facts={[{ text: sourceOf(p).line }, ...sourceOf(p).when]} />
          <div className="hub-pills notice-actions">
            {segment === "decided" ? (
              <>
                <button className="pill-act" disabled={busy === p.id} onClick={() => { if (guard()) setSheet({ proposal: p, conflicts: [] }); }}>{SAVE_DECISION}</button>
                <button className="pill-act pill-quiet" disabled={busy === p.id} onClick={() => { if (guard()) setSheet({ proposal: p, conflicts: [] }); }}>{EDIT_DETAILS}</button>
                <button className="pill-act pill-quiet" disabled={busy === p.id} onClick={() => void move(p, "mentioned")}>{MOVE_TO_MENTIONED}</button>
              </>
            ) : (
              <>
                <button className="pill-act" disabled={busy === p.id} onClick={() => void keep(p)}>{KEEP_AS_NOTE}</button>
                <button className="pill-act pill-quiet" disabled={busy === p.id} onClick={() => void move(p, "decided")}>{MOVE_TO_DECIDED}</button>
                <button className="pill-act pill-quiet" disabled={busy === p.id} onClick={() => void dismiss(p)}>{DISMISS_SUGGESTION}</button>
              </>
            )}
          </div>
        </div></div>
      ))}

      {segment === "decided" && decided.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Decided</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {decided.map((d) => (
              <div {...pressable(() => onOpenDecision(d.item_id))} className="row" key={d.item_id}>
                <div className="row-grow">
                  <div className="conn-name">{d.title}</div>
                  <HubFacts facts={[d.version > 1 && { text: `Version ${d.version}`, strong: true }, ...whenFacts(d.committed_at), { text: lineCase(d.statement) }]} />
                </div>
                {d.needs_review && <span className="hub-cap hub-cap-waiting">{NEEDS_REVIEW}</span>}
                <Chev />
              </div>
            ))}
          </div></div>
        </>
      )}

      {segment === "mentioned" && notes.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Notes</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {notes.map((n) => (
              <div className="row" key={n.id}>
                <div className="row-grow">
                  <div className="conn-name">{n.text}</div>
                  <HubFacts facts={[{ text: "Exploration" }, ...(n.created_at ? whenFacts(n.created_at) : [])]} />
                </div>
              </div>
            ))}
          </div></div>
        </>
      )}

      {emailLine && onOpenEmail && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div {...pressable(onOpenEmail)} className="row">
            <div className="row-grow"><div className="conn-name">{emailLine}</div></div>
            <Chev />
          </div>
        </div></div>
      )}

      {sheet && project && (
        <DecisionSheet mode="save" initial={sheet.proposal ? draftOf(sheet.proposal) : {}} projectTitle={project.title} sourceLine={sourceOf(sheet.proposal).line} sourceWhen={sourceOf(sheet.proposal).when}
          options={options} conflicts={sheet.conflicts} busy={busy === "save"}
          onSave={(d) => void save(d)} onReplace={(d, itemId) => void save(d, itemId)}
          onDismiss={sheet.proposal ? () => void dismiss(sheet.proposal!) : undefined}
          onCancel={() => setSheet(null)} />
      )}
    </>
  );
}
