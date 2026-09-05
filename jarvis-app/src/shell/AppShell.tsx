import { Suspense, useEffect, useRef, useState } from "react";
import { lazyWithRecovery } from "./chunkRecovery";
import TabBar from "./TabBar";
import VoiceBar from "./VoiceBar";
import ErrorBoundary from "../monitoring/ErrorBoundary";
// TODAY IS EAGER, THE REST ARE NOT (2026-08-26, build queue item 13).
// Today is the landing tab, so its code is needed to paint the first screen
// and lazy-loading it would only buy a skeleton nobody asked for. The other
// four are reached by a deliberate tap, and they already render inside the
// Suspense boundary below with a real SkeletonScreen fallback, so splitting
// them costs a skeleton frame on first visit and saves everyone the bytes
// on every cold load.
import TodayFlow from "../today/TodayFlow";
const MoreFlow = lazyWithRecovery(() => import("../more/MoreFlow"));
// LIFE (2026-09-01): Tasks and Your Life are one tab. LifeFlow owns the
// segment and mounts TasksFlow or BiggerPictureFlow under it.
const LifeFlow = lazyWithRecovery(() => import("../life/LifeFlow"));
const ScheduleFlow = lazyWithRecovery(() => import("../schedule/ScheduleFlow"));
const BrainFlow = lazyWithRecovery(() => import("../brain/BrainFlow"));
import { dismissSplash } from "../shared/splash";
import SkeletonScreen from "../shared/SkeletonScreen";
import { DEFAULT_TABS, MAX_TABS, extrasFor, migrateTabs } from "./destinations";
import { useTasks, useSchedule, useCategories, useProfile, useAreas, useGoals, useProjects, useMoney, usePeople, useDecisions, useOptionalSeal, useGym } from "../data/NotesProvider";
import { useAuth } from "../auth/AuthProvider";
import { onNotificationTap } from "../shared/notifications";
import { useAI } from "../ai/useAI";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import GoogleAutoImport from "../connections/google/AutoImport";
import TodayOutboxPump from "../messages/TodayOutboxPump";
import MailSnapshotPump from "../messages/MailSnapshotPump";

// Heavier, less-visited surfaces load on demand so the startup bundle stays
// small: the default tabs (Today, Tasks, Schedule, Brain) plus More are enough
// to launch. Everything else fetches its chunk on first open.
const NotesFlow = lazyWithRecovery(() => import("../notes/NotesFlow"));
const MessagesFlow = lazyWithRecovery(() => import("../messages/MessagesFlow"));
const NotificationsFlow = lazyWithRecovery(() => import("../notifications/NotificationsFlow"));
const MoneyFlow = lazyWithRecovery(() => import("../money/MoneyFlow"));
const ChatFlow = lazyWithRecovery(() => import("../chat/ChatFlow"));

const QuickCapture = lazyWithRecovery(() => import("../capture/QuickCapture"));
const SearchFlow = lazyWithRecovery(() => import("../search/SearchFlow"));

import { setCategoryRegistry } from "../shared/categories";
import ToastHost from "../shared/ToastHost";
import { bus } from "../events";
import { sealPreviousMonthIfDue } from "../review/seal";
import { supabase } from "../auth/supabaseClient";
import type { WindowClient } from "../brain/window";
import { ENTITY_CATEGORY } from "../categories/types";
import { todayISO } from "../tasks/grouping";
import RightNowSheet from "../tasks/screens/RightNowSheet";
import { rightNow, endOf, type RightNow } from "../tasks/rightNow";
import { setOverwhelmed } from "../tasks/overwhelmed";
import { showToast } from "../shared/toast";

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
  const decisions = useDecisions();
  const gym = useGym();
  const sealSvc = useOptionalSeal();
  const { signOut, backendConfigured } = useAuth();
  const ai = useAI();

  const [tabKeys, setTabKeys] = useState<string[]>(DEFAULT_TABS);
  const [active, setActive] = useState<string>("today");
  // Deep-link into a More subpage (Email's Open Connections, Catalog V3.1).
  const [moreRoute, setMoreRoute] = useState<"connections" | null>(null);
  // One-shot deep-link target inside the Brain tab (e.g. open the routine
  // editor from the Plan sheet). Cleared after it is consumed.
  const [brainIntent, setBrainIntent] = useState<string | undefined>(undefined);
  // S5-Q31: "Back to <day>" on Today needs the Brain tab to land IN the live
  // session, not just on the health category's page. One-shot, same lifecycle
  // as brainIntent -- cleared on any manual tab tap so a later plain visit to
  // Brain never re-opens a session the user already backed out of.
  const [brainAutoGym, setBrainAutoGym] = useState(false);
  // Which protected block to land straight into editing, when the tap that
  // opened the routine screen was ON a specific block (Today, Schedule).
  // Same one-shot lifecycle as brainIntent: cleared on any manual tab tap.
  const [routineBlockIntent, setRoutineBlockIntent] = useState<string | undefined>(undefined);
  const goToRoutine = (blockId?: string) => { setBrainIntent("routine"); setRoutineBlockIntent(blockId); setActive("brain"); };
  // One-shot deep-link into a target tab from a note connection. Cleared on any
  // manual tab tap. Only tasks and projects are wired so far.
  const [taskIntent, setTaskIntent] = useState<string | undefined>(undefined);
  // One-shot filter intent for the Tasks tab (Up Next's See All lands on All).
  const [taskFilterIntent, setTaskFilterIntent] = useState<string | undefined>(undefined);
  const [projectIntent, setProjectIntent] = useState<string | undefined>(undefined);
  const [eventIntent, setEventIntent] = useState<string | undefined>(undefined);
  const [goalIntent, setGoalIntent] = useState<string | undefined>(undefined);
  // Which Life segment a deep link wants. Undefined lets the tab remember.
  const [lifeSegment, setLifeSegment] = useState<"tasks" | "projects" | "goals" | undefined>(undefined);
  // The nonce makes a repeat of the same segment a navigation too: LifeFlow
  // may already be mounted on another lens, and a stale prop is not a move.
  const [lifeNav, setLifeNav] = useState(0);
  const goLife = (seg: "tasks" | "projects" | "goals") => { setLifeSegment(seg); setLifeNav((n) => n + 1); setActive("life"); };
  // Person deep-link: BrainFlow opens Contacts, PeopleFlow opens the person.
  const [personIntent, setPersonIntent] = useState<{ groupKey: string; id: string } | undefined>(undefined);
  const [noteIntent, setNoteIntent] = useState<string | undefined>(undefined);
  // A home-page email notice opens THE THREAD, never the inbox. Landing in a
  // list he then has to search is the trip the old count line made him take.
  const [mailIntent, setMailIntent] = useState<string | undefined>(undefined);
  // "Finish It" on an unsent draft, which is a different destination from a
  // thread: a draft composed from scratch has no thread to open.
  const [draftIntent, setDraftIntent] = useState<string | undefined>(undefined);
  // Decision deep-link: BrainFlow opens Decisions, DecisionsFlow opens the record.
  const [decisionIntent, setDecisionIntent] = useState<string | undefined>(undefined);
  // S6-Q35: a fact captured through Quick Add lives in the Brain's "What
  // JARVIS Knows" list, not on a list a tab already renders -- same one-shot
  // shape as decisionIntent, just one door further in (Brain -> knows ->
  // the strand itself).
  const [factIntent, setFactIntent] = useState<string | undefined>(undefined);
  const navigateToNote = (id: string) => { setNoteIntent(id); setActive("notes"); };
  // B3-4 (2026-09-04): search does full text over note bodies and hands its
  // hits to this function with kind "note" (SearchFlow.tsx's open("note", id)),
  // but this had no note branch, so tapping a note in a search result closed
  // the overlay and went nowhere. navigateToNote, one line up, was already
  // the exact function every other note-opening path in this shell uses.
  const navigateToEntity = async (kind: string, targetId: string) => {
    if (kind === "note") { navigateToNote(targetId); return; }
    if (kind === "task") { setTaskIntent(targetId); goLife("tasks"); }
    else if (kind === "project") { setProjectIntent(targetId); goLife("projects"); }
    else if (kind === "event") { setEventIntent(targetId); setActive("schedule"); }
    else if (kind === "goal") { setGoalIntent(targetId); goLife("goals"); }
    else if (kind === "decision") {
      setDecisionIntent(targetId);
      setBrainIntent("decisions");
      setActive("brain");
    }
    else if (kind === "fact") {
      setFactIntent(targetId);
      setBrainIntent("knows");
      setActive("brain");
    }
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

  // WHAT NOW / JUST FIFTEEN. Global, because being stuck happens wherever you
  // are, not on the Today screen. See tasks/rightNow.ts for the reasoning.
  const [whatNow, setWhatNow] = useState<RightNow | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  const openWhatNow = async (skip: string[] = skipped) => {
    const all = await tasks.listTasks();
    const pick = rightNow(all.filter((t) => !skip.includes(t.id)), () => 30);
    if (!pick) { showToast({ message: "Nothing open right now" }); setWhatNow(null); return; }
    setWhatNow(pick);
  };

  // The container starts on the TAP. ADHD discounts delayed commitments
  // steeply, so "later" is where this one would die: Set a Start is the tool
  // for planning a day, and this is the tool for beginning right now.
  const startFifteen = async (pick: RightNow) => {
    setWhatNow(null);
    const id = await schedule.createEvent(pick.task.data.text, {
      date: todayISO(),
      start: pick.startHHMM,
      end: endOf(pick.startHHMM, pick.minutes),
      category: pick.task.data.category || undefined,
      sourceTaskId: pick.task.id,
    });
    showToast({
      message: `Fifteen minutes on ${pick.task.data.text}`,
      actionLabel: id ? "Undo" : undefined,
      onAction: id ? async () => { await schedule.deleteEvent(id); } : undefined,
    });
  };

  const [captureOpen, setCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Bootstrap: seed default categories, publish them to the resolver, optionally
  // seed demo data, and load the saved tab layout. Runs before anything renders.
  //
  // B6-3 (2026-09-04): "A token refresh throws you back to Today." Supabase
  // silently rotates the access token roughly once an hour; NotesProvider's
  // services are memoized on [userId, accessToken] (correctly, since the
  // store needs the live token), so every refresh hands this effect a brand
  // new tasks/schedule/categories/... identity and it reran in full,
  // including the unconditional setActive(keys[0]) below. AppShell itself
  // never unmounts for a same-user token rotation (App.tsx keeps rendering
  // the same <NotesProvider><AppGate/></NotesProvider> tree), so firstBoot
  // survives across it and only a real remount (sign out, sign back in as
  // anyone) resets it. The rest of the bootstrap still reruns on every
  // identity change, which is harmless: seeding defaults and loading tabs
  // are idempotent.
  const firstBoot = useRef(true);
  useEffect(() => {
    let on = true;
    (async () => {
      const prof = await profile.get();
      await categories.seedDefaults(prof?.template ?? "personal");
      const cats = await categories.list();
      if (!on) return;
      setCategoryRegistry(cats.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
      // Dynamic, and behind the build constant, so the real bundle never
      // contains the seed module at all (see vite.config.ts).
      if (__DEMO_SEED__ && seedDemo) {
        const seed = await import("../data/seed");
        await seed.seedDemoData(tasks, schedule, cats, { areas, goals, projects, money, people, decisions, seal: sealSvc ?? undefined, gym });
        seed.seedDemoMail();
      }
      if (!on) return;
      const keys = migrateTabs(prof?.tabs?.length ? prof.tabs : DEFAULT_TABS);
      setTabKeys(keys);
      if (firstBoot.current) {
        setActive(keys[0] ?? "today");
        firstBoot.current = false;
      }
      setReady(true);
    })();
    return () => { on = false; };
  }, [seedDemo, tasks, schedule, categories, profile, areas, goals, projects, money, people, decisions, sealSvc, gym]);

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

  // S1-04 (2026-09-04): "A notification tap lands nowhere." AppShell is the
  // one place that owns tab navigation and outlives every screen, so it is
  // the single subscriber that turns a tap into a real destination.
  // Check-ins land on Today (both the morning nudge into Up Next and the
  // evening mood ask are things Today itself surfaces); event reminders land
  // on Schedule; task reminders land on Today, where the Reminders strip is.
  useEffect(() => {
    return onNotificationTap((kind) => {
      if (kind === "morning" || kind === "evening" || kind === "reminder") setActive("today");
      else if (kind === "event") setActive("schedule");
    });
  }, []);

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

  // THE MONTHLY SEAL (2026-08-25): once the shell is up, check whether the
  // previous month still needs its record and write it silently. Fire and
  // forget, guarded twice (localStorage marker, then the Store) so the cost
  // on an ordinary open is one localStorage read. Nothing renders from this
  // yet; the record just has to exist before the first report can say
  // "vs last month" honestly.
  useEffect(() => {
    if (!ready || !sealSvc) return;
    void sealPreviousMonthIfDue(sealSvc, supabase as unknown as WindowClient | null, gym, goals, undefined, undefined, schedule)
      .catch(() => { /* a missed boundary retries on the next open */ });
  }, [ready, sealSvc, gym, goals]);

  if (!ready) return <div className="app-shell"><div className="app-scroll" /></div>;

  return (
    <GoogleSessionProvider>
    <GoogleAutoImport />
    <TodayOutboxPump />
    <MailSnapshotPump />
    <div className="app-shell">
      <div className="app-scroll">
        {/* key remounts the flow per tab; no transition class: tab switches
            are instant, like native iOS (RDB, Dave 2026-07-29) */}
        {/* S3-Q19 (2026-09-04): ErrorBoundary here is keyed on `active`, same
            as the div it wraps -- a crash in one tab's flow shows its own
            "Something Went Wrong" card while VoiceBar/TabBar (siblings,
            outside this boundary) keep working, and tapping any other tab
            remounts a fresh boundary for free (the key change unmounts the
            tripped instance). The root boundary in main.tsx stays as the
            outermost fallback for pre-shell crashes (Sign In, onboarding),
            where no tab bar exists yet. */}
        <Suspense fallback={<SkeletonScreen hero={false} />}>
        <ErrorBoundary key={active}>
        <div key={active}>
        {active === "today" && <TodayFlow onGoSchedule={() => setActive("schedule")} onGoTasks={() => goLife("tasks")} onGoTasksAll={() => { setTaskFilterIntent("all"); goLife("tasks"); }} onGoTasksOverdue={() => { setTaskFilterIntent("overdue"); goLife("tasks"); }} onSearch={() => setSearchOpen(true)} onProfile={() => setActive("more")} onEditRoutine={goToRoutine} onGoEmail={(threadId?: string, draftId?: string) => { setMailIntent(threadId); setDraftIntent(draftId); setActive("messages"); }} onRestoreSpot={(kind, id) => { if (kind === "note") navigateToNote(id); else if (kind === "gym") { setBrainIntent(id); setBrainAutoGym(true); setActive("brain"); } else void navigateToEntity(kind, id); }} onGoBigger={(goalId?: string) => { setGoalIntent(goalId); goLife("goals"); }} />}
        {active === "life" && <LifeFlow segment={lifeSegment} segmentNav={lifeNav} taskOpenId={taskIntent} taskFilter={taskFilterIntent} projectOpenId={projectIntent} goalOpenId={goalIntent} onOpenNote={navigateToNote} onWhatNow={() => void openWhatNow()} onOpenDecision={(id) => void navigateToEntity("decision", id)} />}
        {active === "schedule" && <ScheduleFlow onEditRoutine={goToRoutine} openId={eventIntent} />}
        {active === "brain" && <BrainFlow openKey={brainIntent} routineBlockId={routineBlockIntent} onRoutineBlockConsumed={() => setRoutineBlockIntent(undefined)} personOpenId={personIntent?.id} decisionOpenId={decisionIntent} factOpenId={factIntent} onOpenNote={navigateToNote} onOpenProject={(id) => void navigateToEntity("project", id)} onOpenEntity={(kind, id) => void navigateToEntity(kind, id)} onOpenMoney={() => setActive("money")} autoOpenGym={brainAutoGym} />}
        {active === "notes" && <NotesFlow seed={seedDemo} onChrome={(c) => setNotesChrome(c.tabBar)} onNavigate={navigateToEntity} openId={noteIntent} />}

        {active === "messages" && <MessagesFlow ai={ai} demoMail={seedDemo} openThreadId={mailIntent} openDraftId={draftIntent} onOpenConnections={() => { setMoreRoute("connections"); setActive("more"); }} />}
        {active === "notifications" && <NotificationsFlow onOpen={(kind, id) => void navigateToEntity(kind, id)} />}
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
            openRoute={moreRoute}
            onRouteConsumed={() => setMoreRoute(null)}
          />
        )}
        </div>
        </ErrorBoundary>
        </Suspense>
      </div>
      <ToastHost />
      {/* Where a page's select bar lands (2026-08-24). A page owns its own
          select mode, but the bar belongs in the fixed footer stack above the
          tab bar, not inside .app-scroll where it would scroll away from the
          selection it describes. A portal target rather than fixed
          positioning with an offset, because the tab bar has no fixed height:
          it is content plus the safe-area inset, so any number here would be
          wrong on some device. */}
      <div id="select-bar-host" />
      {showDock && (
        <>
          <VoiceBar onTap={() => setCaptureOpen(true)} onSearch={() => setSearchOpen(true)} onWhatNow={() => void openWhatNow()} />
          <TabBar tabKeys={tabKeys} active={active} onTab={(k) => { setBrainIntent(undefined); setBrainAutoGym(false); setRoutineBlockIntent(undefined); setTaskIntent(undefined); setTaskFilterIntent(undefined); setProjectIntent(undefined); setEventIntent(undefined); setGoalIntent(undefined); setLifeSegment(undefined); setPersonIntent(undefined); setNoteIntent(undefined); setDecisionIntent(undefined); setFactIntent(undefined); setActive(k); }} />
        </>
      )}
      {whatNow && (
        <RightNowSheet
          pick={whatNow}
          onCancel={() => setWhatNow(null)}
          // "Something Else" hides this one for the session and offers the
          // next smallest. Hiding, never deferring: nothing is written, so a
          // task he skipped past is exactly where it was tomorrow.
          onOther={() => { const next = [...skipped, whatNow.task.id]; setSkipped(next); void openWhatNow(next); }}
          // JUST THIS ONE (Fewer Buttons, 2026-09-02): the same pick, in the
          // list, everything else hidden until Show Everything. The flag is
          // day-keyed in overwhelmed.ts; TasksFlow hears the write.
          onJustThisOne={() => { setWhatNow(null); setOverwhelmed(true, todayISO()); goLife("tasks"); }}
          onStart={() => void startFifteen(whatNow)}
        />
      )}
      {captureOpen && <Suspense fallback={null}><QuickCapture ai={ai} onClose={() => setCaptureOpen(false)} onOpen={(kind, id) => void navigateToEntity(kind, id)} /></Suspense>}
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
