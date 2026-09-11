import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTasks, useCategories, useSchedule, useRoutine, useNotes, usePeople } from "../data/NotesProvider";
import type { Person } from "../people/types";
import CallPrepSheet from "../people/CallPrepSheet";
import SyllabusUploadFlow from "../life/SyllabusUploadFlow";
import MessageDraftSheet from "../people/MessageDraftSheet";
import { pausedCategoryIds, offHoursCategoryIds } from "../categories/kinds";
import TasksPage from "./screens/TasksPage";
import TaskSheet, { type SheetCategory, type TaskDraft } from "./screens/TaskSheet";
import { useProjects, useGoals } from "../data/NotesProvider";
import type { Goal } from "../life/types";
import { buildGoalIndex, liveGoals, goalTitleForTask } from "../bigger/reach";
import { buildParentIndex, parentForTask } from "../life/parent";
import { sheetEvents, type SheetEvent as SheetEventRow } from "../schedule/sheetEvents";
import { rowSource, type Source } from "../shared/provenance";
import { movedBy, burstSize, celebrationLine, type Moved } from "../shared/completion";
import type { Project } from "../projects/types";
import { partition, byCategory, filterOf, FILTERS, FILTER_LABEL, type Partitioned, type TaskFilter } from "./filters";
import type { Recurrence, TaskData } from "../notes/types";
import type { TaskItem } from "./TasksService";
import { todayISO } from "./grouping";
import { nextFreeSlot, addMinutes, addDays } from "../schedule/calendar";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { setAsideCandidates, firstStepCandidate, isFirstStepDismissed, dismissFirstStep, backOnTrackMessage, slidingLine, SLIDING_TAG } from "./lifecycle";
import { useCategoryEstimates, useTaskEstimate } from "../schedule/useTaskEstimate";
import { useAI } from "../ai/useAI";
import { useAIContext } from "../ai/useAIContext";
import { identityToText, voiceToText } from "../ai/context";
import { firstStepPrompt, parseFirstStep } from "./firstStep";
import { rankOpen } from "../upnext/upnext";
import { FIFTEEN } from "./rightNow";
import { scheduleTask, breakDownTask, undoBreakdown, splitLine, type BreakdownResult } from "./taskMoves";
import { emit } from "../events";
import { chainQuietToday, dismissChain, nextBest, chainReason } from "./momentum";
import { RowIcon } from "../shared/anatomy";
import { touchActivity, recordSpot } from "../restore/whereYouWere";
import { capAfterNumber } from "../shared/casing";
import { loadOverwhelmed, setOverwhelmed as setOverwhelmedFlag, subscribeOverwhelmed, theOneThing } from "./overwhelmed";
import NoticeCard from "../today/NoticeCard";
import { TargetGlyph } from "../shared/glyphs";
import { haptics } from "../shared/haptics";
import { useFreshLists } from "../data/useFreshLists";
import { ENTITY_TASK } from "../notes/types";

const EMPTY: Partitioned = { all: [], daily: [], today: [], overdue: [], upcoming: [], done: [] };
type SheetState = { mode: "new"; initial?: Partial<TaskDraft> } | { mode: "edit"; id: string; initial: TaskDraft; source?: import("../shared/provenance").Source } | null;

export default function TasksFlow({ openId, openNonce, onOpenConsumed, openFilter, filterNonce, onFilterApplied, onOpenNote, onGoEmail, onWhatNow, title, segments }: {
  openId?: string; openFilter?: string; onOpenNote?: (id: string) => void;
  // SHARED-F-17 (2026-09-05): the mail route, so a task made from an email
  // can open the thread it came from.
  onGoEmail?: (threadId: string) => void;
  // SHELL-F-12 (2026-09-05): the shell's one-shot shape (shell/intents.ts).
  // Both of these were read once per mount and cleared only by a bottom-tab
  // tap, and LifeFlow remounts this list on every segment change: arrive on a
  // task from a note, close its sheet, tap Projects, tap Tasks, and the same
  // sheet popped open by itself. Arriving through Today's Overdue link, every
  // return to Tasks snapped the filter back to Overdue.
  openNonce?: number; onOpenConsumed?: () => void;
  filterNonce?: number; onFilterApplied?: () => void;
  // LIFE (2026-09-01): when this list is the Tasks segment of the Life tab,
  // the head says Life and carries the segment control. Alone, it is Tasks.
  title?: string; segments?: React.ReactNode;
  // TASKS AUDIT 2026-08-29, FINDING #1: "Pick One" used to call openEdit(),
  // landing on the full metadata form -- title, category, due date, project,
  // recurrence, plan -- for a button whose whole job was to remove a
  // decision. AppShell already has the right primitive one tap over on the
  // capture bar's lightning bolt: openWhatNow -> RightNowSheet, one task,
  // Start or Something Else, no form. Two "give me one task" buttons a few
  // hundred pixels apart doing different things was the bug the 2026-08-21
  // ADHD audit named and it was only ever fixed at the shell level. This
  // prop is how Tasks' own Pick One reaches the same single mechanism
  // instead of running a second, weaker one.
  onWhatNow?: () => void;
} = {}) {
  const svc = useTasks();
  const cats = useCategories();
  const schedule = useSchedule();
  // EVENTS ARE FIRST-CLASS (2026-09-09): the task sheet can file a task to an
  // event, so this page has to know what is coming. Read once, the same shape
  // every other sheet uses (schedule/sheetEvents.ts).
  const [sheetEventList, setSheetEventList] = useState<SheetEventRow[]>([]);
  useEffect(() => {
    let on = true;
    schedule.listEvents()
      .then((all) => { if (on) setSheetEventList(sheetEvents(all, todayISO())); })
      .catch(() => { if (on) setSheetEventList([]); });
    return () => { on = false; };
  }, [schedule]);
  const notesSvc = useNotes();
  const ai = useAI();
  const gatherContext = useAIContext();
  const today = todayISO();
  // LIFE-F-23 (2026-09-05): what "smallest" is measured with. See
  // schedule/useTaskEstimate.
  const estimateOf = useTaskEstimate();
  // UP-CORE-02: what each area usually takes, for the Length row's fact line.
  const categoryMinutes = useCategoryEstimates();
  // UP-CORE-17 (2026-09-05): the real contacts, for the task sheet's bounded
  // Person chooser and for the two person surfaces a linked task can open.
  // One people store, PeopleService, the same one the People tab reads.
  const peopleSvc = usePeople();
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleTick, setPeopleTick] = useState(0);
  useEffect(() => {
    let on = true;
    peopleSvc.list().then((ps) => { if (on) setPeople(ps); }).catch(() => {});
    return () => { on = false; };
  }, [peopleSvc, peopleTick]);
  const [personSheet, setPersonSheet] = useState<{ kind: "call" | "text"; personId: string; about: string } | null>(null);
  // UP-MIND-01 class (2026-09-07): the How You Write doc plus the
  // Writing-bucket facts, same as every other place that opens
  // MessageDraftSheet (PeopleFlow.tsx, DeckFlow.tsx). This one never gathered
  // it, so a text drafted from a task sounded like nobody while the same
  // reply drafted from People sounded like him.
  const [msgVoice, setMsgVoice] = useState("");
  useEffect(() => {
    const person = personSheet?.kind === "text" ? people.find((p) => p.id === personSheet.personId) : undefined;
    if (!person) { setMsgVoice(""); return; }
    let live = true;
    void gatherContext({ personId: person.id, personName: person.data.name })
      .then((c) => (c ? voiceToText(c, { styleRule: false }) : ""))
      .catch(() => "")
      .then((v) => { if (live) setMsgVoice(v); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personSheet?.kind, personSheet?.personId]);
  // UP-CORE-12 (2026-09-05): the syllabus door. A photographed syllabus is a
  // semester of work in one page, and the app could read a schedule photo and
  // a gym program while the shape that produces TASKS had no extractor.
  const [uploadOpen, setUploadOpen] = useState(false);
  // LIFE-F-01 (2026-09-05): this used to serialise local midnight with
  // toISOString(), which reads the UTC date. East of Greenwich that is still
  // today, so swiping Tomorrow set the due date to today, the row stayed put
  // and the toast still said "Moved to tomorrow". addDays walks with setDate
  // and formats from local getters (B2-1 fixed it there; this copy missed).
  const tomorrow = addDays(today, 1);
  const [parts, setParts] = useState<Partitioned>(EMPTY);
  const [allItems, setAllItems] = useState<TaskItem[]>([]);
  const [overwhelmed, setOverwhelmed] = useState(() => loadOverwhelmed(todayISO()));
  // The door in is on the What Now sheet now (Fewer Buttons, 2026-09-02),
  // which lives in the shell; when it writes the flag, this page re-reads it.
  useEffect(() => subscribeOverwhelmed(() => setOverwhelmed(loadOverwhelmed(todayISO()))), []);
  const [filter, setFilter] = useState<TaskFilter>(
    openFilter && (FILTERS as string[]).includes(openFilter) ? (openFilter as TaskFilter) : "today",
  );
  const [catFilter, setCatFilter] = useState("all");
  const projectsSvc = useProjects();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { let on = true; projectsSvc.list().then((p) => { if (on) setProjects(p); }); return () => { on = false; }; }, [projectsSvc]);
  // THE RULED ROW NAMES THE GOAL (2026-09-01). One index, the same
  // derivation Today and Schedule read (buildGoalIndex over live goals), so
  // a task cannot say one goal here and another on the home page.
  const goalsSvc = useGoals();
  const [goals, setGoals] = useState<Goal[]>([]);
  useEffect(() => { let on = true; goalsSvc.list().then((g) => { if (on) setGoals(g); }); return () => { on = false; }; }, [goalsSvc]);
  const goalIdx = buildGoalIndex(projects, liveGoals(goals));
  // The goal a project climbs to, by title, for the task sheet's derived Goal
  // row (Dave 2026-09-09: "task modals need to include events and goals as
  // well... it should autofill when it can"). Dropped and achieved goals do
  // not answer: a task filed today is not "for" something he abandoned or
  // already finished.
  const goalTitleOf = (id: string | undefined) => {
    if (!id) return undefined;
    const g = goals.find((x) => x.id === id);
    return g && !g.data.dropped && g.data.state !== "achieved" ? g.data.title : undefined;
  };

  // WHERE A TASK LIVES (The Row and Health, 2026-09-02): project, goal or
  // category, with the project's progress for its pie. Built once per pass.
  const parentIdx = useMemo(() => buildParentIndex(projects, goals, allItems), [projects, goals, allItems]);

  // SHARED-F-17 (2026-09-05): PROVENANCE OPENS ITS SOURCE. Provenance.tsx has
  // rendered a button since it was written, for any caller that could supply
  // the navigation, and no caller ever did: "From an email · Aug 12" under a
  // task was a line you could tap forever. The routes exist, they were just
  // never handed over. This returns a handler only for the source types this
  // flow can actually reach, so Provenance keeps rendering a plain fact for
  // the rest (Smart Paste, the recorder, a sweep) rather than a button that
  // does nothing, which is the bug in a different costume.
  // UP-CORE-17 (2026-09-05): the contact a task names, and the door to their
  // card. Only for a person who still exists: a deleted contact leaves the
  // task's personId pointing at nothing, and a chip that opens nothing is
  // worse than no chip.
  const personFor = useCallback((t: TaskItem): { name: string; onOpen?: () => void } | null => {
    const p = t.data.personId ? people.find((x) => x.id === t.data.personId) : undefined;
    if (!p) return null;
    return {
      name: p.data.name,
      onOpen: () => setPersonSheet({ kind: "call", personId: p.id, about: t.data.text }),
    };
  }, [people]);

  const openSourceFor = useCallback((source: Source): (() => void) | undefined => {
    const ref = source.ref;
    if (!ref) return undefined;
    if (source.type === "note" && onOpenNote) return () => onOpenNote(ref);
    if ((source.type === "email" || source.type === "gmail") && onGoEmail) return () => onGoEmail(ref);
    return undefined;
  }, [onOpenNote, onGoEmail]);
  const [categories, setCategories] = useState<SheetCategory[]>([]);
  const [pausedCats, setPausedCats] = useState<ReadonlySet<string>>(new Set());
  // Work-hours quiet set (audit 2026-08-10): after hours, work-category tasks
  // get no First Step offers. Same exclusion mechanics as the season pause.
  const [offHoursCats, setOffHoursCats] = useState<ReadonlySet<string>>(new Set());
  const routineSvc = useRoutine();
  const [sheet, setSheet] = useState<SheetState>(null);
  // LINKED NOTES (Dave 2026-08-28, "very very easy to connect things"): same
  // reverse lookup Person/Project/Goal detail already use, kept in sync with
  // whichever task the sheet has open.
  const [linkedNotes, setLinkedNotes] = useState<{ id: string; title: string; category: string }[]>([]);
  useEffect(() => {
    let on = true;
    if (!sheet || sheet.mode !== "edit") { setLinkedNotes([]); return; }
    notesSvc.notesLinkedTo(sheet.id).then((n) => { if (on) setLinkedNotes(n); });
    return () => { on = false; };
  }, [sheet, notesSvc]);
  // Momentum Chain: the suggestion occupying a just-finished task's slot.
  const [momentum, setMomentum] = useState<{ afterId: string; task: TaskItem } | null>(null);
  const [loading, setLoading] = useState(true);
  // First Step offer state: the AI-drafted step, keyed to the sliding task.
  const [fsStep, setFsStep] = useState<{ taskId: string; step: string } | null>(null);
  const [fsBusy, setFsBusy] = useState(false);
  const [fsHidden, setFsHidden] = useState(false);
  const sweptRef = useRef(false);

  const reload = useCallback(async () => {
    const items = await svc.listTasks();
    setParts(partition(items, today));
    setAllItems(items);
    setLoading(false);
    return items;
  }, [svc, today]);

  useEffect(() => {
    reload();
  }, [reload]);
  // A background refresh that found real changes repaints this surface
  // (2026-08-24). CachedAdapter has reported these since it shipped and
  // nothing was listening, so a list edited on another device sat wrong until
  // something else happened to trigger a reload.
  useFreshLists([ENTITY_TASK], reload);


  // Set Aside (lifecycle): once per day, long-overdue tasks quietly leave the
  // red wall for Someday territory, transparently and reversibly. The app
  // never shows a graveyard.
  useEffect(() => {
    if (loading || sweptRef.current) return;
    sweptRef.current = true;
    try {
      if (localStorage.getItem("jarvis.setaside.last") === today) return;
    } catch { /* private mode: sweep anyway */ }
    const cands = setAsideCandidates(allItems, today);
    if (cands.length === 0) return;
    const ids = cands.map((t) => t.id);
    void (async () => {
      // Silent automation law (corrections pack item 3): a failed automation
      // may never fail silently. On failure the line renders in error form
      // with a retry, louder than the success receipt.
      const runSweep = async (): Promise<void> => {
        try {
          await svc.setAside(ids);
        } catch {
          showToast({ message: "Couldn't set aside quiet tasks", actionLabel: "Retry", onAction: () => { void runSweep(); } });
          return;
        }
        try { localStorage.setItem("jarvis.setaside.last", today); } catch { /* ok */ }
        // LIFE-F-13 (2026-09-05): the second clause used to be the fixed
        // string "Nothing overdue" while the Overdue filter still held every
        // task 1 to 14 days late plus every overdue bill (setAsideCandidates
        // only takes quiet ones over 14 days, lifecycle.ts:20-29). It is
        // counted off the reloaded list now, and says nothing when nothing
        // is left.
        const left = partition(await reload(), today).overdue.length;
        showToast({
          message: `Set aside ${ids.length} quiet ${ids.length === 1 ? "task" : "tasks"}` + (left > 0 ? ` · ${left} still overdue` : ""),
          actionLabel: "Undo",
          onAction: async () => { await attemptWrite(() => svc.restoreAside(ids)); await reload(); },
        });
      };
      await runSweep();
    })();
  }, [loading, allItems, svc, today, reload]);

  useEffect(() => {
    let on = true;
    void (async () => {
      const [list, rt] = await Promise.all([cats.list(), routineSvc.get()]);
      if (!on) return;
      setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
      setPausedCats(pausedCategoryIds(list));
      const now = new Date();
      setOffHoursCats(offHoursCategoryIds(list, rt, now.getHours() * 60 + now.getMinutes()));
    })();
    return () => { on = false; };
  }, [cats, routineSvc]);

  // Fall back to "All" if the selected category no longer exists.
  useEffect(() => {
    if (catFilter !== "all" && categories.length && !categories.some((c) => c.id === catFilter)) setCatFilter("all");
  }, [categories, catFilter]);

  // LIFE-F-11 (2026-09-05): the Area cut used to reach the LIST only, so with
  // Area = Work the lead capsule said "Today 2" while the menu behind it said
  // "Today 5", "Clear 5 Completed" sat over two rows and deleted three tasks
  // from areas the filter was hiding, and Move All to Today re-dated them
  // too. One reader for what is on screen: counts, both bulk verbs and the
  // empty line all come through it, so the label, the list and the write can
  // no longer disagree.
  const visible = (f: TaskFilter): TaskItem[] => byCategory(parts[f], catFilter);
  const counts = {
    all: visible("all").length,
    daily: visible("daily").length,
    today: visible("today").length,
    overdue: visible("overdue").length,
    upcoming: visible("upcoming").length,
    done: visible("done").length,
  };

  // Which project this tick just moved, and how close it now is. Mirrors
  // TodayFlow exactly; the shared judgement lives in shared/completion.
  // Counts the tick that JUST happened. React state is still the pre-toggle
  // snapshot inside this handler, so counting only `done` reports the project
  // one task behind: ticking the last one said "One left". Counting the id
  // explicitly is correct whether the list is stale or fresh.
  const movedByTask = (t: { projectId?: string } | null, justDoneId: string): { moved: Moved; projectId: string } | null => {
    const pid = t?.projectId;
    if (!pid) return null;
    const proj = projects.find((x) => x.id === pid);
    if (!proj || proj.data.status === "done") return null;
    const mine = allItems.filter((x) => x.data.projectId === pid);
    const done = mine.filter((x) => x.data.done || x.id === justDoneId).length;
    const moved = movedBy(proj.data.title, done, mine.length);
    return moved ? { moved, projectId: pid } : null;
  };

  const onToggle = async (id: string) => {
    const before = await svc.task(id);
    // Back On Track: completing a recurring task after a real gap gets the
    // comeback line instead of the stock toast. The old run still counts.
    const comeback = before ? backOnTrackMessage(before, today) : null;
    const ok = await attemptWrite(() => svc.toggleDone(id));
    await reload();
    if (!ok) return;
    touchActivity(); // completing things is being HERE (Where You Were)
    if (before && !before.done) {
      // Momentum Chain (addendum item 7): the next best thing slides into
      // the finished slot, unless the chain was quieted for today.
      if (!chainQuietToday(today)) {
        const items = await svc.listTasks();
        const next = nextBest(items, id, before.category ?? "");
        setMomentum(next ? { afterId: id, task: next } : null);
      }
    }
    // The progress toast is UNIVERSAL, not a Today-page trick. A tick means
    // the same thing whichever screen it happened on, and a reward that only
    // appears on one surface teaches nothing.
    const advanced = before && !before.done ? movedByTask(before, id) : null;
    // LIFE-F-02 (2026-09-05): Undo restores the snapshot read above, never a
    // second toggleDone. On a weekly task the second toggle rolled it out
    // another week and read the run as 2 (see TasksService.restoreCompletion).
    const undoTick = async () => {
      if (!before) return;
      await attemptWrite(() => svc.restoreCompletion(id, before));
      await reload();
    };
    if (comeback) {
      showToast({ message: comeback });
    } else if (advanced?.moved.cleared) {
      // Delayed rewards are the ones ADHD discounts hardest, so finishing the
      // project is one tap from HERE rather than four taps through a form.
      showToast({
        message: advanced.moved.projectTitle + " · " + advanced.moved.line,
        actionLabel: "Finish It",
        onAction: async () => {
          const proj = projects.find((x) => x.id === advanced.projectId);
          if (!proj) return;
          await attemptWrite(() => projectsSvc.update(proj.id, { ...proj.data, status: "done" }));
          await reload();
          showToast({ message: celebrationLine("project", proj.id) + " · " + proj.data.title });
        },
      });
    } else if (advanced) {
      showToast({ message: advanced.moved.projectTitle + " · " + advanced.moved.line, actionLabel: "Undo", onAction: undoTick });
    } else if (before && !before.done) {
      showToast({ message: "Task completed", actionLabel: "Undo", onAction: undoTick });
    }
  };

  // First Step (lifecycle): one offer at a time for the task that keeps
  // sliding. The AI drafts the smallest possible opening move; accepting adds
  // it to Today and sets the big task aside, out of the red.
  const fsCandidate = (() => {
    if (!ai.available || fsHidden || loading) return null;
    const c = firstStepCandidate(allItems, today, new Set([...pausedCats, ...offHoursCats]));
    return c && !isFirstStepDismissed(c.id, today) ? c : null;
  })();

  const fsAsk = async () => {
    if (!fsCandidate || fsBusy) return;
    setFsBusy(true);
    try {
      // Phase 3: the step is drafted with JARVIS's voice and what the app
      // knows about this person, not from the task text alone. Context
      // failure must not block the offer, a generic step beats no step.
      const identity = await gatherContext().then(identityToText).catch(() => "");
      const p = firstStepPrompt(fsCandidate.data.text, "task", identity);
      const step = parseFirstStep(await ai.complete([{ role: "user", content: p.user }], p.system));
      if (!step) throw new Error("empty");
      setFsStep({ taskId: fsCandidate.id, step });
    } catch {
      showToast({ message: "Couldn't reach JARVIS" });
    } finally {
      setFsBusy(false);
    }
  };

  const fsAccept = async () => {
    if (!fsStep || !fsCandidate || fsStep.taskId !== fsCandidate.id) return;
    const ok = await attemptWrite(async () => {
      // LIFE-F-24 (2026-09-05): the drafted step inherited the area but not
      // the project, so a first step for a stalled project task landed on
      // Today filed nowhere: the project page never showed it and the project
      // still read stalled, which is the state this offer exists to leave.
      await svc.createTask(fsStep.step, { category: fsCandidate.data.category || undefined, projectId: fsCandidate.data.projectId, due: today });
      await svc.setAside([fsCandidate.id]);
    });
    if (!ok) return;
    dismissFirstStep(fsCandidate.id, today);
    setFsStep(null);
    setFsHidden(true);
    emit({ type: "suggestion.accepted", props: { kind: "first_step" } });
    await reload();
    showToast({ message: "First step on Today · Big one waits" });
  };

  const fsDismiss = () => {
    if (fsCandidate) dismissFirstStep(fsCandidate.id, today);
    setFsStep(null);
    setFsHidden(true);
    emit({ type: "suggestion.dismissed", props: { kind: "first_step" } });
  };

  // The quick-add box is GONE (2026-08-21, Dave: "the add task type box makes
  // no sense"). It was a third way to make a task on a screen that already had
  // the nav-bar "+" and the capture path, and a box that duplicates a button
  // is a decision the user has to make for no gain. The date parsing it used
  // was never the problem and was never its own: localParse lives in the
  // capture path and is still used there.
  // Bulk-remove finished tasks from the Done list. With Undo (2026-08-09):
  // this was the ONE delete on the page without it, and it is the delete
  // that takes the most at once.
  const onClearDone = async () => {
    // LIFE-F-11: only what the Area filter is showing, which is what the
    // button's count says.
    const done = visible("done");
    const snapshot = done.map((t) => ({ ...t.data }));
    const ok = await attemptWrite(async () => { for (const t of done) await svc.deleteTask(t.id); });
    await reload();
    if (!ok) return;
    showToast({
      message: `Cleared ${snapshot.length} completed`,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          for (const d of snapshot) {
            const id = await svc.recreateFrom(d);
            if (id) await svc.toggleDone(id); // they come back DONE, as they were
          }
        });
        await reload();
      },
    });
  };

  const openEdit = async (id: string) => {
    const t = await svc.task(id);
    if (!t) return;
    recordSpot({ kind: "task", id, label: t.text }); // Where You Were
    // plan rides into the sheet (2026-08-25): without it the sheet's fields
    // start empty, save() sees an untouched plan, and setPlan(id, null) below
    // silently erased the task's if-then on EVERY edit.
    setSheet({ mode: "edit", id, initial: { text: t.text, category: t.category ?? "", extraCategories: t.extraCategories, due: t.due ?? "", repeat: t.recurrence ?? "", projectId: t.projectId ?? "", eventId: t.eventId ?? "", plan: t.plan, steps: t.steps, estimateMin: t.estimateMin, personId: t.personId }, source: rowSource(t.source, t.moved) });
  };

  // When arriving via a note connection, open that task. SHELL-F-12: on the
  // nonce as well, so the same task linked twice opens twice, and consumed
  // the moment it opens so a later visit to this segment is just the list.
  useEffect(() => {
    if (!openId) return;
    openEdit(openId);
    onOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, openNonce]);

  // SHELL-F-12: the same for the filter a link asks for (Today's Overdue and
  // See All). Applied when it arrives, then spent.
  useEffect(() => {
    if (!openFilter || !(FILTERS as string[]).includes(openFilter)) return;
    setFilter(openFilter as TaskFilter);
    onFilterApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFilter, filterNonce]);

  const onSave = async (draft: TaskDraft) => {
    const rec = (draft.repeat || "") as "" | Recurrence;
    let saved = true;
    if (sheet?.mode === "new") {
      saved = await attemptWrite(() => svc.createTask(draft.text, { category: draft.category || undefined, extraCategories: draft.extraCategories, due: draft.due || null, recurrence: rec || undefined, projectId: draft.projectId, eventId: draft.eventId, plan: draft.plan, steps: draft.steps, estimateMin: draft.estimateMin, personId: draft.personId }));
    } else if (sheet?.mode === "edit") {
      saved = await attemptWrite(async () => {
        await svc.editText(sheet.id, draft.text);
        await svc.setCategories(sheet.id, [draft.category, ...(draft.extraCategories ?? [])].filter(Boolean));
        await svc.setDue(sheet.id, draft.due || null);
        await svc.setProject(sheet.id, draft.projectId ?? null);
        await svc.setEvent(sheet.id, draft.eventId ?? null);
        await svc.setRecurrence(sheet.id, rec || null);
        await svc.setPlan(sheet.id, draft.plan ?? null);
        await svc.setSteps(sheet.id, draft.steps ?? []);
        await svc.setEstimate(sheet.id, draft.estimateMin ?? null);
        await svc.setPerson(sheet.id, draft.personId ?? null);
        // Close Task: one tap on the sheet's own offer both saves and marks
        // the task done, once every step is checked.
        if (draft.closeNow) await svc.toggleDone(sheet.id);
      });
    }
    const wasNew = sheet?.mode === "new" && saved;
    setSheet(null);
    await reload();
    // A saved task must always be visible (audit 2026-07-30: a new task with
    // no due date landed in Upcoming while the user watched Today, which read
    // as "Save is broken"). Jump to the filter where it landed and clear a
    // category filter that would hide it, with a toast naming the move.
    if (wasNew) {
      const landed = filterOf({ text: draft.text, category: draft.category, done: false, due: draft.due || undefined, recurrence: rec || undefined }, today);
      if (draft.category && catFilter !== "all" && draft.category !== catFilter) setCatFilter("all");
      if (landed !== filter) {
        setFilter(landed);
        showToast({ message: `Saved to ${FILTER_LABEL[landed]}` });
      }
    }
  };

  const onDelete = async () => {
    if (sheet?.mode === "edit") {
      const t = await svc.task(sheet.id);
      const ok = await attemptWrite(() => svc.deleteTask(sheet.id));
      if (ok && t) offerUndoTask(t);
    }
    setSheet(null);
    await reload();
  };

  const onDeleteRow = async (id: string) => {
    const t = await svc.task(id);
    const ok = await attemptWrite(() => svc.deleteTask(id));
    if (ok && t) offerUndoTask(t);
    await reload();
  };

  // BULK DELETE (Dave 2026-08-24: "It should be very easy to clear and
  // delete stuff. Also in bulk").
  //
  // Read the whole selection BEFORE deleting any of it, or Undo has nothing
  // to restore: by the time the first delete lands the rest are still there,
  // but by the time the toast is tapped none of them are.
  //
  // A partial failure is reported honestly rather than rounded up. Deleting
  // four of six and saying "6 tasks deleted" is the kind of lie that costs
  // trust in the Undo as well, since the two numbers have to agree.
  const onDeleteMany = async (ids: string[]) => {
    if (ids.length === 0) return;
    const kept: TaskData[] = [];
    for (const id of ids) {
      const t = await svc.task(id);
      if (t) kept.push(t);
    }
    let gone = 0;
    await attemptWrite(async () => {
      for (const id of ids) { await svc.deleteTask(id); gone++; }
    });
    await reload();
    if (gone === 0) return;
    const n = gone;
    showToast({
      message: n === 1 ? "Task deleted" : n + " tasks deleted",
      actionLabel: "Undo",
      onAction: async () => {
        // All of them, in one go, so one tap puts the list back exactly as
        // it was rather than leaving the user to undo six times.
        await attemptWrite(async () => {
          for (const t of kept.slice(0, n)) {
            await svc.recreateFrom(t);
          }
        });
        await reload();
      },
    });
  };

  // Completing a selection is the other thing anyone wants in bulk, and it
  // is the NON-destructive one, so it needs no undo beyond the check itself.
  //
  // B3-3 (2026-09-04): "Mark Done" is offered on every filter, including the
  // Done list itself, but toggleDone truly toggles. Selecting already-done
  // tasks and tapping it silently un-completed them while the toast still
  // said "N marked done". Only tasks that are not already done get touched
  // now, so re-selecting done ones is a no-op for them, never a reversal.
  const onDoneMany = async (ids: string[]) => {
    if (ids.length === 0) return;
    const targets: string[] = [];
    for (const id of ids) {
      const t = await svc.task(id);
      if (t && !t.done) targets.push(id);
    }
    if (targets.length === 0) { showToast({ message: "Already done" }); return; }
    const ok = await attemptWrite(async () => { for (const id of targets) await svc.toggleDone(id); });
    await reload();
    if (ok) showToast({ message: targets.length === 1 ? "Done" : targets.length + " marked done" });
  };

  // S6-Q39 (2026-09-05): "a project cannot adopt a task you already have."
  // Filing five taps and a hunt (leave, find it in the list, open its sheet,
  // set Project, save) is why a backlog stays unfiled. No undo, same as
  // Mark Done just above: re-picking a project (or None, on the task's own
  // sheet) undoes this in one tap too.
  const onMoveMany = async (ids: string[], projectId: string) => {
    if (ids.length === 0) return;
    const ok = await attemptWrite(async () => { for (const id of ids) await svc.setProject(id, projectId); });
    await reload();
    if (!ok) return;
    const name = projects.find((p) => p.id === projectId)?.data.title ?? "the project";
    showToast({ message: (ids.length === 1 ? "Task moved to " : ids.length + " tasks moved to ") + name });
  };

  // Recreate a just-deleted task if the user taps Undo.
  const offerUndoTask = (t: TaskData) => {
    showToast({
      message: "Task deleted",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => svc.recreateFrom(t));
        await reload();
      },
    });
  };

  // Push a task to tomorrow without opening the editor.
  const onSnooze = async (id: string) => {
    const ok = await attemptWrite(() => svc.setDue(id, tomorrow));
    await reload();
    if (ok) showToast({ message: "Moved to tomorrow" });
  };

  // Drop the task into the next free slot on its due day (or today) as a 1h event.
  // The move itself lives in taskMoves.ts so Today can make it too; this
  // keeps only what is local: which sheet is open, and what to say after.
  const onScheduleTask = async () => {
    if (sheet?.mode !== "edit") return;
    const id = sheet.id;
    let landed = false;
    const ok = await attemptWrite(async () => { landed = (await scheduleTask(id, today, svc, schedule)).ok; });
    setSheet(null);
    if (ok) showToast({ message: landed ? "Added to schedule" : "Couldn't find that task" });
  };

  // A2 (audit 2026-08-21): the Tasks tab could not start anything. Same move
  // as Today's Start pill, deliberately identical: fifteen minutes, right
  // now, as a REAL block on the real day. Not an in-app timer, because a
  // timer dies when he closes JARVIS, which is exactly the moment starting
  // goes wrong.
  const onStartTask = async (id: string) => {
    const t = await svc.task(id);
    if (!t) return;
    const now = new Date();
    const start = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const ok = await attemptWrite(() => schedule.createEvent(t.text, {
      date: today, start, end: addMinutes(start, FIFTEEN),
      category: t.category || undefined, sourceTaskId: id,
    }));
    if (ok) { haptics.selection(); showToast({ message: `Fifteen minutes on ${t.text}` }); }
  };

  // THE KEEPS SLIDING ROW (Fewer Buttons, Dave 2026-09-02: "I don't like all
  // those floating buttons"). The offer stops floating above the list as a
  // card and is the list's first row, the same notice row the one ask on
  // Goals wears: the tile in orange (the tile is what says "stalled"), the
  // task's name, one line of why, one pill. Not Now is the swipe. Once the
  // answer lands the step takes the name slot and the task demotes to the
  // For: line, because the step is what the pill adds. Verbs unchanged
  // (B15 2026-08-23 still applies: this row acts on ONE stalled task; the
  // screen's own red stays Pick One). The 08-31 rule that the card must say
  // what it is before anything else survives as the line under the name.
  //
  // ONE ROW PER TASK (Dave 2026-09-02: "'email Danielle' shows up twice,
  // kill the bug"). The offer is no longer a notice row beside the task's
  // own row; it IS the task's row, hoisted to the top of the first card
  // (TasksPage `stalled`), the sliding line in the warning ink and First
  // Step in place of Start. Once the step is drafted it is a new thing,
  // not the task, so that state keeps the notice row: the step's words,
  // "First step for" the task, Add, and the swipe to decline.
  const fsOn = !!fsCandidate && (filter === "today" || filter === "overdue" || filter === "all");
  const fsStalled = fsOn && fsCandidate && !(fsStep && fsStep.taskId === fsCandidate.id)
    ? { id: fsCandidate.id, tag: SLIDING_TAG, line: slidingLine(fsCandidate, today), action: { label: fsBusy ? "Thinking..." : "First Step", onClick: () => void fsAsk() } }
    : null;
  const fsNotice = fsOn && fsCandidate && fsStep && fsStep.taskId === fsCandidate.id ? (
    <NoticeCard
      form="card"
      icon={<TargetGlyph />}
      tone="cat-fg-orange"
      title={fsStep.step}
      sub={"First step for: " + fsCandidate.data.text}
      action={{ label: "Add", onClick: () => void fsAccept() }}
      onDismiss={fsDismiss}
    />
  ) : null;

  // JUST PICK ONE FOR ME (Dave 2026-08-19). The point is that he never
  // reads a list: one tap goes from "Tasks" straight to a task that is
  // already moving. TASKS AUDIT 2026-08-29: "already moving" means the
  // What Now sheet (Start / Something Else), not the edit form, so this
  // hands off to the same mechanism the lightning bolt uses whenever the
  // shell has wired it up. The old rankOpen-then-openEdit path survives
  // only as the fallback for a caller that mounts TasksFlow without
  // onWhatNow (tests, or a future embed), so Pick One is never a dead
  // button; it is just the weaker of the two behaviours instead of the
  // only one.
  const pickOne = () => {
    if (onWhatNow) { onWhatNow(); return; }
    const best = rankOpen(parts.all, today)[0];
    if (!best) { showToast({ message: "Nothing open · Enjoy it" }); return; }
    openEdit(best.id);
  };

  // MOVE ALL TO TODAY: an overdue pile is where the shame lives. One tap
  // resets it, with a single Undo that puts every original date back.
  const moveAllToToday = async () => {
    // LIFE-F-11: the pile this moves is the pile on screen, never the tasks
    // the Area filter is hiding.
    const stuck = visible("overdue");
    if (stuck.length === 0) return;
    const before = stuck.map((t) => ({ id: t.id, due: t.data.due ?? null }));
    const ok = await attemptWrite(async () => {
      for (const t of stuck) await svc.setDue(t.id, today);
    });
    await reload();
    if (!ok) return;
    showToast({
      message: capAfterNumber(`${stuck.length} ${stuck.length === 1 ? "task" : "tasks"} moved to today`),
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          for (const b of before) await svc.setDue(b.id, b.due);
        });
        await reload();
      },
    });
  };

  // BREAK IT DOWN: one big task becomes three or four startable ones. The
  // original is replaced by its steps (keeping both would mean the scary
  // version still sits in the list), and one Undo puts it back and removes
  // them. toggleDone is deliberately NOT used to retire the original: on a
  // recurring task it would roll the due date forward instead of closing it.
  const breakDown = async (text: string) => {
    const editingId = sheet?.mode === "edit" ? sheet.id : null;
    setSheet(null);
    showToast({ message: "Breaking it down..." });
    const original = editingId ? parts.all.find((t) => t.id === editingId) ?? null : null;
    if (!original && editingId) { showToast({ message: "Couldn't find that task" }); return; }
    const identity = await gatherContext().then(identityToText).catch(() => "");
    let res: Awaited<ReturnType<typeof breakDownTask>> | null = null;
    const ok = await attemptWrite(async () => { res = await breakDownTask(text, original, today, ai, svc, identity); });
    await reload();
    if (!ok || !res) return;
    const r = res as BreakdownResult;
    if (r.reason === "no-ai") { showToast({ message: "Couldn't reach JARVIS" }); return; }
    showToast({
      message: splitLine(r.made.length),
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => undoBreakdown(r.made, r.original, svc));
        await reload();
      },
    });
  };

  return (
    <>
      <TasksPage
        title={title}
        segments={segments}
        onPickOne={pickOne}
        overwhelmed={overwhelmed}
        onCalm={() => { haptics.selection(); setOverwhelmed(setOverwhelmedFlag(false, today)); }}
        onMoveAllToToday={() => void moveAllToToday()}
        filter={filter}
        counts={counts}
        items={overwhelmed
          // F1: the list IS the one thing. Nothing is deleted, deferred or
          // rescheduled; this is a view, and everything returns on one tap.
          // LIFE-F-23 (2026-09-05): a real per-category length, not a
          // constant that made every task tie and left this oldest-due.
          ? [theOneThing(allItems, estimateOf)].filter((t): t is TaskItem => !!t)
          : visible(filter)}
        notice={fsNotice}
        stalled={fsStalled}
        categories={categories}
        catFilter={catFilter}
        onCatFilter={setCatFilter}
        today={today}
        onFilter={setFilter}
        onToggle={onToggle}
        onOpenTask={openEdit}
        // B6: a rename is one field, so it does not cost a sheet. Undo comes
        // free with the row still on screen showing the old text if the
        // write fails.
        onRenameTask={(id, text) => void (async () => {
          const ok = await attemptWrite(() => svc.editText(id, text));
          if (ok) await reload();
        })()}
        onStartTask={(id) => void onStartTask(id)}
        goalOf={(t) => goalTitleForTask(goalIdx, t)}
        parentOf={(t) => parentForTask(parentIdx, t)}
        // SHARED-F-16 (2026-09-05): the escalating burst finally reaches a
        // row. burstSize has existed in shared/completion since the dopamine
        // layer landed and nothing called it, because movedBy was computed
        // AFTER the toggle, by which time the row had already burst. It is a
        // pure read of tasks and projects already in hand, so it can be
        // answered before the tap instead.
        burstSizeOf={(t) => (t.data.done ? "small" : burstSize(movedByTask(t.data, t.id)?.moved ?? null))}
        openSourceFor={openSourceFor}
        personFor={personFor}
        onUpload={ai.available ? () => setUploadOpen(true) : undefined}
        momentum={momentum && {
          afterId: momentum.afterId,
          el: (
            <div className="row momentum-slot">
              <RowIcon kind="task" />
              <div className="row-stack">
                <div className="eyebrow">Keep Going</div>
                <div className="conn-name">{momentum.task.data.text}</div>
                {chainReason(momentum.task, momentum.task.data.category ?? "", today) && (
                  <div className="conn-meta">{chainReason(momentum.task, momentum.task.data.category ?? "", today)}</div>
                )}
              </div>
              <div className="momentum-actions">
                {/* B3-2 (2026-09-04): this called openEdit, which opens the
                    full metadata form. onStartTask, in the same closure, is
                    the real Start every other Start pill on this screen
                    calls: fifteen minutes, right now, as a real block. */}
                <button className="pill-act" onClick={() => { const id = momentum.task.id; setMomentum(null); void onStartTask(id); }}>Start</button>
                <button className="btn-sm" onClick={() => { dismissChain(today); setMomentum(null); }}>Not Now</button>
              </div>
            </div>
          ),
        }}
        onDeleteTask={onDeleteRow}
        onDeleteMany={onDeleteMany}
        onDoneMany={onDoneMany}
        projects={projects.map((p) => ({ id: p.id, title: p.data.title, category: p.data.category || undefined, goalTitle: goalTitleOf(p.data.goalId) }))}
        onMoveMany={onMoveMany}
        onSnoozeTask={onSnooze}
        onClearDone={onClearDone}
        onNew={() => setSheet({
          mode: "new",
          // Prefill from the filter being viewed, so a task made while looking
          // at Today is due today by default (audit 2026-07-30).
          initial: filter === "today" || filter === "overdue" || filter === "all" ? { due: today } : filter === "daily" ? { repeat: "daily" } : undefined,
        })}
        loading={loading}
      />
      {sheet && (
        <TaskSheet
          projects={projects.map((p) => ({ id: p.id, title: p.data.title, category: p.data.category || undefined, goalTitle: goalTitleOf(p.data.goalId) }))}
          events={sheetEventList}
          mode={sheet.mode}
          initial={sheet.initial}
          source={sheet.mode === "edit" ? sheet.source : undefined}
          openSourceFor={openSourceFor}
          categories={categories}
          categoryMinutes={categoryMinutes}
          people={people.map((p) => ({ id: p.id, name: p.data.name }))}
          onSave={onSave}
          otherPlans={allItems.map((t) => ({ id: t.id, text: t.data.text, plan: t.data.plan }))}
          selfId={sheet.mode === "edit" ? sheet.id : undefined}
          onSchedule={sheet.mode === "edit" ? onScheduleTask : undefined}
          onBreakDown={sheet.mode === "edit" && ai.available ? (t) => void breakDown(t) : undefined}
          onTextPerson={(() => {
            // UP-CORE-17: only when the task names a person who still exists
            // and has a number: MessageDraftSheet's own door out is an sms:
            // link, so without one the row would promise nothing.
            if (sheet.mode !== "edit") return undefined;
            const t = allItems.find((x) => x.id === sheet.id);
            const p = t?.data.personId ? people.find((x) => x.id === t.data.personId) : undefined;
            if (!p?.data.phone) return undefined;
            return { name: p.data.name, onOpen: () => { const text = t!.data.text; setSheet(null); setPersonSheet({ kind: "text", personId: p.id, about: text }); } };
          })()}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onCancel={() => setSheet(null)}
          linkedNotes={sheet.mode === "edit" ? linkedNotes : []}
          onOpenNote={sheet.mode === "edit" ? onOpenNote : undefined}
          onAddNote={sheet.mode === "edit" && onOpenNote ? () => void (async () => {
            // Born connected, then opened (PICK 27's pattern): the title is
            // the task's own, so there's nothing to type before you can
            // write the note.
            const s = sheet;
            // BROWSER-F-01 (2026-09-05): this read the id off attemptWrite,
            // which resolves a BOOLEAN (guard.ts:21). `typeof true` is never
            // "string", so the note was created and never opened: a dead tap
            // that quietly filed a note per press. The id is captured inside
            // the closure now, the way NotesFlow's creates already do it.
            let noteId: string | null = null;
            await attemptWrite(async () => {
              noteId = await notesSvc.createNote(
                s.initial.text,
                s.initial.category,
                [{ id: "task-" + s.id, kind: "task", label: s.initial.text, targetId: s.id }],
              );
            });
            if (noteId) onOpenNote(noteId);
          })() : undefined}
        />
      )}
      {uploadOpen && (
        <SyllabusUploadFlow
          ai={ai}
          tasks={svc}
          schedule={schedule}
          categoryId={catFilter !== "all" ? catFilter : undefined}
          onDone={async ({ taskCount, eventCount, undo }) => {
            setUploadOpen(false);
            await reload();
            const parts: string[] = [];
            if (taskCount) parts.push(`${taskCount} ${taskCount === 1 ? "task" : "tasks"}`);
            if (eventCount) parts.push(`${eventCount} ${eventCount === 1 ? "event" : "events"}`);
            showToast({
              message: capAfterNumber(parts.join(" and ") + " added"),
              actionLabel: "Undo",
              onAction: async () => { await undo(); await reload(); },
            });
          }}
          onCancel={() => setUploadOpen(false)}
        />
      )}
      {/* UP-CORE-17 (2026-09-05): the two person surfaces, opened from a task
          that names someone. CallPrepSheet is THE person card by law, so this
          mounts the same component the People tab does, with the same
          PeopleService wiring, and hands it the task's own words as the
          reason it is open. */}
      {personSheet && people.find((p) => p.id === personSheet.personId) && (
        personSheet.kind === "call" ? (
          <CallPrepSheet
            person={people.find((p) => p.id === personSheet.personId)!}
            reason={personSheet.about}
            onCall={async () => {
              const out = await peopleSvc.logCallAttempt(personSheet.personId);
              setPeopleTick((n) => n + 1);
              return out;
            }}
            onUndoCall={async (prior) => { await peopleSvc.restoreCallAttempt(personSheet.personId, prior); setPeopleTick((n) => n + 1); }}
            onCaptureNote={async (text) => {
              const person = people.find((p) => p.id === personSheet.personId);
              if (!person) return false;
              const noteId = await notesSvc.createNote("Call with " + person.data.name, "");
              if (!noteId) return false;
              await notesSvc.addBlock(noteId, { type: "text", text });
              await notesSvc.addConnection(noteId, "person", person.data.name, person.id);
              return true;
            }}
            onClose={() => setPersonSheet(null)}
          />
        ) : (
          <MessageDraftSheet
            person={people.find((p) => p.id === personSheet.personId)!}
            ai={ai}
            about={personSheet.about}
            voice={msgVoice}
            onClose={() => setPersonSheet(null)}
          />
        )
      )}
    </>
  );
}
