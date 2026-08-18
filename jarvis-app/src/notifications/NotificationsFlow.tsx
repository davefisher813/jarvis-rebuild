import { useCallback, useEffect, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { useTasks, useSchedule, useGoals, useAreas, useProfile } from "../data/NotesProvider";
import { todayISO } from "../ai/useAIContext";
import { buildFeed, type Nudge, type NudgeKind } from "./feed";
import { RowGlyph, type RowKind } from "../shared/anatomy";

const BELL = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;

// V2 anatomy: rows lead with the shared TYPE tile, not a per-surface icon
// set. What a nudge IS (task, event, goal) reads before its words do.
const KIND: Record<NudgeKind, RowKind> = {
  overdue: "task",
  due_today: "task",
  event: "event",
  goal_risk: "goal",
  area_drift: "goal",
};

export default function NotificationsFlow() {
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
              <div className="msg-row" key={n.id}>
                <RowGlyph kind={KIND[n.kind]} />
                <div className="msg-body">
                  <div className="msg-head"><div className="msg-name">{n.title}</div>{n.when && <div className="msg-time">{n.when}</div>}</div>
                  <div className="msg-preview">{n.sub}</div>
                </div>
              </div>
            );
          })}
          <div className="screen-foot" />
        </div>
      )}
    </div>
  );
}
