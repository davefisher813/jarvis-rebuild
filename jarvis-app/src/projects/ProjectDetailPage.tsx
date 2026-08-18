import { useEffect, useState } from "react";
import { PROJECT_META, type Project } from "./types";
import { catColor, catName } from "../shared/categories";
import { FileText } from "lucide-react";
import { useOptionalDecisions } from "../data/NotesProvider";
import type { DecisionRecord } from "../decisions/types";
import { fmtDay } from "../decisions/DecisionsFlow";

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

// The Decision Record payoff (Screen 04): the whole feature exists for this
// moment. You reopen the project six weeks later and the reason is sitting
// there before you can second-guess it. Deterministic lookup, newest live
// decision attached to this project; absent when there is none.
const FORK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
);

export default function ProjectDetailPage({ project, onBack, onEdit, linkedNotes = [], onOpenNote, onOpenDecision }: { project: Project; onBack: () => void; onEdit: () => void; linkedNotes?: { id: string; title: string; category: string }[]; onOpenNote?: (id: string) => void; onOpenDecision?: (id: string) => void }) {
  const m = PROJECT_META[project.data.status];
  const hasCat = !!project.data.category;
  const tag = hasCat ? catName(project.data.category!) : "";

  // Optional on purpose: outside NotesProvider (bench, component tests) the
  // banner simply does not exist.
  const decisions = useOptionalDecisions();
  const [decision, setDecision] = useState<DecisionRecord | null>(null);
  useEffect(() => {
    if (!decisions) return;
    let on = true;
    void decisions.getByLink("project", project.id).then((d) => { if (on) setDecision(d); });
    return () => { on = false; };
  }, [decisions, project.id]);

  return (
    <div className="screen">
      <div className="nav-bar"><button className="nav-back" aria-label="Back" onClick={onBack}></button><div className="nav-title">Project</div><button className="nav-action-text" onClick={onEdit}>Edit</button></div>
      <div className="pad-x"><div className="card proj-detail-hero">
        <div className={"proj-icon cat-bg-" + (hasCat ? catColor(project.data.category!) : "graphite")}>{initialOf(tag || project.data.title)}</div>
        <div className="proj-detail-title">{project.data.title}</div>
        <span className={"lm-qual lm-" + m.cls}>{m.label}</span>
      </div></div>
      {decision && (
        <div className="pad-x">
          <div className="promo-card" role={onOpenDecision ? "button" : undefined} tabIndex={onOpenDecision ? 0 : undefined}
            onClick={onOpenDecision ? () => onOpenDecision(decision.id) : undefined}>
            <div className="promo-head">
              <div className="promo-badge b-purple">{FORK}</div>
              <div className="promo-body">
                <div className="promo-title">{decision.data.decision}</div>
                <div className="promo-sub">{decision.data.why ? <>Because {decision.data.why} · Decided {fmtDay(decision.data.createdAt)}</> : <>No reason recorded · Decided {fmtDay(decision.data.createdAt)}</>}</div>
              </div>
              {onOpenDecision && <div className="chev promo-chev" />}
            </div>
          </div>
        </div>
      )}
      <div className="grp"><div className="eyebrow">Details</div></div>
      <div className="pad-x"><div className="card">
        <div className="row"><div className="row-grow"><div className="conn-name">Status</div></div><span className={"lm-qual lm-" + m.cls}>{m.label}</span></div>
        <div className="row"><div className="row-grow"><div className="conn-name">Area</div></div>
          {hasCat ? <span className="proj-detail-cat"><span className={"cat-dot cat-bg-" + catColor(project.data.category!)} />{tag}</span> : <span className="row-value">None</span>}</div>
      </div></div>
      {linkedNotes.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Linked Notes</div></div>
          <div className="pad-x"><div className="card">
            {linkedNotes.map((n) => (
              <div className="row" role={onOpenNote ? "button" : undefined} tabIndex={onOpenNote ? 0 : undefined} key={n.id} onClick={onOpenNote ? () => onOpenNote(n.id) : undefined}>
                <div className={"proj-icon cat-bg-" + (n.category ? catColor(n.category) : "graphite")}><FileText className="ic" /></div>
                <div className="conn-name">{n.title}</div>
                {onOpenNote && <div className="chev"></div>}
              </div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
