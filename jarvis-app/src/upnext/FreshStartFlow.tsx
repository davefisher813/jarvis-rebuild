import { useCallback, useEffect, useState } from "react";
import { useTasks } from "../data/NotesProvider";
import type { TaskItem } from "../tasks/TasksService";
import { todayISO } from "../tasks/grouping";
import { catColor } from "../shared/categories";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
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

  // B6-2 (2026-09-04): "Fresh Start's Run It leaves the button disabled
  // forever." running never had a matching setRunning(false) on a failed
  // write, so one failed setDue in the loop bricked the button with the
  // overlay stuck open and no way to retry. attemptWrite (the same guard
  // Up Next now uses) plus a finally fixes both: on failure the standard
  // toast fires and the button releases; on success nothing changes.
  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const tomorrow = tomorrowOf(today);
      const moved: { id: string; prevDue: string | null }[] = [];
      const ok = await attemptWrite(async () => {
        for (const t of move) {
          moved.push({ id: t.id, prevDue: t.data.due ?? null });
          await svc.setDue(t.id, tomorrow);
        }
      });
      if (!ok) return;
      onDone?.();
      onClose();
      showToast({
        message: move.length > 0 ? `Fresh start · ${move.length} moved to tomorrow` : "Fresh start",
        actionLabel: move.length > 0 ? "Undo" : undefined,
        onAction: move.length > 0
          ? async () => { for (const m of moved) await svc.setDue(m.id, m.prevDue); onDone?.(); }
          : undefined,
      });
    } finally {
      setRunning(false);
    }
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
    <div className="search-overlay ruled">
      <div className="nav-bar">
        <div className="nav-large">Fresh Start</div>
        <button className="nav-action-text" onClick={onClose}>Cancel</button>
      </div>
      <div className="sub-bar"><div className="eyebrow">A day you can still win</div></div>
      {loaded && (
        <>
          <div className="pad-x"><div className="card list-card-ruled">
            {keep.map((t, i) => row(t, i === 0 ? "First, when you're ready" : "Still today"))}
            {move.length > 0 && (
              <div className="row">
                <div className="row-grow">
                  <div className="conn-name fresh-faded">{move.length} moved to tomorrow</div>
                  <div className="conn-meta">Nothing lost</div>
                </div>
              </div>
            )}
          </div></div>
          <div className="pad-x sheet-actions">
            <button className="btn btn-primary btn-block" onClick={run} disabled={running || keep.length + move.length === 0}>
              Run It
            </button>
          </div>
        </>
      )}
    </div>
  );
}
