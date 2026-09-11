import { createPortal } from "react-dom";
import { categoriesOf, setCategories } from "../categories";
import { useRef, useState, type ReactNode } from "react";
import type { ColorSlot } from "../../categories/types";
import type { TaskStep } from "../../notes/types";
import Provenance from "../../shared/ProvenanceLine";
import type { Source } from "../../shared/provenance";
import { whyWeak, isUsable, sentence, findClash, clashLine, cueIsDetectable, type IfThen, type CueKind } from "../ifThen";
import { FileText, CheckSquare, Clock, Hourglass, Tag, FolderKanban, Calendar, MessageSquare, Sparkles, Check, User, X, CalendarDays} from "../../shared/icons";
import { DUR_CHOICES, durLabel } from "../../schedule/durations";
import { RepeatGlyph, PinGlyph, TargetGlyph } from "../../shared/glyphs";
import { catColor } from "../../shared/categories";
import SheetBar from "../../shared/SheetBar";
import HeadMenu from "../../shared/HeadMenu";
import { addDays } from "../../schedule/calendar";

export interface SheetCategory { id: string; name: string; color: ColorSlot }
export interface TaskDraft {
  text: string; category: string; extraCategories?: string[]; due: string; repeat: string; projectId?: string;
  // EVENTS ARE FIRST-CLASS (Dave 2026-09-09: "events are also not tied to task
  // modals"). The event this task belongs to, by id, exactly as projectId
  // above names its project. The event page could file a task to itself from
  // the day it was built; this is the other direction, which is the one a
  // person actually reaches for -- the task already exists and it belongs to
  // Saturday.
  eventId?: string;
  // A1 (2026-08-20): the if-then plan, when he set one.
  plan?: IfThen;
  // STEPS (2026-09-04): the checklist inside this task, whole-array like the
  // rest of this draft -- see TasksService.setSteps.
  steps?: TaskStep[];
  // UP-CORE-02 (2026-09-05): how long this one takes, in minutes. Absent
  // means he has not said, and the learned category median answers instead.
  estimateMin?: number;
  // UP-CORE-17 (2026-09-05): the contact this task is about, by id.
  personId?: string;
  // Set only by the "Close Task" offer under a fully-checked list: this
  // Save should also mark the task done. Never set by the ordinary Save tap.
  closeNow?: boolean;
}
/** A project this sheet can file a task to. The extra two fields are what
 *  makes the picker SMART (Dave 2026-09-09: "if someone selects a project or
 *  event connected to a goal or category it should autofill when it can"): a
 *  project already knows its area and the goal it climbs to, so a task filed
 *  to it should not make him say either one again. Both optional, so a caller
 *  with only ids and titles keeps working exactly as before. */
export interface SheetProject { id: string; title: string; category?: string; goalTitle?: string }
/** An event this sheet can file a task to. `when` is a rendered day, not a
 *  date: the menu has to disambiguate two events with the same name, and a
 *  raw ISO string in a picker is a machine talking. */
export interface SheetEvent { id: string; title: string; when: string; category?: string }

const isoOf = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayISO = () => isoOf(new Date());
// LIFE-F-12 (2026-09-05): the presets used to add n x 86,400,000ms to local
// midnight. On the clocks-back Sunday the local day is 25 hours long, so
// Tomorrow and Next Week both resolved to today and This Weekend to Friday.
// addDays (calendar.ts) steps with setDate, which counts calendar days.
// The coming Saturday (today, when today is one) and the coming Monday.
const weekendISO = (today: string) => { const d = new Date(today + "T00:00:00"); return addDays(today, (6 - d.getDay() + 7) % 7); };
const nextWeekISO = (today: string) => { const d = new Date(today + "T00:00:00"); return addDays(today, ((8 - d.getDay()) % 7) || 7); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateWord = (iso: string) => { const d = new Date(iso + "T00:00:00"); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

// The glyph tile every grouped row leads with (shared/anatomy's .row-ico
// and the nav-tile palette), one hue per row so the eye finds a field by
// colour before it reads the word. The exercise sheet's own Tile.
function Tile({ tone, children }: { tone: string; children: ReactNode }) {
  return <div className={"row-ico nav-tile-" + tone}>{children}</div>;
}

// THE TASK SHEET ONTO THE RULINGS (Brain and the Task Sheet catalog, Dave
// 2026-09-02, picked "The sheet bar and grouped rows" and "A menu drops from
// the value"). The sheet you open on every task was an eyebrow, a name
// field, a red pill, a row of area chips, two segmented controls, project
// chips, a notes box and four stacked buttons. It is the exercise sheet's
// anatomy now: Cancel, the title and Save in the bar; groups with a glyph
// tile and the value on the right (TASK, WHEN, WHERE, MORE); the last group
// the two actions. Every value opens the Tasks head's own dropdown; Pick a
// Date opens the phone's date wheel. All saves call the same TaskService
// methods; this is presentational and local form state only.
export default function TaskSheet({
  mode,
  initial,
  categories,
  categoryMinutes = {},
  people = [],
  projects = [],
  events = [],
  source,
  openSourceFor,
  onSave,
  onSchedule,
  onBreakDown,
  onTextPerson,
  onDelete,
  onCancel,
  otherPlans = [],
  selfId,
  linkedNotes = [],
  onOpenNote,
  onAddNote,
  slidingNote,
}: {
  mode: "new" | "edit";
  /** ONE NEGATIVE PER ROW (Dave 2026-09-11: "We also don't need 'pushed 8
   *  times', it's two negative notifications. It's too much. It can be inside
   *  the task but not there"). The list row says the verdict once, as the
   *  Keeps Sliding chip; the count that earned the verdict is evidence, and
   *  evidence belongs where a person goes to do something about it. It rides
   *  under Due, because the pushing IS the due date's history. */
  slidingNote?: string | null;
  initial?: Partial<TaskDraft>;
  // The id of the task being edited, so the clash check can skip its own
  // plan. Without it, editing a task that owns a cue reported the task as
  // clashing with itself (2026-08-25).
  selfId?: string;
  // A3: every OTHER task that already owns a cue, so a clash can be reported
  // rather than silently allowed. The research is specific that competing
  // plans on one trigger cancel each other out.
  otherPlans?: { id: string; text: string; plan?: IfThen }[];
  projects?: SheetProject[];
  /** Events a task can be filed to. Empty for a caller with none to hand, and
      the row then does not render, the same way Project's does not. */
  events?: SheetEvent[];
  categories: SheetCategory[];
  // UP-CORE-02: the learned median minutes per category (schedule's
  // learnedDurations, three samples inside thirty days or silence), so the
  // Length row can say what this area usually takes without claiming it as
  // this task's answer. Empty where the flow has no history to offer.
  categoryMinutes?: Record<string, number>;
  // UP-CORE-17: the real contacts to choose from. A bounded chooser, never
  // free text (A25): a typed name is the guessing this field replaces.
  // Empty means no Person row at all, so a person with no contacts never
  // meets a control that can only say None.
  people?: { id: string; name: string }[];
  // Provenance of the task being edited, when it was auto-created. A fact
  // line only; the sheet never writes it (coverage map: not editable).
  source?: Source;
  // SHARED-F-17 (2026-09-05): the way to open that source, or undefined when
  // the flow has no route to it, in which case the line stays a plain fact.
  openSourceFor?: (source: Source) => (() => void) | undefined;
  // BRAIN-F-09 (2026-09-05): a parent that writes hands back whether the
  // write landed, so the Saving latch can let go when it did not.
  onSave: (draft: TaskDraft) => void | Promise<boolean | void>;
  onSchedule?: () => void;
  // Break It Down: hands the current text back so the flow can split it into
  // real tasks. Absent when AI is off, so the row never promises nothing.
  onBreakDown?: (text: string) => void;
  // UP-CORE-17 (2026-09-05): "Text Marco about the invoice" without leaving
  // the task. Present only when the linked person has a number, so the row
  // never promises a composer that cannot open.
  onTextPerson?: { name: string; onOpen: () => void };
  onDelete?: () => void;
  onCancel: () => void;
  // LINKED NOTES (Dave 2026-08-28, "very very easy to connect things"): the
  // same reverse-lookup Person/Project/Goal detail already show, brought to
  // the task sheet. onAddNote mirrors Project's "born connected" note (PICK
  // 27) rather than a picker: one tap makes a new note already linked to
  // this task, instead of making you go create one and link it back.
  linkedNotes?: { id: string; title: string; category: string }[];
  onOpenNote?: (id: string) => void;
  onAddNote?: () => void;
}) {
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const weekend = weekendISO(today);
  const nextWeek = nextWeekISO(today);
  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save creates
  // a task, so two taps created two. The first valid tap latches; every tap
  // after that, while this sheet is still mounted, is a no-op.
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState(initial?.text ?? "");
  // No default category (2026-08-09): defaulting to whichever category was
  // first silently mis-tagged every "+" task, the exact poisoning the
  // quick-add path fixed on 2026-08-03. Untagged is honest; tagging is a tap.
  // MULTIPLE CATEGORIES (2026-08-21). One ordered list, primary first. Picking
  // an unpicked area adds it; picking a picked one removes it; picking the
  // primary again promotes the next in line, so the dot can be changed
  // without a second control. The menu stays open while you pick (HeadMenu
  // multi); None clears and closes.
  const [cats, setCats] = useState<string[]>(() =>
    categoriesOf({ category: initial?.category, extraCategories: initial?.extraCategories }));
  const category = cats[0] ?? "";
  const toggleCat = (id: string) => setCats((cur) => {
    if (id === "") return [];
    if (!cur.includes(id)) return [...cur, id];
    if (cur[0] === id && cur.length > 1) return [...cur.slice(1)];  // demote, keep
    return cur.filter((c) => c !== id);
  });
  const [due, setDue] = useState(initial?.due ?? "");
  const [repeat, setRepeat] = useState(initial?.repeat ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [eventId, setEventId] = useState(initial?.eventId ?? "");
  const [personId, setPersonId] = useState(initial?.personId ?? "");

  // THE PICKERS FILL EACH OTHER IN (Dave 2026-09-09: "It should be smart so
  // example: if someone selects a project or event connected to a goal or
  // category it should autofill when it can"). A project and an event both
  // already carry an area; making him pick it a second time is the app
  // knowing the answer and asking anyway.
  //
  // It only fills a BLANK area, and only the primary one. Overwriting an area
  // he set by hand would be the app arguing with him, and adding to the extra
  // set would silently spread a task across areas he never chose. So: if the
  // field is empty, answer it; otherwise leave it entirely alone.
  const fillAreaFrom = (cat: string | undefined) => {
    if (!cat) return;
    setCats((cur) => (cur.length > 0 ? cur : [cat]));
  };
  const pickProject = (id: string) => {
    setProjectId(id);
    fillAreaFrom(projects.find((p) => p.id === id)?.category);
  };
  const pickEvent = (id: string) => {
    setEventId(id);
    fillAreaFrom(events.find((e) => e.id === id)?.category);
  };
  // THE GOAL THIS TASK IS FOR. A task does not get filed to a goal directly:
  // a goal owns projects and a project owns tasks (Architecture C), so the
  // goal is DERIVED from the project rather than picked, and the row is here
  // to answer "what is this for" without a trip to the goal page. It shows
  // only when the picked project actually climbs to one -- an empty Goal row
  // on every task would be a question with no answer.
  const goalTitle = projects.find((p) => p.id === projectId)?.goalTitle ?? "";
  // UP-CORE-02: null means he has not said how long, which is different from
  // zero and is what lets the learned median keep answering.
  const [estimateMin, setEstimateMin] = useState<number | null>(initial?.estimateMin ?? null);
  const lengthLabel = estimateMin === null ? "None" : durLabel(estimateMin);
  const usualWord = categoryMinutes[category] ? durLabel(categoryMinutes[category]!) : "";
  const [err, setErr] = useState(false);

  // STEPS (2026-09-04): a checklist inside the task, edited locally like
  // every other field here and committed whole on Save (TasksService.setSteps
  // mirrors setCategories's "one writer for the whole set"). Index-based
  // addressing, same convention NotesService's checklist items use.
  const [steps, setSteps] = useState<TaskStep[]>(() => (initial?.steps ?? []).map((s) => ({ ...s })));
  const stepRefs = useRef<(HTMLInputElement | null)[]>([]);
  const addStep = () => {
    const at = steps.length;
    setSteps((cur) => [...cur, { text: "", done: false }]);
    // Focuses the new blank line for typing, the same beat as NoteEditor's
    // "Add Item" (the editor focuses it) and TaskSheet's own Pick a Date.
    setTimeout(() => stepRefs.current[at]?.focus(), 0);
  };
  const editStep = (i: number, text: string) => setSteps((cur) => cur.map((s, idx) => (idx === i ? { ...s, text } : s)));
  const toggleStep = (i: number) => setSteps((cur) => cur.map((s, idx) => (idx === i ? { ...s, done: !s.done } : s)));
  // Blank on blur is removed, so no orphaned empty checkbox lingers (same
  // rule NotesService.deleteChecklistItem enforces for note checklists).
  const deleteStep = (i: number) => setSteps((cur) => cur.filter((_, idx) => idx !== i));
  const stepsDone = steps.filter((s) => s.done).length;
  // Ticking the last step offers one-tap Close; it never closes the task for
  // you (catalog spec, jarvis-lifetasks-final.html). Level-triggered on the
  // current list, not the specific tap that finished it, so reopening an
  // already-fully-checked task still offers it.
  const allStepsDone = steps.length > 0 && stepsDone === steps.length;
  const dateRef = useRef<HTMLInputElement>(null);
  // A1: the if-then. Off until he opens it, because a required field on the
  // task sheet would break the three-second capture rule this app lives by.
  const [cueKind, setCueKind] = useState<CueKind>(initial?.plan?.cue.kind ?? "after");
  const [cueWhat, setCueWhat] = useState(initial?.plan?.cue.what ?? "");
  const [thenWhat, setThenWhat] = useState(initial?.plan?.then ?? "");
  const [planOpen, setPlanOpen] = useState(!!initial?.plan);

  const draftPlan: IfThen = { cue: { kind: cueKind, what: cueWhat }, then: thenWhat };
  const planTouched = cueWhat.trim() !== "" || thenWhat.trim() !== "";
  const planWeak = planTouched ? whyWeak(draftPlan) : null;
  const clash = planTouched && cueIsDetectable(draftPlan.cue)
    ? findClash(otherPlans, draftPlan.cue, selfId)
    : null;

  // PICK A DATE DID NOTHING ON THURSDAYS AND SATURDAYS (found 2026-09-03 in
  // the drift sweep; the failing test was blamed on flakiness twice before
  // anyone read it). The mode was derived from the DATE alone, and picking
  // "Pick a Date" seeded today+2 as a starting value. Two days a week that
  // seed lands exactly on another option: from a Thursday, today+2 IS the
  // weekend, and from a Saturday it IS next Monday. The derivation then
  // reported "weekend"/"nextweek", the date row it gates never rendered,
  // and the menu silently snapped to a preset the user had not chosen.
  //
  // A choice is not recoverable from its result. Picking the date wheel is
  // an intent, so it is held as one, and the derivation is only the
  // fallback for a due date arriving from outside (edit mode, a task whose
  // date matches no preset). Any preset clears it, so the two never fight.
  const [picking, setPicking] = useState(false);
  const derivedMode = due === "" ? "none" : due === today ? "today" : due === tomorrow ? "tomorrow"
    : due === weekend ? "weekend" : due === nextWeek ? "nextweek" : "pick";
  const dueMode = picking && due !== "" ? "pick" : derivedMode;
  const dueWord = dueMode === "pick" ? dateWord(due) : undefined;
  const pickDue = (v: string) => {
    if (v !== "pick") setPicking(false);
    if (v === "none") setDue("");
    else if (v === "today") setDue(today);
    else if (v === "tomorrow") setDue(tomorrow);
    else if (v === "weekend") setDue(weekend);
    else if (v === "nextweek") setDue(nextWeek);
    else {
      // Pick a Date: the phone's own wheel, on the date row that appears
      // under Due; the wheel opens itself where the browser allows.
      setPicking(true);
      if (dueMode !== "pick") setDue(addDays(today, 2));
      setTimeout(() => { const el = dateRef.current; if (el) { try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* the row itself is the fallback */ } } }, 0);
    }
  };

  const primaryName = categories.find((c) => c.id === category)?.name ?? "";
  const areaWord = cats.length === 0 ? "None" : cats.length === 1 ? primaryName : `${primaryName} +${cats.length - 1}`;
  const projectWord = projects.find((p) => p.id === projectId)?.title ?? "None";
  const eventWord = events.find((e) => e.id === eventId)?.title ?? "None";
  const personWord = people.find((p) => p.id === personId)?.name ?? "None";

  // closeNow: the "Close Task" offer under a fully-checked list calls
  // save(true) -- one tap both saves the steps and marks the task done. The
  // ordinary Save button calls save() with no argument.
  const save = (closeNow = false) => {
    if (!text.trim()) {
      setErr(true);
      return;
    }
    if (saving) return;
    setSaving(true);
    // BRAIN-F-09 (2026-09-05): a failed write used to hold this latch on
    // "Saving" forever, and Cancel (the only way out) took the draft with it.
    const r = onSave({
      text: text.trim(), ...setCategories(cats), due, repeat, projectId: projectId || undefined, eventId: eventId || undefined,
      // Only a plan that will actually work is saved. A weak one is worse
      // than none: it feels like a plan and carries no effect.
      plan: planTouched && isUsable(draftPlan) ? draftPlan : undefined,
      steps: steps.length ? steps : undefined,
      estimateMin: estimateMin ?? undefined,
      personId: personId || undefined,
      closeNow: closeNow || undefined,
    });
    void Promise.resolve(r).then((ok) => { if (ok === false) setSaving(false); }, () => setSaving(false));
  };

  const showNotes = mode === "edit" && (linkedNotes.length > 0 || !!onAddNote);
  const showActions = mode === "edit" && (!!onSchedule || (!!onBreakDown && !!text.trim()) || !!onTextPerson || !!onDelete);
  const planLine = planOpen ? null : planTouched ? (planWeak ?? sentence(draftPlan)) : "Not set";

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card xs form-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {/* onSave wraps save() in a zero-arg closure on purpose: SheetBar's
            button hands its onClick the click event positionally, and
            save's first parameter is closeNow -- passing `save` directly
            would read every ordinary click as a truthy closeNow. */}
        <SheetBar title={mode === "new" ? "New Task" : "Edit Task"} onCancel={onCancel} onSave={() => save()} saveLabel={saving ? "Saving" : "Save"} />
        <div className="sheet-form">
          {/* SHARED-F-17 (2026-09-05): the sheet's provenance line opens its
              source too, when the flow has a route to it. */}
          <Provenance source={source} {...(source && openSourceFor ? { onOpen: openSourceFor(source) } : {})} />

          <div className="grp xs-grp"><div className="eyebrow">Task</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="red"><CheckSquare className="ic" /></Tile>
              <input
                className={"xs-input" + (err ? " input-error" : "")}
                placeholder="What needs doing?"
                aria-label="Task"
                value={text}
                onChange={(e) => { setText(e.target.value); if (err) setErr(false); }}
              />
            </div>
          </div></div>
          {err && <div className="input-error xs-error">Add a task name.</div>}

          {/* STEPS (2026-09-04, "isn't there supposed to be an option to
              assign steps to a task?"). A checklist line inside this task:
              no dates, no category, no independent existence (catalog:
              jarvis-lifetasks-final.html). Internally these are steps
              (TaskStep, TasksService.setSteps) -- prop and type names may
              stay that word. What a reader SEES never does: "no surface
              calls a task a step" (pick 30, laws.test.ts) is exactly the
              Project-page-vs-Tasks-tab collision this would repeat, so the
              rendered vocabulary is Checklist/Item, matching the identical
              pattern Notes already ships (NoteEditor's checklist block).
              The rollup is display-only and never auto-completes the task
              -- that decision stays his, offered by Close Task below once
              every line is checked. */}
          <div className="grp xs-grp">
            <div className="eyebrow">Checklist</div>
            {steps.length > 0 && <div className="conn-meta">{stepsDone} of {steps.length}</div>}
          </div>
          <div className="pad-x"><div className="card xs-group">
            {steps.map((s, i) => (
              <div className="row xs-row" key={i}>
                <button
                  type="button"
                  className={"cb" + (s.done ? " on" : "")}
                  aria-label={s.done ? "Mark item not done" : "Mark item done"}
                  // A blank line can't be checked, same rule the note
                  // checklist uses: an orphaned checked box says nothing.
                  onClick={() => { if (s.text.trim()) toggleStep(i); }}
                >
                  {s.done && <Check className="ic" />}
                </button>
                <input
                  ref={(el) => { stepRefs.current[i] = el; }}
                  className="xs-input"
                  placeholder="List Item"
                  aria-label={`Checklist item ${i + 1}`}
                  value={s.text}
                  onChange={(e) => editStep(i, e.target.value)}
                  onBlur={() => { if (!s.text.trim()) deleteStep(i); }}
                />
                <button type="button" className="conn-remove" aria-label="Remove item" onClick={() => deleteStep(i)}>
                  <X className="ic" />
                </button>
              </div>
            ))}
            <button type="button" className="row row-act" onClick={addStep}>Add Item</button>
            {allStepsDone && mode === "edit" && (
              <div className="row xs-row">
                <div className="row-grow"><div className="conn-name">Checklist Complete</div></div>
                {/* One tap both saves the checked list and marks the task
                    done -- "it never closes the task for you" means this is
                    an offer, not an auto-complete, not that it takes two taps. */}
                <button type="button" className="pill-act" onClick={() => save(true)}>Close Task</button>
              </div>
            )}
          </div></div>

          <div className="grp xs-grp"><div className="eyebrow">When</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="orange"><Clock className="ic" /></Tile>
              <div className="conn-name">Due
                {slidingNote && <div className="conn-meta">{slidingNote}</div>}
              </div>
              <HeadMenu variant="value" ariaLabel="Due" value={dueMode} label={dueWord} off={dueMode === "none"}
                options={[
                  { value: "none", label: "None" }, { value: "today", label: "Today" }, { value: "tomorrow", label: "Tomorrow" },
                  { value: "weekend", label: "This Weekend" }, { value: "nextweek", label: "Next Week" }, { value: "pick", label: "Pick a Date" },
                ]}
                onPick={pickDue} />
            </div>
            {dueMode === "pick" && (
              <div className="row xs-row xs-date">
                <input ref={dateRef} type="date" className="xs-input" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
            )}
            <div className="row xs-row">
              <Tile tone="green"><RepeatGlyph /></Tile>
              <div className="conn-name">Repeat</div>
              <HeadMenu variant="value" ariaLabel="Repeat" value={repeat} off={repeat === ""}
                options={[{ value: "", label: "None" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]}
                onPick={setRepeat} />
            </div>
            {/* UP-CORE-02 (2026-09-05) · LENGTH. Time blindness is the
                disease: Gap Fill, Plan My Day, What Now and the Day Loop
                draft all sized a task by its CATEGORY's median, so a ten
                minute call and a three hour report were the same size and
                neither ever fit the gap it belonged in. This is the number
                for this one task.

                The learned median is shown as a fact under the row, never
                pre-selected. Selecting it for him would store a number
                JARVIS guessed as one he chose, and from then on the
                category could no longer teach this task anything. */}
            <div className="row xs-row">
              <Tile tone="purple"><Hourglass className="ic" /></Tile>
              <div className="row-grow">
                <div className="conn-name">Length</div>
                {estimateMin === null && usualWord && <div className="conn-meta">Usually {usualWord} in this area</div>}
              </div>
              <HeadMenu variant="value" ariaLabel="Length" value={estimateMin === null ? "" : String(estimateMin)} label={lengthLabel} off={estimateMin === null}
                options={[{ value: "", label: "None" }, ...DUR_CHOICES.map((m) => ({ value: String(m), label: durLabel(m) }))]}
                onPick={(v) => setEstimateMin(v === "" ? null : Number(v))} />
            </div>
          </div></div>

          <div className="grp xs-grp"><div className="eyebrow">Where</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="blue"><Tag className="ic" /></Tile>
              <div className="row-grow">
                <div className="conn-name">Area</div>
                {cats.length > 1 && <div className="conn-meta">{primaryName} is the main one</div>}
              </div>
              <HeadMenu variant="value" ariaLabel="Area" value={category} label={areaWord} off={cats.length === 0} multi picked={cats}
                options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c.id, label: c.name, dot: c.color as string }))]}
                onPick={toggleCat} />
            </div>
            {/* UP-CORE-17 (2026-09-05) · WHO THIS IS ABOUT. "Call Marco
                about the invoice" carried Marco's name in a string and
                nothing else: his card could not list the task without
                guessing from spelling, and the task could not open his Call
                Prep card at all. The chooser hands back a real contact's
                id, so neither end has to guess. */}
            {people.length > 0 && (
              <div className="row xs-row">
                <Tile tone="teal"><User className="ic" /></Tile>
                <div className="conn-name">Person</div>
                <HeadMenu variant="value" ariaLabel="Person" value={personId} label={personWord} off={personId === ""}
                  options={[{ value: "", label: "None" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                  onPick={setPersonId} />
              </div>
            )}
            {projects.length > 0 && (
              <div className="row xs-row">
                <Tile tone="indigo"><FolderKanban className="ic" /></Tile>
                <div className="conn-name">Project</div>
                <HeadMenu variant="value" ariaLabel="Project" value={projectId} label={projectWord} off={projectId === ""}
                  options={[{ value: "", label: "None" }, ...projects.map((p) => ({ value: p.id, label: p.title }))]}
                  onPick={pickProject} />
              </div>
            )}
            {/* WHAT THIS IS FOR (Dave 2026-09-09: "task modals need to include
                events and goals as well"). Derived, not picked: a goal owns
                projects and a project owns tasks, so filing the task to the
                project has already answered the goal question, and a second
                picker that could disagree with the first is a bug waiting to
                be filed. It appears only when the project climbs to a live
                goal. */}
            {goalTitle && (
              <div className="row xs-row">
                <Tile tone="red"><TargetGlyph /></Tile>
                <div className="conn-name">Goal</div>
                <div className="row-val">{goalTitle}</div>
              </div>
            )}
            {/* EVENTS ARE FIRST-CLASS (Dave 2026-09-09: "events are also not
                tied to task modals"). The event page could file a task to
                itself from the day it was built, and that was the wrong half
                to build first: the common case is a task that already exists
                and belongs to Saturday. The menu names the day beside the
                title, because two practices called "Practice" are not the
                same practice. */}
            {events.length > 0 && (
              <div className="row xs-row">
                <Tile tone="sky"><CalendarDays className="ic" /></Tile>
                <div className="conn-name">Event</div>
                <HeadMenu variant="value" ariaLabel="Event" value={eventId} label={eventWord} off={eventId === ""}
                  options={[{ value: "", label: "None" }, ...events.map((e) => ({ value: e.id, label: e.title + " \u00b7 " + e.when }))]}
                  onPick={pickEvent} />
              </div>
            )}
          </div></div>

          <div className="grp xs-grp"><div className="eyebrow">More</div></div>
          <div className="pad-x"><div className="card xs-group">
            {/* A1 · IF-THEN. Gollwitzer and Sheeran: d = 0.65 across 94
                studies. The single highest-leverage field on this sheet, and
                folded by default so capture stays one line and one tap. */}
            <div className="row xs-row" role="button" tabIndex={0} aria-expanded={planOpen} onClick={() => setPlanOpen((o) => !o)}>
              <Tile tone="sky"><PinGlyph /></Tile>
              <div className="row-grow">
                <div className="conn-name">When and Where</div>
                {planLine && planLine !== "Not set" && <div className="conn-meta">{planLine}</div>}
              </div>
              {planLine === "Not set" && <span className="conn-meta">Not set</span>}
              <div className={"chev chev-down" + (planOpen ? " chev-open" : "")} />
            </div>
            {planOpen && (
              <div className="xs-plan">
                <div className="segmented">
                  {(["after", "time", "place"] as CueKind[]).map((k) => (
                    <div
                      key={k}
                      className={"seg" + (cueKind === k ? " active" : "")}
                      role="button" tabIndex={0}
                      onClick={() => { setCueKind(k); setCueWhat(""); }}
                    >{k === "after" ? "After" : k === "time" ? "At" : "Where"}</div>
                  ))}
                </div>
                {cueKind === "time" ? (
                  <input type="time" className="input field-gap" value={cueWhat} onChange={(e) => setCueWhat(e.target.value)} />
                ) : (
                  <input
                    className="input field-gap"
                    placeholder={cueKind === "after" ? "made coffee" : "at my desk"}
                    value={cueWhat}
                    onChange={(e) => setCueWhat(e.target.value)}
                  />
                )}
                <input
                  className="input field-gap"
                  placeholder="e.g. send the invoice"
                  value={thenWhat}
                  onChange={(e) => setThenWhat(e.target.value)}
                />
                {planWeak && <div className="input-error">{planWeak}</div>}
                {!planWeak && clash && <div className="input-error">{clashLine(clash.text)}</div>}
                {!planWeak && !clash && planTouched && (
                  <div className="input-hint">{sentence(draftPlan)}</div>
                )}
              </div>
            )}
            {showNotes && linkedNotes.map((n) => (
              <div
                className="row xs-row"
                role={onOpenNote ? "button" : undefined}
                tabIndex={onOpenNote ? 0 : undefined}
                key={n.id}
                onClick={onOpenNote ? () => onOpenNote(n.id) : undefined}
              >
                <div className={"proj-icon cat-bg-" + (n.category ? catColor(n.category) : "yellow")}><FileText className="ic" /></div>
                <div className="conn-name">{n.title}</div>
                {onOpenNote && <div className="chev"></div>}
              </div>
            ))}
            {showNotes && onAddNote && <button className="row row-act" onClick={onAddNote}>Add a Note</button>}
          </div></div>

          {showActions && (
            <div className="pad-x xs-actions"><div className="card xs-group">
              {onSchedule && (
                <div className="row xs-row" role="button" tabIndex={0} onClick={onSchedule}>
                  <Tile tone="sky"><Calendar className="ic" /></Tile>
                  <div className="conn-name">Add to Schedule</div>
                  <div className="chev"></div>
                </div>
              )}
              {/* The task is big and he is looking at it: the moment to offer
                  splitting it is here, not on some other screen (2026-08-19). */}
              {onBreakDown && text.trim() && (
                <div className="row xs-row" role="button" tabIndex={0} onClick={() => onBreakDown(text.trim())}>
                  <Tile tone="purple"><Sparkles className="ic" /></Tile>
                  <div className="conn-name">Break It Down</div>
                  <div className="chev"></div>
                </div>
              )}
              {/* UP-CORE-17: Messages Drafting, with this task's own words
                  as what the message is about. */}
              {onTextPerson && (
                <div className="row xs-row" role="button" tabIndex={0} onClick={onTextPerson.onOpen}>
                  <Tile tone="teal"><MessageSquare className="ic" /></Tile>
                  <div className="conn-name">Text {onTextPerson.name}</div>
                  <div className="chev"></div>
                </div>
              )}
              {onDelete && <button className="row xs-row xs-del" onClick={onDelete}>Delete Task</button>}
            </div></div>
          )}
          <div className="xs-foot" />
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
