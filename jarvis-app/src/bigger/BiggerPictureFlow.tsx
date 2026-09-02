import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjects, useCategories, useGoals, useTasks, useNotes, useDecisions } from "../data/NotesProvider";
import type { Project, ProjectData } from "../projects/types";
import type { Goal, GoalData } from "../life/types";
import { goalEvidenceDays, comebackLine, heavyWord } from "../review/life";
import type { Category } from "../categories/types";
import type { TaskItem } from "../tasks/TasksService";
import BiggerPicturePage from "./BiggerPicturePage";
import Payoff, { payoffLine } from "../shared/Payoff";
import ProjectSheet from "../projects/ProjectSheet";
import TaskSheet, { type TaskDraft } from "../tasks/screens/TaskSheet";
import ProjectDetailPage from "../projects/ProjectDetailPage";
import { attemptWrite } from "../shared/guard";
import GoalSheet from "../life/GoalSheet";
import { rankProjects } from "./progress";
import { reachOf, type GoalReach } from "./reach";
import { measureState, paceLine, healthOf, HEALTH_LABEL, type MeasureContext } from "./measure";
import { learnedDurations, readCommittedDurations } from "../schedule/learnedDurations";
import { holdLine, sizeOf, sizeLine } from "../projects/shape";
import { openWorkOf } from "../today/goalPulse";
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
import { TargetGlyph } from "../shared/glyphs";

// Hoisted: a fresh object per render would make every consumer's memo stale.
const EMPTY_REACH: GoalReach = { filedIds: [], taggedIds: [], openTagged: 0, progress: null };

type Sheet =
  | { kind: "closed" }
  | { kind: "newProject"; goalId?: string } // contextual add: born linked
  | { kind: "editProject"; id: string }
  | { kind: "newGoal" }
  | { kind: "editGoal"; id: string }
  // A project STEP is a task. The row had a whole button branch waiting for a
  // handler that no caller ever passed (2026-08-24 audit), so you could tick a
  // step off and never open it.
  | { kind: "editStep"; id: string };

// One surface for goals and projects. Replaces LifeMapFlow and ProjectsFlow.
// openGoalId (2026-08-09): goal deep-links used to be set by the shell and
// then dropped on the floor here, so tapping a linked goal landed on the
// list instead of the goal.
export default function BiggerPictureFlow({ openId, openGoalId, onOpenNote, onOpenDecision, lens = "goals", title, segments }: {
  openId?: string; openGoalId?: string; onOpenNote?: (id: string) => void; onOpenDecision?: (id: string) => void;
  // LIFE (2026-09-01): which zoom level this render is, and the head it
  // wears when it is a segment of the Life tab. See BiggerPicturePage.
  lens?: "projects" | "goals"; title?: string; segments?: ReactNode;
} = {}) {
  const projectsSvc = useProjects();
  const goalsSvc = useGoals();
  const catsSvc = useCategories();
  const tasksSvc = useTasks();
  const notesSvc = useNotes();
  const decisionsSvc = useDecisions();

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
  // PICK 22: the SAME learned per-category durations Plan My Day places
  // blocks with, so a project's stated size and its calendar footprint can
  // never tell two different stories.
  const estimates = useMemo(() => learnedDurations(readCommittedDurations(), Date.now()), [tasks]);
  const estimateFor = useCallback((cat: string) => estimates[cat] ?? 45, [estimates]);
  const projectRows = useMemo(
    () => rankProjects(projects, tasks, samples, Date.now()),
    [projects, tasks, samples],
  );
  // ARCHITECTURE C: one derivation per goal, memoised across the page and the
  // detail view so the list row and the hero can never disagree.
  const reachCache = useMemo(() => {
    const m = new Map<string, ReturnType<typeof reachOf>>();
    for (const g of goals) m.set(g.id, reachOf(tasks, projects, g));
    return m;
  }, [goals, tasks, projects]);
  const reachOfGoal = useCallback(
    (id: string) => reachCache.get(id) ?? EMPTY_REACH,
    [reachCache],
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
  // The double-write B12 tolerated became visible (Dave 2026-08-26: "Update
  // workout feature" twice on Today). Accepting a step that already exists
  // open on the project is a no-op create; everything else about the accept
  // (dismissal, event, receipt) still runs, so the button never dead-ends.
  const stepExists = (text: string, projectId: string) =>
    tasks.some((t) => !t.data.done && t.data.projectId === projectId && t.data.text.trim().toLowerCase() === text.trim().toLowerCase());
  const projStepAccept = async () => {
    if (projStepBusy || !projStep || !stalled || projStep.projectId !== stalled.id) return;
    setProjStepBusy(true);
    try {
      if (!stepExists(projStep.step, stalled.id)) await tasksSvc.createTask(projStep.step, { projectId: stalled.id, category: stalled.data.category || undefined, due: today });
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
  // PICK 21: the same offer, aimed at the project he is LOOKING AT rather
  // than the one the list picked. Separate state deliberately: the two offers
  // can be on screen in the same session and must not overwrite each other.
  const [openStep, setOpenStep] = useState<{ projectId: string; step: string } | null>(null);
  const [openStepBusy, setOpenStepBusy] = useState(false);
  const openStepAsk = async (proj: Project) => {
    if (openStepBusy) return;
    setOpenStepBusy(true);
    try {
      const identity = await gatherContext().then(identityToText).catch(() => "");
      const p = firstStepPrompt(proj.data.title, "project", identity);
      const step = parseFirstStep(await ai.complete([{ role: "user", content: p.user }], p.system));
      if (!step) throw new Error("empty");
      setOpenStep({ projectId: proj.id, step });
    } catch {
      showToast({ message: "Couldn't reach JARVIS" });
    } finally {
      setOpenStepBusy(false);
    }
  };
  const openStepAccept = async (proj: Project) => {
    if (openStepBusy || !openStep || openStep.projectId !== proj.id) return;
    setOpenStepBusy(true);
    try {
      if (!stepExists(openStep.step, proj.id)) {
        await attemptWrite(() => tasksSvc.createTask(openStep.step, {
          projectId: proj.id, category: proj.data.category || undefined, due: today,
        }));
      }
      setOpenStep(null);
      emit({ type: "suggestion.accepted", props: { kind: "proj_step" } });
      await reload();
      showToast({ message: "First step on Today" });
    } finally {
      setOpenStepBusy(false);
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
            <TargetGlyph />
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

  // ---- The life frame (merged here 2026-08-26; model in review/life.ts) ----
  const evidenceOf = useCallback(
    (g: Goal) => goalEvidenceDays(g, reachOfGoal(g.id), samples),
    [reachOfGoal, samples],
  );
  // THE AREA-PULSE MACHINERY IS RETIRED WITH THE ENTITY (2026-08-29, the
  // unification). evidenceByArea / starvedArea / areaWordOf / the quiet-area
  // card all rode life_area, which nothing else in the app pointed at and
  // no onboarding ever created. The goal-level pulse (extraOf, comeback and
  // heavy words) survives untouched -- it was always derived per goal.
  // update() resolving false means the row is gone (a stale cache id): a
  // failed save to the person tapping, so it throws into the guard.
  const mustUpdate = async (p: Promise<boolean>) => { if (!(await p)) throw new Error("row missing"); };
  // THE ONE ASK. The quiet-area card retired with the area entity; the
  // stalled project is the ask now, still at most one.
  const oneAsk = stalledOffer;

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
  // PICKS 13/14/15: one context, one derivation, handed to the page whole.
  const measureCtxFor = useCallback((g: Goal): MeasureContext => ({
    reach: reachOfGoal(g.id),
    tasks,
    projects: projects.filter((p) => p.data.goalId === g.id),
    samples,
    today,
    now: Date.now(),
  }), [reachOfGoal, tasks, projects, samples, today]);
  const goalMeasure = goalDetail ? measureState(goalDetail.data.measure, measureCtxFor(goalDetail)) : null;
  // The one extra word a goal row wears on Your Life (picks 17/18): a
  // comeback leads as a win, effort without movement reads as weight, and
  // only then does a bare Behind or Idle speak.
  const extraOf = useCallback((id: string): { text: string; tone: "good" | "warn" } | null => {
    const g = goals.find((x) => x.id === id);
    if (!g) return null;
    const cb = comebackLine(evidenceOf(g), today);
    if (cb) return { text: cb, tone: "good" };
    const c = measureCtxFor(g);
    const h = healthOf(g, measureState(g.data.measure, c), g.data.measure, c, openWorkOf(reachOfGoal(id)));
    const heavy = heavyWord(h, openWorkOf(reachOfGoal(id)) > 0);
    if (heavy) return { text: heavy, tone: "warn" };
    if (h === "behind" || h === "idle") return { text: HEALTH_LABEL[h], tone: "warn" };
    return null;
  }, [goals, evidenceOf, measureCtxFor, reachOfGoal, today]);
  // PICK 17: the drop writes the decision FIRST, then marks the goal. Order
  // matters for the same reason the meeting booking's does: a goal marked
  // dropped with no record of why is exactly the state this feature exists
  // to prevent, and it is the unrecoverable half.
  const dropGoal = async (g: Goal, why: string) => {
    const decisionId = await decisionsSvc.create({
      decision: "Dropped " + g.data.title,
      ...(why ? { why } : {}),
      linkedType: "goal", linkedId: g.id, linkedLabel: g.data.title,
    });
    const ok = await attemptWrite(() => goalsSvc.update(g.id, { ...g.data, dropped: { on: today, ...(decisionId ? { decisionId } : {}) } }));
    if (!ok) return;
    setGoalDetailId(null);
    await reload();
    showToast({ message: decisionId ? "Dropped · The reason is in your decisions" : "Dropped" });
  };
  const goalProjects = goalDetail ? projects.filter((p) => p.data.goalId === goalDetail.id) : [];
  // The watched work, flattened for the page. Same records, seen through the
  // goal's areas: ticking one here finishes the task everywhere.
  const goalTagged = useMemo(() => {
    if (!goalDetail) return [];
    const ids = new Set(reachOfGoal(goalDetail.id).taggedIds);
    return tasks.filter((t) => ids.has(t.id)).map((t) => ({
      id: t.id, text: t.data.text, done: !!t.data.done, due: t.data.due ?? null, category: t.data.category,
    }));
  }, [goalDetail, reachOfGoal, tasks]);
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
          estimateFor={estimateFor}
          today={today}
          onAddNote={onOpenNote ? () => void (async () => {
            // PICK 27: born connected, then opened. The title is the project's
            // own, because a note you have to name before you can write it is
            // a note that does not get written; renaming it is one tap in the
            // editor he is already looking at.
            const id = await attemptWrite(() => notesSvc.createNote(
              detail.data.title,
              detail.data.category ?? "",
              [{ id: "proj-" + detail.id, kind: "project", label: detail.data.title, targetId: detail.id }],
            ));
            if (typeof id === "string") onOpenNote(id);
          })() : undefined}
          firstStep={ai.available ? (
            <div className="pad-x">
              <div className="promo-card">
                <div className="promo-head">
                  <div className="promo-badge b-amber"><TargetGlyph /></div>
                  <div className="promo-body">
                    <div className="promo-title">Nothing In It Yet</div>
                    <div className="promo-sub">{openStep && openStep.projectId === detail.id ? <>Start with: {openStep.step}</> : "One small opening move is enough."}</div>
                  </div>
                </div>
                <div className="promo-acts">
                  {openStep && openStep.projectId === detail.id ? (
                    <>
                      <button className="promo-pill quiet" onClick={() => setOpenStep(null)}>Not That</button>
                      <button className="promo-pill" disabled={openStepBusy} onClick={() => void openStepAccept(detail)}>{openStepBusy ? "Adding..." : "Add This Step"}</button>
                    </>
                  ) : (
                    <button className="promo-pill" disabled={openStepBusy} onClick={() => void openStepAsk(detail)}>{openStepBusy ? "Thinking..." : "First Step"}</button>
                  )}
                </div>
              </div>
            </div>
          ) : undefined}
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
          onOpenStep={(id) => setSheet({ kind: "editStep", id })}
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
        {sheet.kind === "editStep" && (() => {
          const t = tasks.find((x) => x.id === sheet.id);
          if (!t) return null;
          return (
            <TaskSheet
              mode="edit"
              categories={categories.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }))}
              initial={{ text: t.data.text, category: t.data.category ?? "", due: t.data.due ?? undefined }}
              onSave={async (d: TaskDraft) => {
                const id = sheet.id;
                await attemptWrite(async () => {
                  await tasksSvc.editText(id, d.text);
                  await tasksSvc.setDue(id, d.due ?? null);
                  await tasksSvc.setCategory(id, d.category);
                });
                setSheet({ kind: "closed" });
                await reload();
              }}
              onDelete={async () => {
                const id = sheet.id;
                const kept = t.data;
                const ok = await attemptWrite(() => tasksSvc.deleteTask(id));
                setSheet({ kind: "closed" });
                await reload();
                if (!ok) return;
                showToast({
                  message: "Step deleted",
                  actionLabel: "Undo",
                  onAction: () => void (async () => {
                    await attemptWrite(() => tasksSvc.createTask(kept.text, {
                      projectId: kept.projectId, category: kept.category, due: kept.due ?? null,
                    }));
                    await reload();
                  })(),
                });
              }}
              onCancel={() => setSheet({ kind: "closed" })}
            />
          );
        })()}
      </>
    );
  }

  if (goalDetail && !detail) {
    return (
      <>
        <GoalDetailPage
          goal={goalDetail}
          reach={reachOfGoal(goalDetail.id)}
          measure={goalMeasure}
          pace={paceLine(goalMeasure, goalDetail.data.measure, goalDetail.data.by, today)}
          health={healthOf(goalDetail, goalMeasure, goalDetail.data.measure, measureCtxFor(goalDetail), openWorkOf(reachOfGoal(goalDetail.id)))}
          onDrop={(why) => void dropGoal(goalDetail, why)}
          onOpenDecision={onOpenDecision}
          projects={goalProjects}
          canTag={categories.length > 0}
          tagged={goalTagged}
          onToggleTagged={async (id) => { await attemptWrite(() => tasksSvc.toggleDone(id)); await reload(); }}
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
            categories={categories}
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
        lens={lens}
        title={title}
        segments={segments}
        goals={goals}
        reachOfGoal={reachOfGoal}
        measureOfGoal={(id: string) => { const g = goals.find((x) => x.id === id); return g ? measureState(g.data.measure, measureCtxFor(g)) : null; }}
        extraOf={extraOf}
        projectRows={projectRows}
        // THE FRAME IS THE CATEGORIES (2026-08-29): same ids, Brain's order.
        sections={[...categories].sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0)).map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }))}
        loading={loading}
        offer={oneAsk}
        nextActionTextOf={nextActionTextOf}
        holdLineOf={(id: string) => { const p = projects.find((x) => x.id === id); return p ? holdLine(p.data, today) : null; }}
        sizeLineOf={(id: string) => sizeLine(sizeOf(tasks.filter((t) => t.data.projectId === id).map((t) => ({ done: !!t.data.done, category: t.data.category })), estimateFor))}
        // Single-goal default: with exactly one goal, a new project starts
        // linked to it, visibly, one tap to undo in the sheet. A default, not
        // a hidden action.
        onAddProject={() => setSheet({ kind: "newProject", goalId: goals.length === 1 ? goals[0]!.id : undefined })}
        onOpenProject={(id) => setDetailId(id)}
        onCloseProject={async (id) => {
          // PICK 6: the row closes itself where the work is already finished.
          // The same write and the same payoff the detail page already used,
          // so a project finished from the list celebrates identically to one
          // finished from inside it.
          const proj = projects.find((x) => x.id === id);
          if (!proj) return;
          await attemptWrite(() => projectsSvc.update(id, { ...proj.data, status: "done" }));
          await reload();
          const mine = tasks.filter((t) => (t.data as { projectId?: string }).projectId === id);
          setPayoff({
            kind: "project",
            title: proj.data.title,
            line: payoffLine({ tasksDone: mine.filter((t) => (t.data as { done?: boolean }).done).length }),
          });
        }}
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
          categories={categories}
          initial={editingGoal?.data}
          onSave={saveGoal}
          onDelete={sheet.kind === "editGoal" ? () => removeWithUndo("goal", sheet.id, () => setSheet({ kind: "closed" })) : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
    </>
  );
}
