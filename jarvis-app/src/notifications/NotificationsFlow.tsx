import { useCallback, useEffect, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { useTasks, useSchedule, useGoals, useAreas, useProfile } from "../data/NotesProvider";
import { todayISO } from "../ai/useAIContext";
import { buildFeed, type Nudge, type NudgeKind } from "./feed";
import { RowGlyph, type RowKind } from "../shared/anatomy";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { BellGlyph } from "../shared/glyphs";

const BELL = <BellGlyph />;

// V2 anatomy: rows lead with the shared TYPE tile, not a per-surface icon
// set. What a nudge IS (task, event, goal) reads before its words do.
const KIND: Record<NudgeKind, RowKind> = {
  overdue: "task",
  due_today: "task",
  event: "event",
  goal_risk: "goal",
  area_drift: "goal",
};

// A1 (audit 2026-08-21). Every row here was a static div: ten sentences
// telling him things with nothing to do about any of them, which is how a
// notification screen teaches you to stop reading it. The row opens the
// thing it is about, and a task can be finished without leaving.
export default function NotificationsFlow({ onOpen }: { onOpen?: (kind: string, id: string) => void }) {
  const tasksSvc = useTasks(); const sched = useSchedule(); const goalsSvc = useGoals(); const areasSvc = useAreas(); const profileSvc = useProfile();
  const [feed, setFeed] = useState<Nudge[]>([]);
  const reload = useCallback(async () => {
    const [tasks, events, goals, areas, profile] = await Promise.all([tasksSvc.listTasks(), sched.listEvents(), goalsSvc.list(), areasSvc.list(), profileSvc.get()]);
    const n = { overdue: true, events: true, goals: true, ...(profile?.notify ?? {}) };
    const all = buildFeed({ tasks, events, goals, areas }, todayISO());
    setFeed(all.filter((x) => {
      if (x.kind === "overdue" || x.kind === "due_today") return n.overdue;
      if (x.kind === "event") return n.events;
      return n.goals; // goal_risk, area_drift
    }));
  }, [tasksSvc, sched, goalsSvc, areasSvc, profileSvc]);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <div className="screen">
      <PageHeader title="Notifications" />
      {feed.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">{BELL}</div><div className="empty-title">You're All Caught Up</div>
          <div className="empty-sub">Overdue · Today's events · At-risk goals</div></div>
      ) : (
        <div>
          {feed.map((n) => {
            return (
              <div
                className="msg-row notif-row"
                key={n.id}
                role={onOpen ? "button" : undefined}
                tabIndex={onOpen ? 0 : undefined}
                onClick={onOpen ? () => onOpen(n.entity === "area" ? "goal" : n.entity, n.entityId) : undefined}
              >
                <RowGlyph kind={KIND[n.kind]} />
                <div className="msg-body">
                  <div className="msg-head"><div className="msg-name">{n.title}</div>{n.when && <div className="msg-time">{n.when}</div>}</div>
                  <div className="msg-preview">{n.sub}</div>
                </div>
                {/* One pill, and only where finishing IS the answer. An
                    at-risk goal has no one-tap resolution and gets no button
                    pretending otherwise. */}
                {n.entity === "task" && (
                  <button className="pill-act" onClick={(e) => {
                    e.stopPropagation();
                    void (async () => {
                      const ok = await attemptWrite(() => tasksSvc.toggleDone(n.entityId));
                      if (!ok) return;
                      haptics.selection();
                      setFeed((f) => f.filter((x) => x.id !== n.id));
                      showToast({
                        message: "Done",
                        actionLabel: "Undo",
                        onAction: async () => { await attemptWrite(() => tasksSvc.toggleDone(n.entityId)); await reload(); },
                      });
                    })();
                  }}>Done</button>
                )}
              </div>
            );
          })}
          <div className="screen-foot" />
        </div>
      )}
    </div>
  );
}
