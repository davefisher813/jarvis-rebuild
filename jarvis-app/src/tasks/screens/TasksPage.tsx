import React, { useEffect, useRef, useState } from "react";
import PageHeader, { BarAction } from "../../shared/PageHeader";
import { Plus, Trash2, Clock, ListChecks } from "lucide-react";
import SkeletonRows from "../../shared/SkeletonRows";
import { Burst } from "../../shared/Burst";
import type { TaskItem } from "../TasksService";
import { urgencyFor, type UrgencyKind } from "../grouping";
import { FILTERS, FILTER_LABEL, type TaskFilter } from "../filters";
import { categoryLine } from "../categories";
import { catColor, catName } from "../../shared/categories";
import type { SheetCategory } from "./TaskSheet";
import { useSwipe } from "../../shared/useSwipe";
import Provenance from "../../shared/Provenance";
import { capAfterNumber } from "../../shared/casing";
import { cueLine } from "../ifThen";
import { OVERWHELM_EXIT } from "../overwhelmed";
import InlineEdit from "../../shared/InlineEdit";

// Tasks page. Two-line rows with a large (44pt) completion target on the left
// and swipe-left-to-delete, so completing or removing a task is one easy action.

const URGENCY_CLASS: Record<UrgencyKind, string> = {
  overdue: "urgency-red",
  today: "urgency-warn",
  soon: "urgency-muted",
};

// Empty-state copy, written per filter. The old version built the line from
// the filter label ("No " + label + " tasks"), which produced "No today
// tasks", "No done tasks" and "No all tasks". A template that reads wrong in
// half its cases is not worth the line of code it saves.
const EMPTY_TITLE: Record<TaskFilter, string> = {
  all: "No tasks yet",
  daily: "No dailies yet",
  today: "Nothing due today",
  overdue: "Nothing overdue",
  upcoming: "Nothing coming up",
  done: "Nothing completed yet",
};

// The second line exists ONLY when it carries information the user cannot
// already see. "Add one above and I will keep track of it", "Finished tasks
// collect here", "Tasks with a future date land here" are all directions, and
// the app does not ship permanent helper text. The single case that earns a
// line is an empty Today sitting on top of overdue work, because the screen
// otherwise reads as "you are done" when the opposite is true.
function emptySub(filter: TaskFilter, counts: Record<TaskFilter, number>): string | null {
  if (filter === "today" && counts.overdue > 0) {
    return capAfterNumber(`${counts.overdue} overdue waiting`);
  }
  return null;
}

function Row({
  item,
  today,
  onToggle,
  onOpen,
  onDelete,
  onSnooze,
  onRename,
  onStart,
}: {
  item: TaskItem;
  today: string;
  onToggle?: (id: string) => void;
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSnooze?: (id: string) => void;
  // B6 (2026-08-23): rename where it stands, without the sheet.
  onRename?: (id: string, text: string) => void;
  // A2 (audit 2026-08-21): the Tasks tab could not START anything. Every
  // task in the app lived here, and the one thing an ADHD app exists to help
  // with -- getting going -- was only reachable from a card on Today that
  // showed one task. Same pill, same behaviour, same place in the row.
  onStart?: (id: string) => void;
}) {
  const t = item.data;
  const u = urgencyFor(t, today);
  const prevDone = useRef(t.done);
  const [burst, setBurst] = useState(false);
  // Optimistic completion: flip + burst immediately, hold the real toggle
  // 600ms so the row does not unmount (regroup to Done) mid-animation.
  const [localDone, setLocalDone] = useState(false);
  const pendingDone = useRef(false);
  const shownDone = t.done || localDone;
  // Open tasks also reveal a "tomorrow" action; BILLS DO NOT (Money v1):
  // pushing rent to tomorrow in one gesture is exactly the ADHD-tax move the
  // money track exists to stop. Delete stays; deferral needs the sheet.
  const snoozable = !t.done && !t.bill;
  const { dx, dragging, handlers } = useSwipe({ revealW: snoozable ? 176 : 88 });

  useEffect(() => {
    if (t.done && !prevDone.current) {
      setBurst(true);
      const id = setTimeout(() => setBurst(false), 650);
      prevDone.current = t.done;
      return () => clearTimeout(id);
    }
    prevDone.current = t.done;
  }, [t.done]);

  const tapCheck = () => {
    if (pendingDone.current) return;
    if (t.done) { onToggle?.(item.id); return; } // un-completing: no ceremony
    pendingDone.current = true;
    setLocalDone(true);
    setBurst(true);
    setTimeout(() => setBurst(false), 650);
    setTimeout(() => { pendingDone.current = false; setLocalDone(false); onToggle?.(item.id); }, 600);
  };

  return (
    <div className="task-swipe">
      {snoozable && (
        <button className="task-snooze" onClick={() => onSnooze?.(item.id)} aria-label="Move to tomorrow">
          <Clock className="ic" />
          <span className="swipe-label">Tomorrow</span>
        </button>
      )}
      {/* B13 (2026-08-23): a clock and a trash can, side by side, in two
          coloured slots, with nothing saying which is which. Both say their
          names now. Reveal width is unchanged: the labels fit 88px. */}
      <button className="task-del" onClick={() => onDelete?.(item.id)} aria-label="Delete task">
        <Trash2 className="ic" />
        <span className="swipe-label">Delete</span>
      </button>
      <div
        className={"task-row" + (t.done ? " completed" : "") + (burst ? " just-done" : "") + (dragging ? " swiping" : "")}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        {...handlers}
      >
        <div
          className="task-check-tap"
          onClick={(e) => { e.stopPropagation(); tapCheck(); }}
          role="checkbox"
          aria-checked={shownDone}
          aria-label={shownDone ? "Mark not done" : "Mark done"}
        >
          <div className={"task-check " + (shownDone ? "done" : "cat-bd-" + catColor(t.category))} />
          <Burst show={burst} />
        </div>
        <div className="row-stack" role="button" tabIndex={0} onClick={() => onOpen?.(item.id)}>
          {/* B6 (2026-08-23): THE TITLE EDITS WHERE IT STANDS.
              This is InlineEdit's own stated doctrine, applied to the list
              that needed it most: "if you can see it, you can change it,
              where it stands. Tap gives the caret, blur or Enter saves, and
              there is no Save button because editing in place IS the
              feedback." The primitive had two consumers and neither was a
              task row, so fixing a typo cost a sheet.

              The rest of the row still opens the full editor, exactly the
              way tapping the time on a schedule row changes the time while
              tapping the row opens everything. stopPropagation keeps the two
              from firing together. */}
          {onRename && !t.done ? (
            <div onClick={(ev) => ev.stopPropagation()}>
              <InlineEdit
                className="conn-name truncate"
                value={t.text}
                onSave={(v) => { const next = v.trim(); if (next && next !== t.text) onRename(item.id, next); }}
              />
            </div>
          ) : (
            <div className="conn-name truncate">{t.text}</div>
          )}
          {/* The primary keeps the colour; the tags ride the same line as
              plain facts (2026-08-21). Colouring all of them would spend
              three colours saying one thing. */}
          <div className={"eyebrow cat-fg-" + catColor(t.category)}>{categoryLine(t, catName)}{t.recurrence ? " \u00b7 " + t.recurrence : ""}</div>
          {/* A1: the cue, where he will see it while scanning. The whole
              sentence is on the sheet; the row carries the trigger, which is
              the half that has to be recognisable in the moment. */}
          {t.plan && <div className="task-cue">{cueLine(t.plan)}</div>}
          {/* Provenance Line (addendum item 8): auto-created rows say where
              they came from; hand-made rows render nothing here. */}
          <Provenance source={t.source} />
        </div>
        {/* The urgency label steps aside for Start, exactly as it does on
            Today: knowing a thing is due is worth less than a way to begin
            it, and two pills on one row is the clutter that made the audit
            flag this list in the first place. */}
        {onStart && !shownDone
          ? <button className="pill-act" onClick={(e) => { e.stopPropagation(); onStart(item.id); }}>Start</button>
          : u && <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>}
      </div>
    </div>
  );
}

export default function TasksPage({
  filter,
  counts,
  items,
  loading,
  today,
  onFilter,
  onToggle,
  onOpenTask,
  onDeleteTask,
  onSnoozeTask,
  onStartTask,
  onNew,
  onRenameTask,
  onClearDone,
  categories,
  catFilter,
  onCatFilter,
  banner,
  momentum,
  onPickOne,
  onOverwhelmed,
  onCalm,
  overwhelmed = false,
  onMoveAllToToday,
}: {
  filter: TaskFilter;
  counts: Record<TaskFilter, number>;
  items: TaskItem[];
  loading?: boolean;
  today: string;
  onFilter?: (f: TaskFilter) => void;
  onToggle?: (id: string) => void;
  onOpenTask?: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onSnoozeTask?: (id: string) => void;
  onStartTask?: (id: string) => void;
  onNew?: () => void;
  onRenameTask?: (id: string, text: string) => void;
  onClearDone?: () => void;
  categories?: SheetCategory[];
  catFilter?: string;
  onCatFilter?: (id: string) => void;
  banner?: React.ReactNode;
  // Momentum Chain: a suggestion element pinned under the row it follows.
  momentum?: { afterId: string; el: React.ReactNode } | null;
  // THE DECISION KILLERS (Dave 2026-08-19, ADHD round). Pick One opens the
  // single best task for right now so the list never has to be read; Move
  // All resets an overdue pile in one tap instead of one tap per shame.
  onPickOne?: () => void;
  // F1: hide everything but the one smallest thing. A view, never a write.
  onOverwhelmed?: () => void;
  onCalm?: () => void;
  overwhelmed?: boolean;
  onMoveAllToToday?: () => void;
}) {
  return (
    <div className="screen">
      <PageHeader title="Tasks" actions={<BarAction label="New Task" onClick={onNew}><Plus className="ic" /></BarAction>} />

      {/* F1 · I'M OVERWHELMED. When it is on, the page IS the one thing:
          everything else is hidden, nothing is moved, and one tap brings it
          all back. The research is specific that the cut has to be to one,
          because three is still a decision. */}
      {overwhelmed ? (
        <div className="pad-x pick-one">
          <button className="btn btn-block" onClick={onCalm}>{OVERWHELM_EXIT}</button>
        </div>
      ) : (
        <>
          {onPickOne && counts.all > 0 && (
            <div className="pad-x pick-one">
              <button className="btn btn-primary btn-block btn-lg" onClick={onPickOne}>Just Pick One For Me</button>
            </div>
          )}
          {onOverwhelmed && counts.all > 2 && (
            <div className="pad-x pick-one">
              <button className="btn btn-block" onClick={onOverwhelmed}>I'm Overwhelmed</button>
            </div>
          )}
        </>
      )}

      <div className="chip-row">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={"chip" + (f === filter ? " active" : "")}
            onClick={() => onFilter?.(f)}
          >
            {FILTER_LABEL[f]} &middot; {counts[f]}
          </button>
        ))}
      </div>

      {categories && categories.length > 0 && (
        <div className="chip-row">
          <button className={"chip" + (!catFilter || catFilter === "all" ? " active" : "")} onClick={() => onCatFilter?.("all")}>All</button>
          {categories.map((c) => (
            <button key={c.id} className={"chip" + (catFilter === c.id ? " active" : "")} onClick={() => onCatFilter?.(c.id)}>
              <span className={"cat-dot cat-bg-" + c.color} />{c.name}
            </button>
          ))}
        </div>
      )}

      {/* THE DUPLICATE ADD BOX IS GONE (2026-08-21, Dave: "Add task type box
          makes no sense"). It was a plain text field that parsed dates and
          nothing else, sitting one screen above the JARVIS capture bar, which
          does the same job and also reads categories, people and projects.
          Two boxes, one job, and the worse one was on top. */}

      {banner}

      {filter === "overdue" && items.length > 0 && onMoveAllToToday && (
        <div className="sh2">
          <span className="t">Overdue</span>
          <span className="n">{items.length}</span>
          <button className="see-all" onClick={onMoveAllToToday}>Move All to Today</button>
        </div>
      )}

      {filter === "done" && counts.done > 0 && onClearDone && (
        <div className="pad-x clear-done">
          <button className="btn btn-secondary" onClick={onClearDone}>Clear {counts.done} Completed</button>
        </div>
      )}

      {loading ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><ListChecks className="ic" /></div>
          <div className="empty-title">{EMPTY_TITLE[filter]}</div>
          {emptySub(filter, counts) && <div className="empty-sub">{emptySub(filter, counts)}</div>}
          {/* No button here WHEN THERE IS ANOTHER RED. The "+" in the nav bar
              is the way to make a task, and a second red fill on a screen
              allowed only one is what the removed quick-add box was spending.

              B14 (2026-08-23): that reasoning has a hole, and it opens in
              exactly the case this branch renders. The red it defers to is
              Just Pick One For Me, which is gated on `counts.all > 0`. With
              no tasks at all, that button does not render, this screen has
              ZERO red fills, and the argument for withholding one is spending
              a budget nothing is using. A first-run user got a page that
              named its own emptiness and offered nothing.

              So: still nothing when there is a task somewhere to pick, and
              the obvious next tap when the whole list is empty. */}
          {onNew && counts.all === 0 && (
            <button className="btn btn-primary" onClick={onNew}>New Task</button>
          )}
        </div>
      ) : (
        <div>
          {/* Library form (Design 2, approved 2026-08-18): full-bleed rows,
              dividers inset past the checkbox, no card. */}
          {items.map((it) => (
            <React.Fragment key={it.id}>
              <Row item={it} today={today} onToggle={onToggle} onOpen={onOpenTask} onDelete={onDeleteTask} onSnooze={onSnoozeTask} onStart={onStartTask} onRename={onRenameTask} />
              {/* Momentum Chain (addendum item 7): the suggestion slides
                  into the just-finished slot, right below its row. */}
              {momentum?.afterId === it.id && momentum.el}
            </React.Fragment>
          ))}
          {/* B8 (2026-08-23): EVERY LIST ENDS WITH THE WAY TO GROW IT.
              The "+" in the nav bar is the only way to add a task from this
              screen, which means the answer to "I just thought of one more"
              is at the far top of a list you have scrolled to the bottom of.
              One row costs less than that hunt.

              NEUTRAL, never a fill: .row-act is what components.css calls
              "the ONE sanctioned bare-text action", and it is exactly why
              this can coexist with the one-red law that the old comment above
              cited as the reason not to have it at all.

              Not shown on the done list, where "add a completed task" is not
              a thing anyone wants, and not shown while the overwhelmed view
              is deliberately collapsing the page to one thing. */}
          {onNew && filter !== "done" && !overwhelmed && items.length > 0 && (
            // .row-act centres itself with `margin: auto`, which works in the
            // flex-column CARD its other 26 call sites live in and does
            // nothing in a plain block parent like this full-bleed list. The
            // walk caught it hanging off the left edge. One flex wrapper
            // rather than touching a class 26 places depend on.
            <div className="list-foot"><button className="row-act" onClick={onNew}>Add a Task</button></div>
          )}
        </div>
      )}
      {/* This page had no foot spacer at all, so its last row sat under the
          capture bar with nothing below it to scroll (2026-08-24 walk, which
          found Add a Task permanently covered). Every other scrolling screen
          in the app already ends with one. */}
      <div className="screen-foot" />
    </div>
  );
}
