import { createPortal } from "react-dom";
import { categoriesOf, setCategories } from "../categories";
import { useState } from "react";
import type { ColorSlot } from "../../categories/types";
import Provenance from "../../shared/Provenance";
import type { Source } from "../../shared/provenance";
import { whyWeak, isUsable, sentence, findClash, clashLine, cueIsDetectable, type IfThen, type CueKind } from "../ifThen";
import { FileText } from "../../shared/icons";
import { catColor } from "../../shared/categories";

export interface SheetCategory { id: string; name: string; color: ColorSlot }
export interface TaskDraft {
  text: string; category: string; extraCategories?: string[]; due: string; repeat: string; projectId?: string;
  // A1 (2026-08-20): the if-then plan, when he set one.
  plan?: IfThen;
}
export interface SheetProject { id: string; title: string }

const DAY = 86400000;
const isoOf = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayISO = () => isoOf(new Date());
const addDaysISO = (base: string, n: number) => isoOf(new Date(new Date(base + "T00:00:00").getTime() + n * DAY));

// Bottom sheet to create or edit a task. All saves call existing TaskService
// methods; this is presentational + local form state only.
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
  // real tasks. Absent when AI is off, so the button never promises nothing.
  onBreakDown?: (text: string) => void;
  onDelete?: () => void;
  onCancel: () => void;
  // LINKED NOTES (Dave 2026-08-28, "very very easy to connect things"): the
  // same reverse-lookup Person/Project/Goal detail already show, brought to
  // the task sheet. onAddNote mirrors Project's "born connected" note (PICK
  // 27) rather than a picker -- one tap makes a new note already linked to
  // this task, instead of making you go create one and link it back.
  linkedNotes?: { id: string; title: string; category: string }[];
  onOpenNote?: (id: string) => void;
  onAddNote?: () => void;
}) {
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  const [text, setText] = useState(initial?.text ?? "");
  // No default category (2026-08-09): defaulting to whichever category was
  // first silently mis-tagged every "+" task, the exact poisoning the
  // quick-add path fixed on 2026-08-03. Untagged is honest; tagging is a tap.
  // MULTIPLE CATEGORIES (2026-08-21). One ordered list, primary first. Tapping
  // an unpicked chip adds it; tapping a picked one removes it; tapping the
  // primary again promotes the next in line, so the dot can be changed without
  // a second control.
  const [cats, setCats] = useState<string[]>(() =>
    categoriesOf({ category: initial?.category, extraCategories: initial?.extraCategories }));
  const category = cats[0] ?? "";
  const toggleCat = (id: string) => setCats((cur) => {
    if (!cur.includes(id)) return [...cur, id];
    if (cur[0] === id && cur.length > 1) return [...cur.slice(1)];  // demote, keep
    return cur.filter((c) => c !== id);
  });
  const [due, setDue] = useState(initial?.due ?? "");
  const [repeat, setRepeat] = useState(initial?.repeat ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [err, setErr] = useState(false);
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

  const dueMode = due === "" ? "none" : due === today ? "today" : due === tomorrow ? "tomorrow" : "pick";

  const save = () => {
    if (!text.trim()) {
      setErr(true);
      return;
    }
    onSave({
      text: text.trim(), ...setCategories(cats), due, repeat, projectId: projectId || undefined,
      // Only a plan that will actually work is saved. A weak one is worse
      // than none: it feels like a plan and carries no effect.
      plan: planTouched && isUsable(draftPlan) ? draftPlan : undefined,
    });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Task" : "Edit Task"}</div></div>
        <div className="pad-x sheet-form">
          <Provenance source={source} />
          <div className="field">
            <label className="input-label">Task <span className="input-req">*</span></label>
            <input
              className="input"
              placeholder="What needs doing?"
              value={text}
              onChange={(e) => { setText(e.target.value); if (err) setErr(false); }}
            />
            {err && <div className="input-error">Add a task name.</div>}
          </div>

          {/* A1 · IF-THEN. Gollwitzer and Sheeran: d = 0.65 across 94
              studies. The single highest-leverage field on this sheet, and
              collapsed by default so capture stays one line and one tap. */}
          <div className="field">
            {!planOpen ? (
              <button className="row-act" onClick={() => setPlanOpen(true)}>Add a When and Where</button>
            ) : (
              <>
                <div className="input-label">When You'll Do It</div>
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
              </>
            )}
          </div>

          <div className="field">
            <div className="input-label">Category</div>
            {/* Picking a category is the same act here as on the Tasks page,
                so it wears the same selected state. It used to swap the whole
                chip to the category colour and drop the dot, which meant one
                idea had two looks on two screens, and it spent a colour on a
                thing the dot was already saying. */}
            <div className="chip-row cat-pick">
              <div className={"chip" + (cats.length === 0 ? " active" : "")} role="button" tabIndex={0} aria-pressed={cats.length === 0} onClick={() => setCats([])}>None</div>
              {categories.map((c) => {
                const at = cats.indexOf(c.id);
                return (
                <div
                  key={c.id}
                  className={"chip" + (at >= 0 ? " active" : "")}
                  role="button"
                  tabIndex={0}
                  aria-pressed={at >= 0}
                  onClick={() => toggleCat(c.id)}
                >
                  <span className={"cat-dot cat-bg-" + c.color} />
                  {c.name}
                  {/* Only the primary is marked, and only when there is more
                      than one: a badge on a single pick would be noise. */}
                  {at === 0 && cats.length > 1 && <span className="cat-main">Main</span>}
                </div>
                );
              })}
            </div>
          </div>

          {cats.length > 1 && (
            <div className="input-help">{categories.find((c) => c.id === category)?.name ?? "The first"} is the main one · Tap it to pass that to the next</div>
          )}

          <div className="field">
            <div className="input-label">Due</div>
            <div className="segmented">
              <div className={"seg" + (dueMode === "none" ? " active" : "")} role="button" tabIndex={0} onClick={() => setDue("")}>None</div>
              <div className={"seg" + (dueMode === "today" ? " active" : "")} role="button" tabIndex={0} onClick={() => setDue(today)}>Today</div>
              <div className={"seg" + (dueMode === "tomorrow" ? " active" : "")} role="button" tabIndex={0} onClick={() => setDue(tomorrow)}>Tomorrow</div>
              <div className={"seg" + (dueMode === "pick" ? " active" : "")} role="button" tabIndex={0} onClick={() => setDue(dueMode === "pick" && due ? due : addDaysISO(today, 2))}>Pick</div>
            </div>
            {dueMode === "pick" && (
              <input type="date" className="input field-gap" value={due} onChange={(e) => setDue(e.target.value)} />
            )}
          </div>

          <div className="field">
            <div className="input-label">Repeat</div>
            <div className="segmented">
              {([["", "None"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]] as const).map(([val, label]) => (
                <div key={val} className={"seg" + (repeat === val ? " active" : "")} role="button" tabIndex={0} onClick={() => setRepeat(val)}>{label}</div>
              ))}
            </div>
          </div>

          {projects.length > 0 && (
            <div className="field">
              <div className="input-label">Project</div>
              <div className="chip-row">
                <div className={"chip" + (projectId === "" ? " active" : "")} role="button" tabIndex={0} onClick={() => setProjectId("")}>None</div>
                {projects.map((p) => (
                  <div key={p.id} className={"chip" + (projectId === p.id ? " active" : "")} role="button" tabIndex={0} onClick={() => setProjectId(p.id)}>{p.title}</div>
                ))}
              </div>
            </div>
          )}

          {mode === "edit" && (linkedNotes.length > 0 || onAddNote) && (
            <div className="field">
              <div className="input-label">Linked Notes</div>
              <div className="card">
                {linkedNotes.map((n) => (
                  <div
                    className="row"
                    role={onOpenNote ? "button" : undefined}
                    tabIndex={onOpenNote ? 0 : undefined}
                    key={n.id}
                    onClick={onOpenNote ? () => onOpenNote(n.id) : undefined}
                  >
                    <div className={"proj-icon cat-bg-" + (n.category ? catColor(n.category) : "graphite")}><FileText className="ic" /></div>
                    <div className="conn-name">{n.title}</div>
                    {onOpenNote && <div className="chev"></div>}
                  </div>
                ))}
                {onAddNote && <button className="row row-act" onClick={onAddNote}>Add a Note</button>}
              </div>
            </div>
          )}
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {mode === "edit" && onSchedule && (
            <button className="btn btn-secondary btn-block" onClick={onSchedule}>Add to Schedule</button>
          )}
          {/* The task is big and he is looking at it: the moment to offer
              splitting it is here, not on some other screen (2026-08-19). */}
          {mode === "edit" && onBreakDown && text.trim() && (
            <button className="btn btn-secondary btn-block" onClick={() => onBreakDown(text.trim())}>Break It Down</button>
          )}
          {mode === "edit" && onDelete && (
            <button className="btn btn-secondary btn-block btn-danger-text" onClick={onDelete}>Delete Task</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
