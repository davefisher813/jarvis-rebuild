import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjects, useCategories, useGoals, useTasks, useNotes } from "../data/NotesProvider";
import type { Project, ProjectData } from "../projects/types";
import type { Goal, GoalData } from "../life/types";
import type { Category } from "../categories/types";
import type { TaskItem } from "../tasks/TasksService";
import BiggerPicturePage from "./BiggerPicturePage";
import ProjectSheet from "../projects/ProjectSheet";
import ProjectDetailPage from "../projects/ProjectDetailPage";
import GoalSheet from "../life/GoalSheet";
import { rankProjects, goalProgress } from "./progress";
import GoalDetailPage from "./GoalDetailPage";
import { relatedProjectsForGoal, nextActionOf, isLinkDismissed, dismissLink } from "./related";
import { readSamples } from "../shared/timeSense";
import { usePushDepth } from "../shared/pushNav";
import { emit } from "../events";

type Sheet =
  | { kind: "closed" }
  | { kind: "newProject"; goalId?: string } // contextual add: born linked
  | { kind: "editProject"; id: string }
  | { kind: "newGoal" }
  | { kind: "editGoal"; id: string };

// One surface for goals and projects. Replaces LifeMapFlow and ProjectsFlow.
export default function BiggerPictureFlow({ openId, onOpenNote }: { openId?: string; onOpenNote?: (id: string) => void } = {}) {
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
  const [detailId, setDetailId] = useState<string | null>(openId ?? null);
  const [goalDetailId, setGoalDetailId] = useState<string | null>(null);
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

  const saveProject = async (d: ProjectData) => {
    if (sheet.kind === "newProject") await projectsSvc.create(d);
    else if (sheet.kind === "editProject") await projectsSvc.update(sheet.id, d);
    setSheet({ kind: "closed" });
    await reload();
  };
  const saveGoal = async (d: GoalData) => {
    if (sheet.kind === "newGoal") await goalsSvc.create(d);
    else if (sheet.kind === "editGoal") await goalsSvc.update(sheet.id, d);
    setSheet({ kind: "closed" });
    await reload();
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
          onBack={() => setDetailId(null)}
          onEdit={() => setSheet({ kind: "editProject", id: detail.id })}
        />
        {sheet.kind === "editProject" && (
          <ProjectSheet
            mode="edit"
            categories={categories}
            goals={goals}
            initial={editingProject?.data}
            onSave={saveProject}
            onDelete={async () => { await projectsSvc.remove(sheet.id); setSheet({ kind: "closed" }); setDetailId(null); await reload(); }}
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
          onOpenProject={(id) => setDetailId(id)}
          onAddProject={() => setSheet({ kind: "newProject", goalId: goalDetail.id })}
          onLinkSuggestion={(id) => void linkSuggestion(id)}
          onDismissSuggestion={dismissSuggestion}
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
            onDelete={async () => { await goalsSvc.remove(sheet.id); setSheet({ kind: "closed" }); setGoalDetailId(null); await reload(); }}
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
          onDelete={sheet.kind === "editProject" ? async () => { await projectsSvc.remove(sheet.id); setSheet({ kind: "closed" }); await reload(); } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
      {(sheet.kind === "newGoal" || sheet.kind === "editGoal") && (
        <GoalSheet
          mode={sheet.kind === "newGoal" ? "new" : "edit"}
          initial={editingGoal?.data}
          onSave={saveGoal}
          onDelete={sheet.kind === "editGoal" ? async () => { await goalsSvc.remove(sheet.id); setSheet({ kind: "closed" }); await reload(); } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
    </>
  );
}
