import { useEffect, useState } from "react";
import { PROJECT_META, type Project, type ProjectData } from "./types";
import { catColor, catName } from "../shared/categories";
import { FileText } from "../shared/icons";
import { useOptionalDecisions, useOptionalProjects, useOptionalGoals, useOptionalCategories } from "../data/NotesProvider";
import type { DecisionRecord } from "../decisions/types";
import type { Goal } from "../life/types";
import type { Category } from "../categories/types";
import { fmtDay } from "../decisions/DecisionsFlow";
import ChipPicker from "../shared/ChipPicker";
import { attemptWrite } from "../shared/guard";
import { capAfterNumber } from "../shared/casing";
import { areaFromTasks } from "./backfill";
import { haptics } from "../shared/haptics";

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

// The Decision Record payoff (Screen 04): the whole feature exists for this
// moment. You reopen the project six weeks later and the reason is sitting
// there before you can second-guess it. Deterministic lookup, newest live
// decision attached to this project; absent when there is none.
const FORK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
);

// A step: one of the project's own tasks, flattened by the caller so this
// page never touches a service to render its own contents.
export interface ProjectStep {
  id: string;
  text: string;
  done: boolean;
  due?: string | null;
  category?: string;
}

export default function ProjectDetailPage({
  project, onBack, onEdit, linkedNotes = [], onOpenNote, onOpenDecision, onChanged, onFinish,
  steps = [], onToggleStep, onAddStep, onOpenStep,
}: {
  project: Project;
  onBack: () => void;
  onEdit: () => void;
  linkedNotes?: { id: string; title: string; category: string }[];
  onOpenNote?: (id: string) => void;
  onOpenDecision?: (id: string) => void;
  onChanged?: () => void;
  onFinish?: () => void;
  // THE PROJECT'S OWN WORK (Dave, 2026-08-21: "improve how tasks, projects
  // and goals are tied together", and "some projects don't have all the
  // features"). A project page that does not show the project's tasks is a
  // filing card. The link existed in both directions in the data and was
  // rendered in neither: you could put a task in a project from the task
  // sheet and then never see it from the project again.
  steps?: ProjectStep[];
  onToggleStep?: (id: string) => void;
  onAddStep?: (text: string) => void;
  onOpenStep?: (id: string) => void;
}) {
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

  // Add a step without leaving the project. The task sheet asks for a
  // category, a due date, a repeat and a project; a step here needs a
  // sentence, and the project it belongs to is already known.
  const [newStep, setNewStep] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const openSteps = steps.filter((t) => !t.done);
  const doneSteps = steps.filter((t) => t.done);
  const addStep = () => {
    const text = newStep.trim();
    if (!text || !onAddStep) return;
    setNewStep("");
    haptics.selection();
    onAddStep(text);
  };

  const m = PROJECT_META[data.status];
  const hasCat = !!data.category;
  // The one inference worth making about an older project, and it is an
  // OFFER, not a repair: no Area of its own, but its own steps agree on one.
  // Never silent. An Area JARVIS chose and never mentioned is worse than no
  // Area, because he would find it later and not know who put it there.
  const guessedArea = hasCat ? null : areaFromTasks(steps);
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
        {/* Progress is the one number a project owes you, and it was nowhere
            on this page. A count, not a percentage: "5 of 9" is a fact you
            can act on, "56%" is a fact you can only feel. */}
        {steps.length > 0 && (
          <div className="proj-prog">
            <div className="proj-prog-bar"><span style={{ width: `${Math.round((doneSteps.length / steps.length) * 100)}%` }} /></div>
            <div className="conn-meta">{doneSteps.length} of {steps.length} done</div>
          </div>
        )}
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
        {guessedArea && (
          <div className="row proj-guess" role="button" tabIndex={0} onClick={() => saveField({ category: guessedArea })}>
            <div className="row-grow">
              <div className="conn-name">Set Area To {catName(guessedArea)}</div>
              <div className="conn-meta">Most of this project&rsquo;s steps are already there.</div>
            </div>
            <span className={"cat-dot cat-bg-" + catColor(guessedArea)} />
          </div>
        )}
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
      {/* THE STEPS. Open work first, finished work folded away behind its
          own count, and one field to add another. Tapping the check
          completes the task everywhere in the app, because it IS the task:
          there is no second copy of it living on this page. */}
      {(steps.length > 0 || onAddStep) && (
        <>
          <div className="grp"><div className="eyebrow">Steps</div></div>
          <div className="pad-x"><div className="card">
            {openSteps.map((t) => (
              <div className="row proj-step" key={t.id}>
                <div
                  className="task-check-tap"
                  role="checkbox"
                  aria-checked={false}
                  aria-label="Mark done"
                  onClick={() => { haptics.selection(); onToggleStep?.(t.id); }}
                >
                  <div className={"task-check " + (hasCat ? "cat-bd-" + catColor(data.category!) : "cat-bd-graphite")} />
                </div>
                <div className="row-grow" role={onOpenStep ? "button" : undefined} tabIndex={onOpenStep ? 0 : undefined}
                  onClick={onOpenStep ? () => onOpenStep(t.id) : undefined}>
                  <div className="conn-name">{t.text}</div>
                  {t.due && <div className="conn-meta">{fmtDay(t.due)}</div>}
                </div>
              </div>
            ))}
            {openSteps.length === 0 && steps.length > 0 && (
              <div className="row"><div className="row-grow"><div className="conn-meta">Every step is done.</div></div></div>
            )}
            {onAddStep && (
              <div className="row proj-add-step">
                <input
                  className="input proj-step-input"
                  placeholder="Add a Step"
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addStep(); }}
                />
                {newStep.trim() && <button className="pill-act" onClick={addStep}>Add</button>}
              </div>
            )}
          </div></div>
          {doneSteps.length > 0 && (
            <div className="pad-x proj-done-fold">
              <button className="quiet-action" onClick={() => setDoneOpen(!doneOpen)}>
                {doneOpen ? "Hide Finished" : capAfterNumber(`${doneSteps.length} finished`)}
              </button>
              {doneOpen && (
                <div className="card">
                  {doneSteps.map((t) => (
                    <div className="row proj-step completed" key={t.id}>
                      <div className="task-check-tap" role="checkbox" aria-checked aria-label="Mark not done"
                        onClick={() => { haptics.selection(); onToggleStep?.(t.id); }}>
                        <div className="task-check done" />
                      </div>
                      <div className="row-grow"><div className="conn-name">{t.text}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

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
      {/* FINISHING IT, WHERE IT LIVES (Dave 2026-08-20: "ability to complete
          projects and goals"). Until now the only way to finish a project was
          to open the edit sheet, find the status segmented control, tap Done,
          and Save: four taps through a form for the best moment the app has.
          Goals already had this button on their own page; projects had
          nothing. Hidden once done, because finishing is not a toggle. */}
      {onFinish && data.status !== "done" && (
        <div className="pad-x conn-action">
          <button className="btn btn-primary btn-block" onClick={onFinish}>Mark Done</button>
          {/* Says it, does not block it. Finishing a project with open steps
              is a normal thing to do (the steps stopped mattering), and an
              app that argues with you at the finish line is the reason
              nobody marks anything done. */}
          {openSteps.length > 0 && (
            <div className="conn-meta proj-finish-note">
              {capAfterNumber(openSteps.length === 1 ? "1 step is still open" : `${openSteps.length} steps are still open`)}
            </div>
          )}
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
