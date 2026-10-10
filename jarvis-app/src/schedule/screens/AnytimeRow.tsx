import { useState, type PointerEvent as RPointerEvent } from "react";
import { onPressKey } from "../../shared/pressable";
import type { TaskItem } from "../../tasks/TasksService";
import { originLabel } from "../../tasks/origin";
import { distanceFor, todayISO } from "../../tasks/grouping";
import CatChipLine from "../../shared/CatChipLine";
import { categoriesOf } from "../../tasks/categories";
import { catName } from "../../shared/categories";
import type { ParentLine } from "../../life/parent";
import { useSwipe } from "../../shared/useSwipe";
import type { RowAction } from "../../shared/RowActionSheet";
import { useRowMenu } from "../../shared/useRowMenu";
import RowCtxAction from "../../shared/RowCtxAction";
import { CalendarPlus, Check, Trash2 } from "../../shared/icons";
import { titleCase } from "../../shared/casing";

// Roadmap v2, the Anytime strip on the Schedule day view. Tasks with no time,
// checkable, above the timed grid. Collapses to a cap so a long list never
// pushes the day off screen; tap the name to give the task a time, tap the
// circle to complete it. One row component (same check + category color as the
// Tasks page), laid out for the all-day band.
//
// ONE DOOR (Dave 2026-08-31, Schedule screenshot: "'9 open' should be in a
// white/black button like the home page"). The count IS the expand toggle
// now, wearing the same ghost pill every home-page head action wears
// (.see-all.pill-action), and the old "N more" footer door is gone -- two
// controls that opened the same list was the duplicate-door pattern. When
// the list fits under the cap there is nothing to expand, so the count
// stays a quiet label: a button that does nothing is not a button.
const DEFAULT_CAP = 5;

export default function AnytimeRow({
  items,
  onToggle,
  onSchedule,
  onDelete,
  onOpen,
  onDragStart,
  cap = DEFAULT_CAP,
  parentOf,
  today = todayISO(),
}: {
  items: TaskItem[];
  onToggle?: (id: string) => void;
  onSchedule?: (id: string) => void;
  /** Swipe left, Delete: behind the reveal where it is on every task list. The flow owns the write and the Undo toast. */
  onDelete?: (id: string) => void;
  /** Open the task in the same TaskSheet Today and Tasks open. */
  onOpen?: (id: string) => void;
  onDragStart?: (id: string, label: string, e: RPointerEvent) => void;
  cap?: number;
  // THE RULED ROW (2026-09-01): the second line names the goal the task
  // moves, by its short name, or the category when it moves none.
  parentOf?: (t: TaskItem) => ParentLine | null;
  /** The day an overdue task is measured against (the page's own today). */
  today?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const overflow = items.length - cap;
  const shown = expanded ? items : items.slice(0, cap);

  return (
    <>
      {/* The ruled section head: caps, leader, the count or the door. */}
      <div className="sh2 sh2-quiet anytime-head">
          <span className="t">Anytime</span>
          {overflow > 0 ? (
            <button
              className="see-all pill-action"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? "Show fewer anytime tasks" : `Show all ${items.length} anytime tasks`}
            >
              {expanded ? "Show Less" : `${items.length} Open`}
            </button>
          ) : (
            <span className="n">{items.length}</span>
          )}
      </div>
      <div className="pad-x">
        <div className="card list-card-ruled anytime-card">
          {shown.map((it) => (
            <AnytimeItem
              key={it.id}
              it={it}
              parent={parentOf?.(it) ?? null}
              today={today}
              {...(onToggle ? { onToggle } : {})}
              {...(onSchedule ? { onSchedule } : {})}
              {...(onDelete ? { onDelete } : {})}
              {...(onOpen ? { onOpen } : {})}
              {...(onDragStart ? { onDragStart } : {})}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// THE ROW IS CLEAN (Dave 2026-10-05, locked: "Clean rows, no pills anywhere"; ROW-ACTIONS-SPEC.md). It used to carry a Drop
// pill in its trailing slot, the contract's verb for "give this a time in the day" (§4.4: Start on Tasks, Drop on
// Anytime). Drop is the swipe-left now, the first line of the long-press menu, and "Add to Schedule" on the task's sheet; a
// swipe right completes. The ring stays on the row (state, not a command). THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I
// want all rows clickable"): a tap opens the task in the same TaskSheet Today and Tasks open, which holds every action.
// A long press that moves is still the drag onto the grid (SchedulePage's beginDrag, which cancels on the first move); one
// that holds still is the menu. A task that is overdue is the row whose moment has come, so it surfaces Drop as one quiet
// word (RowCtxAction, never a capsule); a task that is not stays clean.
function AnytimeItem({ it, parent, today, onToggle, onSchedule, onDelete, onOpen, onDragStart }: {
  it: TaskItem;
  parent: ParentLine | null;
  today: string;
  onToggle?: (id: string) => void;
  onSchedule?: (id: string) => void;
  onDelete?: (id: string) => void;
  onOpen?: (id: string) => void;
  onDragStart?: (id: string, label: string, e: RPointerEvent) => void;
}) {
  const title = titleCase(it.data.text);
  // THE CHIP (Dave 2026-10-09, the unified chip): the task's own first named area, else its project's or event's, with the
  // project or event beside it. The same piece every task row and note row uses.
  const chipCat = [...categoriesOf(it.data), parent?.cat].find((id): id is string => !!id && !!catName(id)) ?? null;
  const chipWords = parent && parent.kind !== "category" ? parent.name : null;
  const dist = distanceFor(it.data, today);
  const droppable = !!onSchedule;
  const completable = !!onToggle;
  const deletable = !!onDelete;
  const menuActions: RowAction[] = [
    ...(droppable ? [{ label: "Drop", onPick: () => onSchedule!(it.id) }] : []),
    ...(completable ? [{ label: "Done", onPick: () => onToggle!(it.id) }] : []),
    ...(onOpen ? [{ label: "Open Task", onPick: () => onOpen(it.id) }] : []),
    ...(deletable ? [{ label: "Delete", destructive: true, onPick: () => onDelete!(it.id) }] : []),
  ];
  const rowMenu = useRowMenu({ title, actions: menuActions, swipeEnabled: droppable || deletable || completable });
  const swipe = useSwipe({
    revealW: ((droppable ? 1 : 0) + (deletable ? 1 : 0)) * 88,
    rightW: completable ? 88 : 0,
    ...(completable ? { onRightCommit: () => onToggle!(it.id) } : {}),
    enabled: droppable || deletable || completable,
    onLongPress: rowMenu.onLongPress,
  });
  const { dx, dragging, open: swipeOpen, closeThen } = swipe;
  const { handlers: menuHandlers, sheet } = rowMenu.bind(swipe);
  // The drag (SchedulePage's pointer drop zone) starts on pointer-down, beside the hold, as it always did.
  const rowHandlers = { ...menuHandlers, onPointerDown: (e: React.PointerEvent) => onDragStart?.(it.id, title, e) };
  return (
    <div className="task-swipe">
      {completable && (
        <div className="task-done-rail" aria-hidden="true">
          <Check className="ic" />
          <span className="swipe-label">Done</span>
        </div>
      )}
      {droppable && (
        <button className="task-verb" onClick={() => closeThen(() => onSchedule!(it.id))} aria-label={"Give " + title + " a time"}>
          <CalendarPlus className="ic" />
          <span className="swipe-label">Drop</span>
        </button>
      )}
      {deletable && (
        <button className="task-del" style={droppable ? { right: 88 } : undefined} onClick={() => closeThen(() => onDelete!(it.id))} aria-label={"Delete " + title}>
          <Trash2 className="ic" />
          <span className="swipe-label">Delete</span>
        </button>
      )}
      <div
        className={"task-row anytime-row" + (dragging ? " swiping" : "")}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        role="button"
        tabIndex={0}
        aria-label={"Open " + title}
        {...rowHandlers}
        onClick={() => { if (swipeOpen || dx) { closeThen(); return; } onOpen?.(it.id); }}
        onKeyDown={(e) => { if (e.target === e.currentTarget) onPressKey(() => onOpen?.(it.id))(e); }}
      >
        <div
          className="task-check-tap"
          onClick={(e) => { e.stopPropagation(); onToggle?.(it.id); }}
          role="checkbox"
          aria-checked={false}
          aria-label={"Complete " + title}
        >
          <div className="task-check" />
        </div>
        <div className="task-title">
          <span className="task-name">{title}</span>
          <div className="r-k">
            {parent
              ? <CatChipLine category={chipCat} text={chipWords} />
              : originLabel(it.data)
                ? <span className="r-goal r-cat">{originLabel(it.data)}</span>
                : null}
          </div>
        </div>
        <RowCtxAction when={droppable && dist?.kind === "late"} label="Drop" ariaLabel={"Give " + title + " a time"} onAct={() => onSchedule?.(it.id)} />
      </div>
      {sheet}
    </div>
  );
}
