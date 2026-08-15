import { lazy, Suspense, useEffect, useState } from "react";
import TabBar from "./TabBar";
import VoiceBar from "./VoiceBar";
import MoreFlow from "../more/MoreFlow";
import TasksFlow from "../tasks/TasksFlow";
import ScheduleFlow from "../schedule/ScheduleFlow";
import TodayFlow from "../today/TodayFlow";
import BrainFlow from "../brain/BrainFlow";
import { dismissSplash } from "../shared/splash";
import SkeletonScreen from "../shared/SkeletonScreen";
import { DEFAULT_TABS, MAX_TABS, extrasFor, migrateTabs } from "./destinations";
import { useTasks, useSchedule, useCategories, useProfile, useAreas, useGoals, useProjects, useMoney, usePeople } from "../data/NotesProvider";
import { useAuth } from "../auth/AuthProvider";
import { useAI } from "../ai/useAI";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import GoogleAutoImport from "../connections/google/AutoImport";

// Heavier, less-visited surfaces load on demand so the startup bundle stays
// small: the default tabs (Today, Tasks, Schedule, Brain) plus More are enough
// to launch. Everything else fetches its chunk on first open.
const NotesFlow = lazy(() => import("../notes/NotesFlow"));
const BiggerPictureFlow = lazy(() => import("../bigger/BiggerPictureFlow"));
const MessagesFlow = lazy(() => import("../messages/MessagesFlow"));
const NotificationsFlow = lazy(() => import("../notifications/NotificationsFlow"));
const MoneyFlow = lazy(() => import("../money/MoneyFlow"));
const ChatFlow = lazy(() => import("../chat/ChatFlow"));

const QuickCapture = lazy(() => import("../capture/QuickCapture"));
const SearchFlow = lazy(() => import("../search/SearchFlow"));
import { seedDemoData } from "../data/seed";
import { setCategoryRegistry } from "../shared/categories";
import ToastHost from "../shared/ToastHost";
import { bus } from "../events";
import { ENTITY_CATEGORY } from "../categories/types";
import { ENTITY_TASK } from "../notes/types";
import { partition } from "../tasks/filters";
import { todayISO } from "../tasks/grouping";

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
  // One-shot deep-link target inside the Brain tab (e.g. open the routine
  // editor from the Plan sheet). Cleared after it is consumed.
  const [brainIntent, setBrainIntent] = useState<string | undefined>(undefined);
  const goToRoutine = () => { setBrainIntent("routine"); setActive("brain"); };
  // One-shot deep-link into a target tab from a note connection. Cleared on any
  // manual tab tap. Only tasks and projects are wired so far.
  const [taskIntent, setTaskIntent] = useState<string | undefined>(undefined);
  // One-shot filter intent for the Tasks tab (Up Next's See All lands on All).
  const [taskFilterIntent, setTaskFilterIntent] = useState<string | undefined>(undefined);
  const [projectIntent, setProjectIntent] = useState<string | undefined>(undefined);
  const [eventIntent, setEventIntent] = useState<string | undefined>(undefined);
  const [goalIntent, setGoalIntent] = useState<string | undefined>(undefined);
  // Person deep-link: BrainFlow opens Contacts, PeopleFlow opens the person.
  const [personIntent, setPersonIntent] = useState<{ groupKey: string; id: string } | undefined>(undefined);
  const [noteIntent, setNoteIntent] = useState<string | undefined>(undefined);
  const navigateToNote = (id: string) => { setNoteIntent(id); setActive("notes"); };
  const navigateToEntity = async (kind: string, targetId: string) => {
    if (kind === "task") { setTaskIntent(targetId); setActive("tasks"); }
    else if (kind === "project") { setProjectIntent(targetId); setActive("bigger"); }
    else if (kind === "event") { setEventIntent(targetId); setActive("schedule"); }
    else if (kind === "goal") { setGoalIntent(targetId); setActive("bigger"); }
    else if (kind === "person") {
      const p = await people.get(targetId);
      if (!p) return; // deleted person: the link goes nowhere, quietly
      // One people list now: every person opens through Contacts.
      setPersonIntent({ groupKey: "contacts", id: targetId });
      setBrainIntent("contacts");
      setActive("brain");
    }
  };
  const [notesChrome, setNotesChrome] = useState(true);
  const [ready, setReady] = useState(false);
  const [, bumpCatVer] = useState(0);
  const [taskBadge, setTaskBadge] = useState(0);
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
      const keys = migrateTabs(prof?.tabs?.length ? prof.tabs : DEFAULT_TABS);
      setTabKeys(keys);
      setActive(keys[0] ?? "today");
      setReady(true);
    })();
    return () => { on = false; };
  }, [seedDemo, tasks, schedule, categories, profile, areas, goals, projects, money, people]);

  // Keep the category name/color resolver in sync when a category is created,
  // renamed, recolored, or deleted, so edits reflect live everywhere (schedule,
  // today, tasks) without an app restart.
  useEffect(() => {
    let on = true;
    const unsub = bus.subscribe((e) => {
      if (e.entityType !== ENTITY_CATEGORY) return;
      void (async () => {
        const cats = await categories.list();
        if (!on) return;
        setCategoryRegistry(cats.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
        bumpCatVer((v) => v + 1);
      })();
    });
    return () => { on = false; unsub(); };
  }, [categories]);

  // Tasks-tab badge: count of overdue + due-today (open) tasks, kept live.
  useEffect(() => {
    let on = true;
    const recompute = async () => {
      const items = await tasks.listTasks();
      if (!on) return;
      const p = partition(items, todayISO());
      setTaskBadge(p.overdue.length + p.today.length);
    };
    recompute();
    const unsub = bus.subscribe((e) => { if (e.entityType === ENTITY_TASK) void recompute(); });
    return () => { on = false; unsub(); };
  }, [tasks]);

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

  // The boot splash (index.html) stays up until the shell is actually ready,
  // then fades. This is the first real UI of a signed-in launch.
  useEffect(() => { if (ready) dismissSplash(); }, [ready]);

  if (!ready) return <div className="app-shell"><div className="app-scroll" /></div>;

  return (
    <GoogleSessionProvider>
    <GoogleAutoImport />
    <div className="app-shell">
      <div className="app-scroll">
        {/* key remounts the flow per tab; no transition class: tab switches
            are instant, like native iOS (RDB, Dave 2026-07-29) */}
        <Suspense fallback={<SkeletonScreen hero={false} />}>
        <div key={active}>
        {active === "today" && <TodayFlow onGoSchedule={() => setActive("schedule")} onGoTasks={() => setActive("tasks")} onGoTasksAll={() => { setTaskFilterIntent("all"); setActive("tasks"); }} onSearch={() => setSearchOpen(true)} onProfile={() => setActive("more")} onEditRoutine={goToRoutine} onGoEmail={() => setActive("messages")} onRestoreSpot={(kind, id) => { if (kind === "note") navigateToNote(id); else if (kind === "gym") setActive("brain"); else void navigateToEntity(kind, id); }} />}
        {active === "tasks" && <TasksFlow openId={taskIntent} openFilter={taskFilterIntent} />}
        {active === "schedule" && <ScheduleFlow onEditRoutine={goToRoutine} openId={eventIntent} />}
        {active === "brain" && <BrainFlow openKey={brainIntent} personOpenId={personIntent?.id} onOpenNote={navigateToNote} onOpenProject={(id) => void navigateToEntity("project", id)} onOpenMoney={() => setActive("money")} />}
        {active === "notes" && <NotesFlow seed={seedDemo} onChrome={(c) => setNotesChrome(c.tabBar)} onNavigate={navigateToEntity} openId={noteIntent} />}
        
        {active === "bigger" && <BiggerPictureFlow openId={projectIntent} openGoalId={goalIntent} onOpenNote={navigateToNote} />}
        {active === "messages" && <MessagesFlow ai={ai} />}
        {active === "notifications" && <NotificationsFlow />}
        {active === "money" && <MoneyFlow onOpenTask={(id) => void navigateToEntity("task", id)} />}
        {active === "chat" && <ChatFlow />}
        
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
        </Suspense>
      </div>
      <ToastHost />
      {showDock && (
        <>
          <VoiceBar onTap={() => setCaptureOpen(true)} onSearch={() => setSearchOpen(true)} />
          <TabBar tabKeys={tabKeys} active={active} onTab={(k) => { setBrainIntent(undefined); setTaskIntent(undefined); setTaskFilterIntent(undefined); setProjectIntent(undefined); setEventIntent(undefined); setGoalIntent(undefined); setPersonIntent(undefined); setNoteIntent(undefined); setActive(k); }} badges={{ tasks: taskBadge }} />
        </>
      )}
      {captureOpen && <Suspense fallback={null}><QuickCapture ai={ai} onClose={() => setCaptureOpen(false)} /></Suspense>}
      {searchOpen && <Suspense fallback={null}><SearchFlow onClose={() => setSearchOpen(false)} onOpen={(kind, id) => {
        // A search hit becomes the open thing (2026-08-09). Money and
        // categories have no per-item deep link yet, so they land on their
        // surface; everything else opens the exact item via the intents.
        if (kind === "account") setActive("money");
        else if (kind === "category") { setBrainIntent(id); setActive("brain"); }
        else void navigateToEntity(kind, id);
      }} /></Suspense>}
    </div>
    </GoogleSessionProvider>
  );
}
