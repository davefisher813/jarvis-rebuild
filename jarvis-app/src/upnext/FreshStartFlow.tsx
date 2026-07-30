import { useCallback, useEffect, useState } from "react";
import { useTasks } from "../data/NotesProvider";
import type { TaskItem } from "../tasks/TasksService";
import { todayISO } from "../tasks/grouping";
import { catColor } from "../shared/categories";
import { showToast } from "../shared/toast";
import { freshStartPlan, tomorrowOf } from "./upnext";

// Fresh Start (ADHD strategy Phase 1): the 2pm recovery moment. Keeps the top
// of the deck, moves the rest of today's open load to tomorrow, and never uses
// shame language. Entered only from the Today banner when the day is actually
// off track; canceling changes nothing (escape hatches lead somewhere).

export default function FreshStartFlow({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const svc = useTasks();
  const today = todayISO();
  const [keep, setKeep] = useState<TaskItem[]>([]);
  const [move, setMove] = useState<TaskItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);

  const reload = useCallback(async () => {
    const items = await svc.listTasks();
    const plan = freshStartPlan(items, today);
    setKeep(plan.keep);
    setMove(plan.move);
    setLoaded(true);
  }, [svc, today]);

  useEffect(() => { void reload(); }, [reload]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    const tomorrow = tomorrowOf(today);
    const moved: { id: string; prevDue: string | null }[] = [];
    for (const t of move) {
      moved.push({ id: t.id, prevDue: t.data.due ?? null });
      await svc.setDue(t.id, tomorrow);
    }
    onDone?.();
    onClose();
    showToast({
      message: move.length > 0 ? `Fresh start. ${move.length} moved to tomorrow.` : "Fresh start.",
      actionLabel: move.length > 0 ? "Undo" : undefined,
      onAction: move.length > 0
        ? async () => { for (const m of moved) await svc.setDue(m.id, m.prevDue); onDone?.(); }
        : undefined,
    });
  };

  const row = (t: TaskItem, sub: string, faded = false) => (
    <div className="row" key={t.id} style={undefined}>
      <span className={"cat-dot cat-bg-" + catColor(t.data.category)} />
      <div className="row-grow">
        <div className={"conn-name" + (faded ? " fresh-faded" : "")}>{t.data.text}</div>
        <div className="conn-meta">{sub}</div>
      </div>
    </div>
  );

  return (
    <div className="search-overlay">
      <div className="nav-bar">
        <div className="nav-large">Fresh Start</div>
        <button className="nav-action-text" onClick={onClose}>Cancel</button>
      </div>
      <div className="sub-bar"><div className="eyebrow">A day you can still win</div></div>
      {loaded && (
        <div className="pad-x sheet-form">
          <div className="card">
            {keep.map((t, i) => row(t, i === 0 ? "First, when you're ready" : "Still today"))}
            {move.length > 0 && (
              <div className="row">
                <div className="row-grow">
                  <div className="conn-name fresh-faded">{move.length} moved to tomorrow</div>
                  <div className="conn-meta">Nothing lost</div>
                </div>
              </div>
            )}
          </div>
          <button className="btn btn-primary btn-block" onClick={run} disabled={running || keep.length + move.length === 0}>
            Run It
          </button>
        </div>
      )}
    </div>
  );
}
