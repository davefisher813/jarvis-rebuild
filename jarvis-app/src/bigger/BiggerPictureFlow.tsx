import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjects, useCategories, useGoals, useTasks, useNotes } from "../data/NotesProvider";
import type { Project, ProjectData } from "../projects/types";
import type { Goal, GoalData } from "../life/types";
import type { Category } from "../categories/types";
import type { TaskItem } from "../tasks/TasksService";
import BiggerPicturePage from "./BiggerPicturePage";
import Payoff, { payoffLine } from "../shared/Payoff";
import ProjectSheet from "../projects/ProjectSheet";
import ProjectDetailPage from "../projects/ProjectDetailPage";
import { attemptWrite } from "../shared/guard";
import GoalSheet from "../life/GoalSheet";
import { rankProjects, goalProgress } from "./progress";
import GoalDetailPage from "./GoalDetailPage";
import { relatedProjectsForGoal, nextActionOf, isLinkDismissed, dismissLink } from "./related";
import { stalledCandidate, dismissProjStep } from "./stalled";
import { readSamples } from "../shared/timeSense";
import { usePushDepth } from "../shared/pushNav";
import { emit } from "../events";
import { useAI } from "../ai/useAI";
import { useAIContext } from "../ai/useAIContext";
import { identityToText } from "../ai/context";
import { firstStepPrompt, parseFirstStep } from "../tasks/firstStep";
import { showToast } from "../shared/toast";
import { todayISO } from "../tasks/grouping";

type Sheet =
  | { kind: "closed" }
  | { kind: "newProject"; goalId?: string } // contextual add: born linked
  | { kind: "editProject"; id: string }
  | { kind: "newGoal" }
  | { kind: "editGoal"; id: string };

// One surface for goals and projects. Replaces LifeMapFlow and ProjectsFlow.
// openGoalId (2026-08-09): goal deep-links used to be set by the shell and
// then dropped on the floor here, so tapping a linked goal landed on the
// list instead of the goal.
export default function BiggerPictureFlow({ openId, openGoalId, onOpenNote, onOpenDecision }: { openId?: string; openGoalId?: string; onOpenNote?: (id: string) => void; onOpenDecision?: (id: string) => void } = {}) {
  const projectsSvc = useProjects();
  const goalsSvc = useGoals();
  const catsSvc = useCategories();
  const tasksSvc = useTasks();
  const notesSvc = useNotes();

  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [payoff, setPayoff] = useState<{ kind: "project" | "goal"; title: string; line: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(openId ?? null);
  const [goalDetailId, setGoalDetailId] = useState<string | null>(openGoalId ?? null);
  // Bumps after a dismissal so the derived suggestion re-reads storage.
  const [dismissTick, setDismissTick] = useState(0);
  const [linkedNotes, setLinkedNotes] = useState<{ id: string; title: string; category: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [p, g, c, t] = await Promise.all([
      projectsSvc.list(), goalsSvc.list(), catsSvc.list(), tasksSvc.listTasks(),
    ]);
    setProjects(p); setGoals(g); setCategories(c); setTasks(t); setLoading(false);
  }, [projectsSvc, goalsSvc, catsSvc, tasksSvc]);
  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!detailId) { setLinkedNotes([]); return; }
    let on = true;
    notesSvc.notesLinkedTo(detailId).then((n) => { if (on) setLinkedNotes(n); });
    return () => { on = false; };
  }, [detailId, notesSvc]);

  usePushDepth(detailId ? 2 : goalDetailId ? 1 : 0);

  // Derived, never self-reported. Samples are read once per render pass.
  const samples = useMemo(() => readSamples(), [tasks]);
  const projectRows = useMemo(
    () => rankProjects(projects, tasks, samples, Date.now()),
    [projects, tasks, samples],
  );
  const goalProgressOf = useCallback(
    (id: string) => goalProgress(tasks, projects, id),
    [tasks, projects],
  );

  const detail = detailId ? projects.find((p) => p.id === detailId) : undefined;
  const editingProject = sheet.kind === "editProject" ? projects.find((p) => p.id === sheet.id) : undefined;
  const editingGoal = sheet.kind === "editGoal" ? goals.find((g) => g.id === sheet.id) : undefined;

  // Stalled-project First Step (6.7): an active project with nothing open
  // under it is stuck by definition. One offer at a time; dismissals stay
  // quiet for 7 days; AI drafts the smallest opening move, accepting creates
  // it born-linked and due today.
  const ai = useAI();
  const gatherContext = useAIContext();
  const today = todayISO();
  const [projStep, setProjStep] = useState<{ projectId: string; step: string } | null>(null);
  const [projStepBusy, setProjStepBusy] = useState(false);
  const stalled = useMemo(
    () => (ai.available && !loading ? stalledCandidate(projects, tasks, today) : null),
    // dismissTick re-reads dismissal storage after Not Now
    [ai.available, loading, projects, tasks, today, dismissTick],
  );
  const projStepAsk = async () => {
    if (!stalled || projStepBusy) return;
    setProjStepBusy(true);
    try {
      // Same shared prompt as the task-level First Step in TasksFlow: one
      // feature, one wording, one system prompt (Phase 3). Context failure
      // must not block the offer.
      const identity = await gatherContext().then(identityToText).catch(() => "");
      const p = firstStepPrompt(stalled.data.title, "project", identity);
      const step = parseFirstStep(await ai.complete([{ role: "user", content: p.user }], p.system));
      if (!step) throw new Error("empty");
      setProjStep({ projectId: stalled.id, step });
    } catch {
      showToast({ message: "Couldn't reach JARVIS" });
    } finally {
      setProjStepBusy(false);
    }
  };
  // B12 (2026-08-24): fires once. The busy flag is shared with First Step's
  // ask, so it must ALWAYS release: an early return that kept it set would
  // dead-lock the sibling button, which is worse than the double write.
  const projStepAccept = async () => {
    if (projStepBusy || !projStep || !stalled || projStep.projectId !== stalled.id) return;
    setProjStepBusy(true);
    try {
      await tasksSvc.createTask(projStep.step, { projectId: stalled.id, category: stalled.data.category || undefined, due: today });
      dismissProjStep(stalled.id, today);
      setProjStep(null);
      setDismissTick((n) => n + 1);
      emit({ type: "suggestion.accepted", props: { kind: "proj_step" } });
      await reload();
      showToast({ message: "First step on Today" });
    } finally {
      setProjStepBusy(false);
    }
  };
  const projStepDismiss = () => {
    if (!stalled) return;
    dismissProjStep(stalled.id, today);
    setProjStep(null);
    setDismissTick((n) => n + 1);
    emit({ type: "suggestion.dismissed", props: { kind: "proj_step" } });
  };
  // Catalog V4: banners are promo cards. Amber badge = stalled work.
  const stalledOffer = stalled ? (
    <div className="pad-x">
      <div className="promo-card">
        <div className="promo-head">
          <div className="promo-badge b-amber">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>
          </div>
          <div className="promo-body">
            <div className="promo-title">{stalled.data.title}</div>
            <div className="promo-sub">{projStep && projStep.projectId === stalled.id ? <>Start with: {projStep.step}</> : "Nothing is moving here."}</div>
          </div>
        </div>
        {projStep && projStep.projectId === stalled.id ? (
          <div className="promo-acts">
            <button className="promo-pill quiet" onClick={projStepDismiss}>Not Now</button>
            <button className="promo-pill" disabled={projStepBusy} onClick={() => void projStepAccept()}>{projStepBusy ? "Adding..." : "Add This Step"}</button>
          </div>
        ) : (
          <div className="promo-acts">
            <button className="promo-pill quiet" onClick={projStepDismiss}>Not Now</button>
            <button className="promo-pill" onClick={() => void projStepAsk()} disabled={projStepBusy}>{projStepBusy ? "Thinking..." : "First Step"}</button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  // Finishing something big earns a moment. Only on the TRANSITION into done:
  // saving an already-finished project must not re-congratulate anyone.
  // B10/B12 (2026-08-23): DELETING SOMETHING SHOULD NOT BE SILENT AND SHOULD
  // NOT BE FINAL.
  //
  // These four call sites did `await svc.remove(id)` and closed the sheet.
  // No attemptWrite, so a failed delete was completely invisible AND the
  // sheet closed anyway, which reads as success. No undo, on a record that
  // took real thought to write. Deleting a project also orphans every task
  // pointing at it, and deleting a goal orphans its projects.
  //
  // The shape is DecisionsFlow's, which already got this right: snapshot the
  // data, guard the write, and hand back an Undo that recreates it. The
  // recreated record gets a NEW id, so anything that referenced the old one
  // stays orphaned; the toast promises a restore of the record, never of its
  // links, and the copy says so.
  const removeWithUndo = async (
    kind: "project" | "goal",
    id: string,
    close: () => void,
  ) => {
    const svc = kind === "project" ? projectsSvc : goalsSvc;
    const kept = (kind === "project" ? projects : goals).find((x) => x.id === id)?.data;
    const ok = await attemptWrite(() => svc.remove(id));
    if (!ok) return; // attemptWrite already said what went wrong; sheet stays open
    close();
    await reload();
    if (!kept) return;
    showToast({
      message: kind === "project" ? "Project deleted" : "Goal deleted",
      actionLabel: "Undo",
      onAction: () => void (async () => {
        await attemptWrite(() => svc.create(kept as never));
        await reload();
      })(),
    });
  };

  const saveProject = async (d: ProjectData) => {
    const was = sheet.kind === "editProject" ? projects.find((p) => p.id === sheet.id)?.data.status : undefined;
    if (sheet.kind === "newProject") await projectsSvc.create(d);
    else if (sheet.kind === "editProject") await projectsSvc.update(sheet.id, d);
    setSheet({ kind: "closed" });
    await reload();
    if (d.status === "done" && was !== "done" && sheet.kind === "editProject") {
      const mine = tasks.filter((t) => (t.data as { projectId?: string }).projectId === sheet.id);
      setPayoff({
        kind: "project",
        title: d.title,
        line: payoffLine({ tasksDone: mine.filter((t) => (t.data as { done?: boolean }).done).length }),
      });
    }
  };
  const saveGoal = async (d: GoalData) => {
    const was = sheet.kind === "editGoal" ? goals.find((g) => g.id === sheet.id)?.data.state : undefined;
    if (sheet.kind === "newGoal") await goalsSvc.create(d);
    else if (sheet.kind === "editGoal") await goalsSvc.update(sheet.id, d);
    setSheet({ kind: "closed" });
    await reload();
    if (d.state === "achieved" && was !== "achieved" && sheet.kind === "editGoal") {
      const mine = projects.filter((p) => p.data.goalId === sheet.id);
      const ids = new Set(mine.map((p) => p.id));
      setPayoff({
        kind: "goal",
        title: d.title,
        line: payoffLine({
          projectsDone: mine.filter((p) => p.data.status === "done").length,
          tasksDone: tasks.filter((t) => {
            const pid = (t.data as { projectId?: string }).projectId;
            return !!pid && ids.has(pid) && (t.data as { done?: boolean }).done === true;
          }).length,
        }),
      });
    }
  };

  // ---- Goal detail (Session 6.6): the goal as a place ----
  const goalDetail = goalDetailId ? goals.find((g) => g.id === goalDetailId) : undefined;
  const goalProjects = goalDetail ? projects.filter((p) => p.data.goalId === goalDetail.id) : [];
  const nextActionTextOf = useCallback(
    (projectId: string) => nextActionOf(tasks, projectId)?.data.text ?? null,
    [tasks],
  );
  // At most ONE suggestion, strongest overlap, permanent dismissals honored.
  const goalSuggestion = useMemo(() => {
    void dismissTick; // re-derive after a dismissal
    if (!goalDetail) return null;
    return relatedProjectsForGoal(goalDetail, projects).find((p) => !isLinkDismissed(goalDetail.id, p.id)) ?? null;
  }, [goalDetail, projects, dismissTick]);

  // The payoff takeover renders BELOW every hook (hotfix 2026-08-15): it
  // briefly sat above the two hooks up top, which meant completing a project
  // or goal rendered fewer hooks, and dismissing the payoff rendered more:
  // React #310, app-wide crash. Same class as the TodayFlow loading return;
  // both are now pinned by the rules-of-hooks lint gate.
  if (payoff) {
    return (
      <Payoff kind={payoff.kind} title={payoff.title} line={payoff.line || undefined} onDone={() => setPayoff(null)} />
    );
  }

  const linkSuggestion = async (projectId: string) => {
    if (!goalDetail) return;
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;
    await projectsSvc.update(projectId, { ...proj.data, goalId: goalDetail.id });
    emit({ type: "suggestion.accepted", entityType: "project", entityId: projectId, props: { kind: "link" } });
    await reload();
  };
  const dismissSuggestion = (projectId: string) => {
    if (!goalDetail) return;
    dismissLink(goalDetail.id, projectId);
    emit({ type: "suggestion.dismissed", entityType: "project", entityId: projectId, props: { kind: "link" } });
    setDismissTick((t) => t + 1);
  };

  if (detail) {
    return (
      <>
        <ProjectDetailPage
          project={detail}
          linkedNotes={linkedNotes}
          onOpenNote={onOpenNote}
          onOpenDecision={onOpenDecision}
          onChanged={() => void reload()}
          onBack={() => setDetailId(null)}
          onEdit={() => setSheet({ kind: "editProject", id: detail.id })}
          steps={tasks
            .filter((t) => t.data.projectId === detail.id)
            .map((t) => ({ id: t.id, text: t.data.text, done: !!t.data.done, due: t.data.due ?? null, category: t.data.category }))}
          onToggleStep={async (id) => { await attemptWrite(() => tasksSvc.toggleDone(id)); await reload(); }}
          onAddStep={async (text) => {
            // The step is born into the project AND its area, because a task
            // created from inside a project already answered both questions.
            await attemptWrite(() => tasksSvc.createTask(text, {
              projectId: detail.id,
              category: detail.data.category || undefined,
            }));
            await reload();
          }}
          onFinish={async () => {
            const p = detail;
            await attemptWrite(() => projectsSvc.update(p.id, { ...p.data, status: "done" }));
            await reload();
            const mine = tasks.filter((t) => (t.data as { projectId?: string }).projectId === p.id);
            setDetailId(null);
            setPayoff({
              kind: "project",
              title: p.data.title,
              line: payoffLine({ tasksDone: mine.filter((t) => (t.data as { done?: boolean }).done).length }),
            });
          }}
        />
        {sheet.kind === "editProject" && (
          <ProjectSheet
            mode="edit"
            categories={categories}
            goals={goals}
            initial={editingProject?.data}
            onSave={saveProject}
            onDelete={() => removeWithUndo("project", sheet.id, () => { setSheet({ kind: "closed" }); setDetailId(null); })}
            onCancel={() => setSheet({ kind: "closed" })}
          />
        )}
      </>
    );
  }

  if (goalDetail && !detail) {
    return (
      <>
        <GoalDetailPage
          goal={goalDetail}
          progress={goalProgressOf(goalDetail.id)}
          projects={goalProjects}
          nextActionTextOf={nextActionTextOf}
          suggestion={goalSuggestion}
          onBack={() => setGoalDetailId(null)}
          onEdit={() => setSheet({ kind: "editGoal", id: goalDetail.id })}
          onAchieve={async () => {
            const g = goalDetail;
            await goalsSvc.update(g.id, { ...g.data, state: "achieved" });
            await reload();
            const mine = projects.filter((p) => p.data.goalId === g.id);
            const ids = new Set(mine.map((p) => p.id));
            setGoalDetailId(null);
            setPayoff({
              kind: "goal",
              title: g.data.title,
              line: payoffLine({
                projectsDone: mine.filter((p) => p.data.status === "done").length,
                tasksDone: tasks.filter((t) => {
                  const pid = (t.data as { projectId?: string }).projectId;
                  return !!pid && ids.has(pid) && (t.data as { done?: boolean }).done === true;
                }).length,
              }),
            });
          }}
          onOpenProject={(id) => setDetailId(id)}
          onAddProject={() => setSheet({ kind: "newProject", goalId: goalDetail.id })}
          onLinkSuggestion={(id) => void linkSuggestion(id)}
          onDismissSuggestion={dismissSuggestion}
          onAddSavings={async (amount) => {
            // Dated entry, derived progress. Only real logged money ever
            // lands here (never skipped purchases: Money v1 law).
            const d = new Date().toISOString().slice(0, 10);
            await goalsSvc.update(goalDetail.id, { saved: [...(goalDetail.data.saved ?? []), { d, amount }] });
            await reload();
          }}
        />
        {(sheet.kind === "newProject" || sheet.kind === "editGoal") && sheet.kind === "newProject" && (
          <ProjectSheet
            mode="new"
            categories={categories}
            goals={goals}
            initial={{ goalId: sheet.goalId }}
            onSave={saveProject}
            onCancel={() => setSheet({ kind: "closed" })}
          />
        )}
        {sheet.kind === "editGoal" && (
          <GoalSheet
            mode="edit"
            initial={editingGoal?.data}
            onSave={saveGoal}
            onDelete={() => removeWithUndo("goal", sheet.id, () => { setSheet({ kind: "closed" }); setGoalDetailId(null); })}
            onCancel={() => setSheet({ kind: "closed" })}
          />
        )}
      </>
    );
  }

  return (
    <>
      <BiggerPicturePage
        goals={goals}
        goalProgressOf={goalProgressOf}
        projectRows={projectRows}
        loading={loading}
        offer={stalledOffer}
        nextActionTextOf={nextActionTextOf}
        // Single-goal default: with exactly one goal, a new project starts
        // linked to it, visibly, one tap to undo in the sheet. A default, not
        // a hidden action.
        onAddProject={() => setSheet({ kind: "newProject", goalId: goals.length === 1 ? goals[0]!.id : undefined })}
        onOpenProject={(id) => setDetailId(id)}
        onAddGoal={() => setSheet({ kind: "newGoal" })}
        onOpenGoal={(id) => setGoalDetailId(id)}
      />
      {(sheet.kind === "newProject" || sheet.kind === "editProject") && (
        <ProjectSheet
          mode={sheet.kind === "newProject" ? "new" : "edit"}
          categories={categories}
          goals={goals}
          initial={sheet.kind === "newProject" ? { goalId: sheet.goalId } : editingProject?.data}
          onSave={saveProject}
          onDelete={sheet.kind === "editProject" ? () => removeWithUndo("project", sheet.id, () => setSheet({ kind: "closed" })) : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
      {(sheet.kind === "newGoal" || sheet.kind === "editGoal") && (
        <GoalSheet
          mode={sheet.kind === "newGoal" ? "new" : "edit"}
          initial={editingGoal?.data}
          onSave={saveGoal}
          onDelete={sheet.kind === "editGoal" ? () => removeWithUndo("goal", sheet.id, () => setSheet({ kind: "closed" })) : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
    </>
  );
}
