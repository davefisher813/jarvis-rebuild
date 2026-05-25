import { useEffect, useState } from "react";
import { useSchedule, useTasks, useProfile } from "../data/NotesProvider";
import { todayISO, fmtTime } from "../schedule/calendar";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { greetingFor, longDate, shortDate } from "./greeting";
import { tomorrowISO, nowHHMM, daySummary, todaysTasks } from "./todayData";
import TodayPage from "./TodayPage";
import TodaySuggestions from "./TodaySuggestions";
import { useAI } from "../ai/useAI";

// Read-only aggregation over the (already tested) Schedule and Tasks services.
export default function TodayFlow({
  onGoSchedule,
  onGoTasks,
  onSearch,
  onProfile,
}: {
  onGoSchedule: () => void;
  onGoTasks: () => void;
  onSearch?: () => void;
  onProfile?: () => void;
}) {
  const ai = useAI();
  const schedule = useSchedule();
  const tasks = useTasks();
  const profile = useProfile();
  const [name, setName] = useState("");
  const [todayEvents, setTodayEvents] = useState<EventItem[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<EventItem[]>([]);
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const today = todayISO(now);
  const tmrw = tomorrowISO(today);

  useEffect(() => {
    let on = true;
    (async () => {
      const [te, tm, tk, prof] = await Promise.all([
        schedule.eventsOn(today),
        schedule.eventsOn(tmrw),
        tasks.listTasks(),
        profile.get(),
      ]);
      if (!on) return;
      setTodayEvents(te);
      setTomorrowEvents(tm);
      setTaskItems(tk);
      setName(prof?.name ?? "");
      setLoading(false);
    })();
    return () => {
      on = false;
    };
  }, [schedule, tasks, profile, today, tmrw]);

  if (loading) return <div className="screen" />;

  const nhm = nowHHMM(now);
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "JV";
  return (
    <TodayPage
      greeting={name ? `${greetingFor(now)}, ${name}` : greetingFor(now)}
      dateLong={longDate(now)}
      summary={daySummary(todayEvents, taskItems, today)}
      todayEvents={todayEvents}
      now={nhm}
      nowLabel={fmtTime(nhm).time}
      tomorrowEvents={tomorrowEvents}
      tomorrowDate={shortDate(new Date(tmrw + "T00:00:00"))}
      tasks={todaysTasks(taskItems, today)}
      today={today}
      suggestions={<TodaySuggestions ai={ai} />}
      onSearch={onSearch}
      onProfile={onProfile}
      onSeeAllSchedule={onGoSchedule}
      onSeeAllTasks={onGoTasks}
      avatar={initials}
    />
  );
}
