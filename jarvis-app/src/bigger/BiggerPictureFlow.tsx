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
import { readSamples } from "../shared/timeSense";
import { usePushDepth } from "../shared/pushNav";

type Sheet = { kind: "closed" } | { kind: "newProject" } | { kind: "editProject"; id: string } | { kind: "newGoal" } | { kind: "editGoal"; id: string };

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

  usePushDepth(detailId ? 1 : 0);

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

  return (
    <>
      <BiggerPicturePage
        goals={goals}
        goalProgressOf={goalProgressOf}
        projectRows={projectRows}
        loading={loading}
        onAddProject={() => setSheet({ kind: "newProject" })}
        onOpenProject={(id) => setDetailId(id)}
        onAddGoal={() => setSheet({ kind: "newGoal" })}
        onOpenGoal={(id) => setSheet({ kind: "editGoal", id })}
      />
      {(sheet.kind === "newProject" || sheet.kind === "editProject") && (
        <ProjectSheet
          mode={sheet.kind === "newProject" ? "new" : "edit"}
          categories={categories}
          goals={goals}
          initial={editingProject?.data}
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
