import { useCallback, useEffect, useState } from "react";
import { useTasks, useSchedule, useGoals, useAreas, useProfile } from "../data/NotesProvider";
import { todayISO } from "../ai/useAIContext";
import { buildFeed, type Nudge, type NudgeKind } from "./feed";

const ALERT = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>;
const CLOCK = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>;
const CAL = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></svg>;
const TARGET = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>;
const COMPASS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="16 8 10 10 8 16 14 14 16 8" /></svg>;
const BELL = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;

const META: Record<NudgeKind, { slot: string; icon: React.ReactNode }> = {
  overdue: { slot: "red", icon: ALERT },
  due_today: { slot: "yellow", icon: CLOCK },
  event: { slot: "sky", icon: CAL },
  goal_risk: { slot: "red", icon: TARGET },
  area_drift: { slot: "graphite", icon: COMPASS },
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
      <div className="nav-bar"><div className="nav-large">Notifications</div></div>
      {feed.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">{BELL}</div><div className="empty-title">You're all caught up</div>
          <div className="empty-sub">Overdue tasks, today's events, and at-risk goals show up here.</div></div>
      ) : (
        <div className="pad-x"><div className="card">
          {feed.map((n) => {
            const m = META[n.kind];
            return (
              <div className="msg-row" key={n.id}>
                <div className={"proj-icon cat-bg-" + m.slot}>{m.icon}</div>
                <div className="msg-body">
                  <div className="msg-head"><div className="msg-name">{n.title}</div>{n.when && <div className="msg-time">{n.when}</div>}</div>
                  <div className="msg-preview">{n.sub}</div>
                </div>
              </div>
            );
          })}
          <div className="screen-foot" />
        </div></div>
      )}
    </div>
  );
}
