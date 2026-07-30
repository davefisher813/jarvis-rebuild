import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Clock, ListChecks } from "lucide-react";
import SkeletonRows from "../../shared/SkeletonRows";
import { Burst } from "../../shared/Burst";
import type { TaskItem } from "../TasksService";
import { urgencyFor, type UrgencyKind } from "../grouping";
import { FILTERS, FILTER_LABEL, type TaskFilter } from "../filters";
import { catColor, catName } from "../../shared/categories";
import type { SheetCategory } from "./TaskSheet";

// Tasks page. Two-line rows with a large (44pt) completion target on the left
// and swipe-left-to-delete, so completing or removing a task is one easy action.

const URGENCY_CLASS: Record<UrgencyKind, string> = {
  overdue: "urgency-red",
  today: "urgency-warn",
  soon: "urgency-muted",
};

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
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const decided = useRef(false);
  const horizontal = useRef(false);

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

  const revealW = t.done ? 88 : 176; // open tasks also reveal a "tomorrow" action
  const onStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0]!.clientX;
    startY.current = e.touches[0]!.clientY;
    decided.current = false;
    horizontal.current = false;
    setDragging(true);
  };
  const onMove = (e: React.TouchEvent) => {
    const mx = e.touches[0]!.clientX - startX.current;
    const my = e.touches[0]!.clientY - startY.current;
    // Decide direction once: horizontal claims the gesture (so the page does not
    // scroll), vertical is left alone so the list scrolls normally.
    if (!decided.current) {
      if (Math.abs(mx) > 8 || Math.abs(my) > 8) {
        decided.current = true;
        horizontal.current = Math.abs(mx) > Math.abs(my);
      }
    }
    if (!horizontal.current) return;
    e.preventDefault();
    const base = open ? -revealW : 0;
    setDx(Math.max(-revealW, Math.min(0, base + mx)));
  };
  const onEnd = () => {
    setDragging(false);
    if (!horizontal.current) return;
    const nowOpen = dx < -revealW / 2;
    setOpen(nowOpen);
    setDx(nowOpen ? -revealW : 0);
  };

  return (
    <div className="task-swipe">
      {!t.done && (
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
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
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
            placeholder="Add a task"
            value={qa}
            onChange={(e) => setQa(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && qa.trim()) { onQuickAdd(qa); setQa(""); } }}
          />
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
          <div className="empty-title">No {FILTER_LABEL[filter].toLowerCase()} tasks</div>
          <div className="empty-sub">Add one and I&rsquo;ll keep track of it.</div>
          <button className="btn btn-primary" onClick={onNew}>New Task</button>
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
