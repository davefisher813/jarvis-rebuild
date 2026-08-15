import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Clock, ListChecks } from "lucide-react";
import SkeletonRows from "../../shared/SkeletonRows";
import { Burst } from "../../shared/Burst";
import type { TaskItem } from "../TasksService";
import { urgencyFor, type UrgencyKind } from "../grouping";
import { FILTERS, FILTER_LABEL, type TaskFilter } from "../filters";
import { catColor, catName } from "../../shared/categories";
import type { SheetCategory } from "./TaskSheet";
import { useSwipe } from "../../shared/useSwipe";

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
    return `${counts.overdue} overdue ${counts.overdue === 1 ? "task is" : "tasks are"} waiting.`;
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
}: {
  item: TaskItem;
  today: string;
  onToggle?: (id: string) => void;
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSnooze?: (id: string) => void;
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
        </button>
      )}
      <button className="task-del" onClick={() => onDelete?.(item.id)} aria-label="Delete task">
        <Trash2 className="ic" />
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
          <div className="conn-name truncate">{t.text}</div>
          <div className="eyebrow">{catName(t.category)}{t.recurrence ? " \u00b7 " + t.recurrence : ""}</div>
        </div>
        {u && <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>}
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
  onNew,
  onQuickAdd,
  onClearDone,
  categories,
  catFilter,
  onCatFilter,
  banner,
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
  onNew?: () => void;
  onQuickAdd?: (text: string) => void;
  onClearDone?: () => void;
  categories?: SheetCategory[];
  catFilter?: string;
  onCatFilter?: (id: string) => void;
  banner?: React.ReactNode;
}) {
  const [qa, setQa] = useState("");
  return (
    <div className="screen">
      <div className="nav-bar">
        <div className="nav-large">Tasks</div>
        <button className="nav-action" onClick={onNew} aria-label="New task">
          <Plus className="ic" />
        </button>
      </div>

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

      {onQuickAdd && (
        <div className="pad-x quick-add">
          <input
            className="input"
            aria-label="Add a task"
            placeholder="Add a task"
            value={qa}
            onChange={(e) => setQa(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && qa.trim()) { onQuickAdd(qa); setQa(""); } }}
          />
        </div>
      )}

      {banner}

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
          {/* No button here on purpose. The quick-add field sits directly
              above this and the "+" is in the nav bar, so a third way to make
              a task bought nothing and spent a second red fill on a screen
              that is only allowed one. */}
        </div>
      ) : (
        <div className="pad-x">
          <div className="card">
            {items.map((it) => (
              <Row key={it.id} item={it} today={today} onToggle={onToggle} onOpen={onOpenTask} onDelete={onDeleteTask} onSnooze={onSnoozeTask} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
