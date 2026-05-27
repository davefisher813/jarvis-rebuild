import { useEffect, useState } from "react";
import TabBar from "./TabBar";
import VoiceBar from "./VoiceBar";
import MoreFlow from "../more/MoreFlow";
import TasksFlow from "../tasks/TasksFlow";
import ScheduleFlow from "../schedule/ScheduleFlow";
import TodayFlow from "../today/TodayFlow";
import BrainFlow from "../brain/BrainFlow";
import NotesFlow from "../notes/NotesFlow";
import { DEFAULT_TABS, MAX_TABS, extrasFor } from "./destinations";
import { useTasks, useSchedule, useCategories, useProfile, useAreas, useGoals, useProjects, useMoney, usePeople } from "../data/NotesProvider";
import { useAuth } from "../auth/AuthProvider";
import { useAI } from "../ai/useAI";
import QuickCapture from "../capture/QuickCapture";
import SearchFlow from "../search/SearchFlow";
import LifeMapFlow from "../life/LifeMapFlow";
import ProjectsFlow from "../projects/ProjectsFlow";
import MessagesFlow from "../messages/MessagesFlow";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import NotificationsFlow from "../notifications/NotificationsFlow";
import MoneyFlow from "../money/MoneyFlow";
import InsightsFlow from "../insights/InsightsFlow";
import { seedDemoData } from "../data/seed";
import { setCategoryRegistry } from "../shared/categories";

// Hosts the app. The bottom tab bar is user-editable: tabKeys (from the profile)
// decides which pages are tabs; everything else lives in More. Any page can be
// the active content, whether reached from a tab or opened from More.
export default function AppShell({ seedDemo = false }: { seedDemo?: boolean }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const categories = useCategories();
  const profile = useProfile();
  const areas = useAreas();
  const goals = useGoals();
  const projects = useProjects();
  const money = useMoney();
  const people = usePeople();
  const { signOut, backendConfigured } = useAuth();
  const ai = useAI();

  const [tabKeys, setTabKeys] = useState<string[]>(DEFAULT_TABS);
  const [active, setActive] = useState<string>("today");
  const [notesChrome, setNotesChrome] = useState(true);
  const [ready, setReady] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Bootstrap: seed default categories, publish them to the resolver, optionally
  // seed demo data, and load the saved tab layout. Runs before anything renders.
  useEffect(() => {
    let on = true;
    (async () => {
      const prof = await profile.get();
      await categories.seedDefaults(prof?.template ?? "personal");
      const cats = await categories.list();
      if (!on) return;
      setCategoryRegistry(cats.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
      if (seedDemo) await seedDemoData(tasks, schedule, cats, { areas, goals, projects, money, people });
      if (!on) return;
      const keys = prof?.tabs?.length ? prof.tabs : DEFAULT_TABS;
      setTabKeys(keys);
      setActive(keys[0] ?? "today");
      setReady(true);
    })();
    return () => { on = false; };
  }, [seedDemo, tasks, schedule, categories, profile, areas, goals, projects, money, people]);

  // Leaving Notes always restores the dock.
  useEffect(() => {
    if (active !== "notes") setNotesChrome(true);
  }, [active]);

  const toggleTab = (key: string) => {
    const has = tabKeys.includes(key);
    if (has && tabKeys.length === 1) return;
    if (!has && tabKeys.length >= MAX_TABS) return;
    const next = has ? tabKeys.filter((k) => k !== key) : [...tabKeys, key];
    setTabKeys(next);
    void profile.save({ tabs: next });
  };

  const reorderTabs = (next: string[]) => { setTabKeys(next); void profile.save({ tabs: next }); };

  const showDock = active === "notes" ? notesChrome : true;

  if (!ready) return <div className="app-shell"><div className="app-scroll" /></div>;

  return (
    <GoogleSessionProvider>
    <div className="app-shell">
      <div className="app-scroll">
        <div className="tab-swap" key={active}>
        {active === "today" && <TodayFlow onGoSchedule={() => setActive("schedule")} onGoTasks={() => setActive("tasks")} onSearch={() => setSearchOpen(true)} onProfile={() => setActive("more")} />}
        {active === "tasks" && <TasksFlow />}
        {active === "schedule" && <ScheduleFlow />}
        {active === "brain" && <BrainFlow />}
        {active === "notes" && <NotesFlow seed={seedDemo} onChrome={(c) => setNotesChrome(c.tabBar)} />}
        {active === "goals" && <LifeMapFlow />}
        {active === "projects" && <ProjectsFlow />}
        {active === "messages" && <MessagesFlow ai={ai} />}
        {active === "notifications" && <NotificationsFlow />}
        {active === "money" && <MoneyFlow />}
        {active === "insights" && <InsightsFlow />}
        {active === "more" && (
          <MoreFlow
            extras={extrasFor(tabKeys)}
            onOpenExtra={(k) => setActive(k)}
            tabKeys={tabKeys}
            onToggleTab={toggleTab}
            onReorderTabs={reorderTabs}
            onSignOut={backendConfigured ? signOut : undefined}
          />
        )}
        </div>
      </div>
      {showDock && (
        <>
          <VoiceBar onTap={() => setCaptureOpen(true)} />
          <TabBar tabKeys={tabKeys} active={active} onTab={setActive} />
        </>
      )}
      {captureOpen && <QuickCapture ai={ai} onClose={() => setCaptureOpen(false)} />}
      {searchOpen && <SearchFlow onClose={() => setSearchOpen(false)} />}
    </div>
    </GoogleSessionProvider>
  );
}
