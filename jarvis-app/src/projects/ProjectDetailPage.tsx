import { useEffect, useState } from "react";
import { PROJECT_META, type Project, type ProjectData } from "./types";
import { catColor, catName } from "../shared/categories";
import { FileText } from "lucide-react";
import { useOptionalDecisions, useOptionalProjects, useOptionalGoals, useOptionalCategories } from "../data/NotesProvider";
import type { DecisionRecord } from "../decisions/types";
import type { Goal } from "../life/types";
import type { Category } from "../categories/types";
import { fmtDay } from "../decisions/DecisionsFlow";
import ChipPicker from "../shared/ChipPicker";
import { attemptWrite } from "../shared/guard";

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

// The Decision Record payoff (Screen 04): the whole feature exists for this
// moment. You reopen the project six weeks later and the reason is sitting
// there before you can second-guess it. Deterministic lookup, newest live
// decision attached to this project; absent when there is none.
const FORK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
);

export default function ProjectDetailPage({ project, onBack, onEdit, linkedNotes = [], onOpenNote, onOpenDecision, onChanged }: { project: Project; onBack: () => void; onEdit: () => void; linkedNotes?: { id: string; title: string; category: string }[]; onOpenNote?: (id: string) => void; onOpenDecision?: (id: string) => void; onChanged?: () => void }) {
  // SEAMLESS LINKING (Dave 2026-08-18): Area and Goal are chip-pickers IN
  // the detail card, the one-tap in-place edit from the editing law. Local
  // copy so the change reads instantly; onChanged refreshes the list behind.
  const [data, setData] = useState<ProjectData>(project.data);
  useEffect(() => { setData(project.data); }, [project.id, project.data]);
  const projectsSvc = useOptionalProjects();
  const goalsSvc = useOptionalGoals();
  const categoriesSvc = useOptionalCategories();
  const [goalList, setGoalList] = useState<Goal[]>([]);
  const [catList, setCatList] = useState<Category[]>([]);
  useEffect(() => {
    let on = true;
    void goalsSvc?.list().then((g) => { if (on) setGoalList(g); });
    void categoriesSvc?.list().then((c) => { if (on) setCatList(c); });
    return () => { on = false; };
  }, [goalsSvc, categoriesSvc]);
  const saveField = (patch: Partial<ProjectData>) => {
    setData((d) => ({ ...d, ...patch }));
    if (projectsSvc) void attemptWrite(() => projectsSvc.update(project.id, patch)).then(() => onChanged?.());
  };

  const m = PROJECT_META[data.status];
  const hasCat = !!data.category;
  const tag = hasCat ? catName(data.category!) : "";

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
        <div className={"proj-icon cat-bg-" + (hasCat ? catColor(data.category!) : "graphite")}>{initialOf(tag || data.title)}</div>
        <div className="proj-detail-title">{data.title}</div>
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
          {projectsSvc && catList.length > 0 ? (
            <ChipPicker
              ariaLabel="Area"
              value={data.category ?? ""}
              options={[{ value: "", label: "None" }, ...catList.map((c) => ({ value: c.id, label: c.data.name, dot: c.data.color }))]}
              onPick={(v) => saveField({ category: v || undefined })}
            />
          ) : hasCat ? <span className="proj-detail-cat"><span className={"cat-dot cat-bg-" + catColor(data.category!)} />{tag}</span> : <span className="row-value">None</span>}</div>
        <div className="row"><div className="row-grow"><div className="conn-name">Goal</div></div>
          {projectsSvc && goalList.length > 0 ? (
            <ChipPicker
              ariaLabel="Goal"
              value={data.goalId ?? ""}
              options={[{ value: "", label: "None" }, ...goalList.filter((g) => g.data.state !== "achieved").map((g) => ({ value: g.id, label: g.data.title }))]}
              onPick={(v) => saveField({ goalId: v || undefined })}
            />
          ) : <span className="row-value">{goalList.find((g) => g.id === data.goalId)?.data.title ?? "None"}</span>}</div>
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
