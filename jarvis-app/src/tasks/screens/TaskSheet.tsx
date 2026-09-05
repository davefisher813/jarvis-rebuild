import { createPortal } from "react-dom";
import { categoriesOf, setCategories } from "../categories";
import { useRef, useState, type ReactNode } from "react";
import type { ColorSlot } from "../../categories/types";
import type { TaskStep } from "../../notes/types";
import Provenance from "../../shared/Provenance";
import type { Source } from "../../shared/provenance";
import { whyWeak, isUsable, sentence, findClash, clashLine, cueIsDetectable, type IfThen, type CueKind } from "../ifThen";
import { FileText, CheckSquare, Clock, Tag, FolderKanban, Calendar, Sparkles, Check, X } from "../../shared/icons";
import { RepeatGlyph, PinGlyph } from "../../shared/glyphs";
import { catColor } from "../../shared/categories";
import SheetBar from "../../shared/SheetBar";
import HeadMenu from "../../shared/HeadMenu";
import { addDays } from "../../schedule/calendar";

export interface SheetCategory { id: string; name: string; color: ColorSlot }
export interface TaskDraft {
  text: string; category: string; extraCategories?: string[]; due: string; repeat: string; projectId?: string;
  // A1 (2026-08-20): the if-then plan, when he set one.
  plan?: IfThen;
  // STEPS (2026-09-04): the checklist inside this task, whole-array like the
  // rest of this draft -- see TasksService.setSteps.
  steps?: TaskStep[];
  // Set only by the "Close Task" offer under a fully-checked list: this
  // Save should also mark the task done. Never set by the ordinary Save tap.
  closeNow?: boolean;
}
export interface SheetProject { id: string; title: string }

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
  projects = [],
  source,
  onSave,
  onSchedule,
  onBreakDown,
  onDelete,
  onCancel,
  otherPlans = [],
  selfId,
  linkedNotes = [],
  onOpenNote,
  onAddNote,
}: {
  mode: "new" | "edit";
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
  categories: SheetCategory[];
  // Provenance of the task being edited, when it was auto-created. A fact
  // line only; the sheet never writes it (coverage map: not editable).
  source?: Source;
  onSave: (draft: TaskDraft) => void;
  onSchedule?: () => void;
  // Break It Down: hands the current text back so the flow can split it into
  // real tasks. Absent when AI is off, so the row never promises nothing.
  onBreakDown?: (text: string) => void;
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
    onSave({
      text: text.trim(), ...setCategories(cats), due, repeat, projectId: projectId || undefined,
      // Only a plan that will actually work is saved. A weak one is worse
      // than none: it feels like a plan and carries no effect.
      plan: planTouched && isUsable(draftPlan) ? draftPlan : undefined,
      steps: steps.length ? steps : undefined,
      closeNow: closeNow || undefined,
    });
  };

  const showNotes = mode === "edit" && (linkedNotes.length > 0 || !!onAddNote);
  const showActions = mode === "edit" && (!!onSchedule || (!!onBreakDown && !!text.trim()) || !!onDelete);
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
          <Provenance source={source} />

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
              <div className="conn-name">Due</div>
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
            {projects.length > 0 && (
              <div className="row xs-row">
                <Tile tone="indigo"><FolderKanban className="ic" /></Tile>
                <div className="conn-name">Project</div>
                <HeadMenu variant="value" ariaLabel="Project" value={projectId} label={projectWord} off={projectId === ""}
                  options={[{ value: "", label: "None" }, ...projects.map((p) => ({ value: p.id, label: p.title }))]}
                  onPick={setProjectId} />
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
