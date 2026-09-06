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
import { onNotificationTap, ensureTaskReminders } from "../shared/notifications";
import { useDayKey } from "./useDayKey";
import { useAI } from "../ai/useAI";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import GoogleAutoImport from "../connections/google/AutoImport";
import TodayOutboxPump from "../messages/TodayOutboxPump";
import MailOutboxPump from "../messages/MailOutboxPump";
import MailSnapshotPump from "../messages/MailSnapshotPump";
import AutoReplyPump from "../messages/AutoReplyPump";

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
import { useTaskEstimate } from "../schedule/useTaskEstimate";
import { setOverwhelmed } from "../tasks/overwhelmed";
import { showToast } from "../shared/toast";
import { useOneShot } from "./intents";
import { attemptWrite } from "../shared/guard";

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
  // THE ONE-SHOT INTENTS (the B5 group, 2026-09-05). Every one of these used
  // to be a bare id read once by a child at its own mount and cleared only by
  // a manual tab tap, which is why a deep link into the tab you were already
  // on did nothing and a link you had already followed re-fired on every later
  // visit. They are all useOneShot now: a value plus a nonce, cleared by the
  // screen that opens the thing. See shell/intents.ts for the whole reasoning.
  //
  // Which Brain door to open (e.g. the routine editor from the Plan sheet).
  const brainIntent = useOneShot<string>();
  // S5-Q31: "Back to <day>" on Today needs the Brain tab to land IN the live
  // session, not just on the health category's page. Consumed by the category
  // page itself, not by BrainFlow: the flag has to survive until the page it
  // belongs to is mounted.
  const gymIntent = useOneShot<true>();
  // Which protected block to land straight into editing, when the tap that
  // opened the routine screen was ON a specific block (Today, Schedule).
  const routineBlockIntent = useOneShot<string>();
  const goToRoutine = (blockId?: string) => { brainIntent.fire("routine"); if (blockId) routineBlockIntent.fire(blockId); else routineBlockIntent.clear(); setActive("brain"); };
  // One-shot deep-link into a target tab from a note connection, search, or
  // Quick Capture.
  const taskIntent = useOneShot<string>();
  // One-shot filter intent for the Tasks tab (Up Next's See All lands on All).
  const taskFilterIntent = useOneShot<string>();
  const projectIntent = useOneShot<string>();
  const eventIntent = useOneShot<string>();
  const goalIntent = useOneShot<string>();
  // Which Life segment a deep link wants. Undefined lets the tab remember.
  const [lifeSegment, setLifeSegment] = useState<"tasks" | "projects" | "goals" | undefined>(undefined);
  // The nonce makes a repeat of the same segment a navigation too: LifeFlow
  // may already be mounted on another lens, and a stale prop is not a move.
  const [lifeNav, setLifeNav] = useState(0);
  // SHELL-F-12 (2026-09-05): every plain trip to the Life tab drops a filter
  // nobody asked for on this trip. The two doors that DO want one (Today's
  // See All and Overdue) fire it straight after this.
  const goLife = (seg: "tasks" | "projects" | "goals") => { taskFilterIntent.clear(); setLifeSegment(seg); setLifeNav((n) => n + 1); setActive("life"); };
  // Person deep-link: BrainFlow opens Contacts, PeopleFlow opens the person.
  // The group came out with it (2026-09-05): there is one people list, so the
  // key never said anything the id did not.
  const personIntent = useOneShot<string>();
  const noteIntent = useOneShot<string>();
  // A home-page email notice opens THE THREAD, never the inbox. Landing in a
  // list he then has to search is the trip the old count line made him take.
  const mailIntent = useOneShot<string>();
  // "Finish It" on an unsent draft, which is a different destination from a
  // thread: a draft composed from scratch has no thread to open.
  const draftIntent = useOneShot<string>();
  // Decision deep-link: BrainFlow opens Decisions, DecisionsFlow opens the record.
  const decisionIntent = useOneShot<string>();
  // S6-Q35: a fact captured through Quick Add lives in the Brain's "What
  // JARVIS Knows" list, not on a list a tab already renders -- same one-shot
  // shape as decisionIntent, just one door further in (Brain -> knows ->
  // the strand itself).
  const factIntent = useOneShot<string>();
  // SHELL-F-21: which account the Money tab should open.
  const accountIntent = useOneShot<string>();
  // Every intent the shell owns, for the one place that cancels them all.
  const allIntents = [brainIntent, gymIntent, routineBlockIntent, taskIntent, taskFilterIntent, projectIntent, eventIntent, goalIntent, personIntent, noteIntent, mailIntent, draftIntent, decisionIntent, factIntent, accountIntent];
  const navigateToNote = (id: string) => { noteIntent.fire(id); setActive("notes"); };
  // B3-4 (2026-09-04): search does full text over note bodies and hands its
  // hits to this function with kind "note" (SearchFlow.tsx's open("note", id)),
  // but this had no note branch, so tapping a note in a search result closed
  // the overlay and went nowhere. navigateToNote, one line up, was already
  // the exact function every other note-opening path in this shell uses.
  const navigateToEntity = async (kind: string, targetId: string) => {
    if (kind === "note") { navigateToNote(targetId); return; }
    if (kind === "task") { taskIntent.fire(targetId); goLife("tasks"); }
    else if (kind === "project") { projectIntent.fire(targetId); goLife("projects"); }
    else if (kind === "event") { eventIntent.fire(targetId); setActive("schedule"); }
    else if (kind === "goal") { goalIntent.fire(targetId); goLife("goals"); }
    else if (kind === "decision") {
      decisionIntent.fire(targetId);
      brainIntent.fire("decisions");
      setActive("brain");
    }
    else if (kind === "fact") {
      factIntent.fire(targetId);
      brainIntent.fire("knows");
      setActive("brain");
    }
    // UP-CORE-05 (2026-09-05): the two routes a provenance line needs and
    // navigateToEntity did not have. An email source opens the thread it
    // names; a file source lands where its files live (FileScope has exactly
    // one value today, files/types.ts: "money", so the Money tab IS the
    // file's page, and a second scope needs a map here).
    else if (kind === "email") { mailIntent.fire(targetId); setActive("messages"); }
    else if (kind === "file") { setActive("money"); }
    else if (kind === "person") {
      const p = await people.get(targetId);
      if (!p) return; // deleted person: the link goes nowhere, quietly
      // One people list now: every person opens through Contacts.
      personIntent.fire(targetId);
      brainIntent.fire("contacts");
      setActive("brain");
    }
  };
  const [notesChrome, setNotesChrome] = useState(true);
  const [ready, setReady] = useState(false);
  const [, bumpCatVer] = useState(0);

  // WHAT NOW / JUST FIFTEEN. Global, because being stuck happens wherever you
  // are, not on the Today screen. See tasks/rightNow.ts for the reasoning.
  const [whatNow, setWhatNow] = useState<RightNow | null>(null);
  const estimateOf = useTaskEstimate();
  const [skipped, setSkipped] = useState<string[]>([]);

  const openWhatNow = async (skip: string[] = skipped) => {
    const all = await tasks.listTasks();
    // LIFE-F-23 (2026-09-05): the estimate was the constant 30, so every
    // task tied on size and What Now handed back the most overdue thing,
    // usually the heaviest. See schedule/useTaskEstimate.
    const pick = rightNow(all.filter((t) => !skip.includes(t.id)), estimateOf);
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
      // SHELL-F-15 (2026-09-05): seeding used to run on every boot with "no
      // categories" as its signal for a first run, so an account whose owner
      // deliberately removed every area in intake got all six back on the
      // first screen. The marker on the profile is the signal now. It is
      // written here too, so an account that predates the marker stops being
      // ambiguous after one boot.
      if (!prof?.areasSeeded) {
        await categories.seedDefaults(prof?.template ?? "personal");
        if (prof) {
          try { await profile.save({ areasSeeded: true }); }
          catch { /* the next boot marks it; seeding is idempotent either way */ }
        }
      }
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

  // TODAY-F-02: the local date, watched. Today's key below hangs off it.
  const dayKey = useDayKey();

  // TODAY-F-15 (2026-09-05): reminders were armed by ONE effect inside
  // TodayFlow, so a user who lived in the Tasks tab, or was away for the
  // weekend, ran out of scheduled fire times with no warning. The seam
  // expands a week now, and this re-arms that week from wherever he is: once
  // the shell is up, again whenever the app comes back to the foreground,
  // and again when the day rolls over. Same queue as every other scheduler
  // call (SHARED-F-06), so it cannot interleave with Today's own.
  useEffect(() => {
    if (!ready) return;
    const arm = () => void (async () => {
      try {
        const all = await tasks.listTasks();
        await ensureTaskReminders(
          all.filter((t) => !!t.data.reminder).map((t) => ({ id: t.id, text: t.data.text, reminder: t.data.reminder! })),
          todayISO(),
        );
      } catch { /* the next foreground tries again; nothing was lost */ }
    })();
    arm();
    const onVisible = () => { if (document.visibilityState === "visible") arm(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, tasks, dayKey]);

  // SHELL-F-14 (2026-09-05): these two predate the attemptWrite convention
  // every other user-initiated write in the app goes through. The tab bar
  // moved on screen, the profile write failed silently, and the next launch
  // had the old bar back with nothing ever having said so.
  const toggleTab = (key: string) => {
    const has = tabKeys.includes(key);
    if (has && tabKeys.length === 1) return;
    if (!has && tabKeys.length >= MAX_TABS) return;
    const prev = tabKeys;
    const next = has ? tabKeys.filter((k) => k !== key) : [...tabKeys, key];
    setTabKeys(next);
    void attemptWrite(() => profile.save({ tabs: next })).then((ok) => { if (!ok) setTabKeys(prev); });
  };

  // Returns whether the write landed, so the drag list puts the rows back
  // itself (SHELL-F-11 taught ReorderList to listen for exactly this).
  const reorderTabs = async (next: string[]): Promise<boolean> => {
    const prev = tabKeys;
    setTabKeys(next);
    const ok = await attemptWrite(() => profile.save({ tabs: next }));
    if (!ok) setTabKeys(prev);
    return ok;
  };

  // BROWSER-F-12 (2026-09-05), option A. Chat rendered its own "Ask · tell ·
  // paste" composer AND the shell kept the capture dock under it, so one
  // screen carried two fields making nearly the same promise. Chat keeps its
  // own composer, which is the one that belongs to the conversation, and the
  // dock steps aside the way it already does for the note editor. The TAB BAR
  // is not the dock and stays: hiding it on a tab you can open from the tab
  // bar would strand you there, which is why these are two flags now and not
  // one.
  const showTabBar = active === "notes" ? notesChrome : true;
  const showCapture = showTabBar && active !== "chat";

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
    {/* EMAIL-F-01 (2026-09-05): the Email tab's own outbox (Send, Schedule
        Send, Send & Next) is pumped here, where nothing unmounts on a tab
        switch, instead of inside MessagesFlow, which does. */}
    <MailOutboxPump ai={ai} />
    {/* EMAIL-F-16 (2026-09-05): the heads-down auto-reply is a courtesy for
        the time he is NOT looking at his email, so it runs here rather than
        inside the Email tab, which is only mounted when he is. */}
    <AutoReplyPump />
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
        {/* TODAY-F-02 (2026-09-05): keyed on the local date as well as the
            tab, so a day change while the app sits on Today remounts it and
            every once-per-open job (the sweep, the autopay roll, the spot,
            the Day Loop draft, Fresh Start, the mail dismissals) runs for
            the new day instead of yesterday's. See shell/useDayKey.ts. */}
        {active === "today" && <TodayFlow key={dayKey} onGoSchedule={() => setActive("schedule")} onGoTasks={() => goLife("tasks")} onGoTasksAll={() => { goLife("tasks"); taskFilterIntent.fire("all"); }} onGoTasksOverdue={() => { goLife("tasks"); taskFilterIntent.fire("overdue"); }} onSearch={() => setSearchOpen(true)} onProfile={() => setActive("more")} onEditRoutine={goToRoutine} onGoEmail={(threadId?: string, draftId?: string) => { if (threadId) mailIntent.fire(threadId); else mailIntent.clear(); if (draftId) draftIntent.fire(draftId); else draftIntent.clear(); setActive("messages"); }} onOpenNote={navigateToNote} onRestoreSpot={(kind, id) => { if (kind === "note") navigateToNote(id); else if (kind === "gym") { brainIntent.fire(id); gymIntent.fire(true); setActive("brain"); } else void navigateToEntity(kind, id); }} onGoBigger={(goalId?: string) => { if (goalId) goalIntent.fire(goalId); else goalIntent.clear(); goLife("goals"); }} />}
        {active === "life" && <LifeFlow segment={lifeSegment} segmentNav={lifeNav} taskOpenId={taskIntent.value} taskNonce={taskIntent.nonce} onTaskOpened={taskIntent.clear} taskFilter={taskFilterIntent.value} filterNonce={taskFilterIntent.nonce} onFilterApplied={taskFilterIntent.clear} projectOpenId={projectIntent.value} projectNonce={projectIntent.nonce} onProjectOpened={projectIntent.clear} goalOpenId={goalIntent.value} goalNonce={goalIntent.nonce} onGoalOpened={goalIntent.clear} onOpenNote={navigateToNote} onWhatNow={() => void openWhatNow()} onOpenDecision={(id) => void navigateToEntity("decision", id)} onGoEmail={(threadId) => { mailIntent.fire(threadId); setActive("messages"); }} />}
        {active === "schedule" && <ScheduleFlow onEditRoutine={goToRoutine} openId={eventIntent.value} onNavigate={(kind, id) => void navigateToEntity(kind, id)} />}
        {active === "brain" && <BrainFlow openKey={brainIntent.value} openNonce={brainIntent.nonce} onKeyConsumed={brainIntent.clear} routineBlockId={routineBlockIntent.value} onRoutineBlockConsumed={routineBlockIntent.clear} personOpenId={personIntent.value} personNonce={personIntent.nonce} onPersonConsumed={personIntent.clear} decisionOpenId={decisionIntent.value} decisionNonce={decisionIntent.nonce} onDecisionConsumed={decisionIntent.clear} factOpenId={factIntent.value} factNonce={factIntent.nonce} onFactConsumed={factIntent.clear} onOpenNote={navigateToNote} onOpenProject={(id) => void navigateToEntity("project", id)} onOpenEntity={(kind, id) => void navigateToEntity(kind, id)} onOpenMoney={() => setActive("money")} autoOpenGym={gymIntent.value === true} gymNonce={gymIntent.nonce} onGymConsumed={gymIntent.clear} />}
        {active === "notes" && <NotesFlow seed={seedDemo} onChrome={(c) => setNotesChrome(c.tabBar)} onNavigate={navigateToEntity} openId={noteIntent.value} openNonce={noteIntent.nonce} onOpenConsumed={noteIntent.clear} />}

        {active === "messages" && <MessagesFlow ai={ai} demoMail={seedDemo} openThreadId={mailIntent.value} threadNonce={mailIntent.nonce} onThreadConsumed={mailIntent.clear} openDraftId={draftIntent.value} draftNonce={draftIntent.nonce} onDraftConsumed={draftIntent.clear} onOpenConnections={() => { setMoreRoute("connections"); setActive("more"); }} />}
        {active === "notifications" && <NotificationsFlow onOpen={(kind, id) => void navigateToEntity(kind, id)} />}
        {active === "money" && <MoneyFlow onOpenTask={(id) => void navigateToEntity("task", id)} openAccountId={accountIntent.value} openNonce={accountIntent.nonce} onOpenConsumed={accountIntent.clear} />}
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
      {showCapture && (
        <VoiceBar onTap={() => setCaptureOpen(true)} onSearch={() => setSearchOpen(true)} onWhatNow={() => void openWhatNow()} />
      )}
      {showTabBar && (
        <>
          {/* BROWSER-F-12 moved VoiceBar out to showCapture above, so Chat's
              own composer is the only field on that screen. The tab bar is not
              the dock and stays either way. */}
          <TabBar tabKeys={tabKeys} active={active} onTab={(k) => {
            // A tab tap is a fresh visit: anything still pending is cancelled
            // here. Each intent also clears itself the moment its own screen
            // consumes it (shell/intents.ts), so this is the belt, not the
            // braces: it only ever catches an intent nothing acted on.
            for (const i of allIntents) i.clear();
            setLifeSegment(undefined);
            setActive(k);
          }} />
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
        // A search hit becomes the open thing (2026-08-09). SHELL-F-21
        // (2026-09-05): an account is now one of them, so the only surface
        // still landing on its tab rather than its item is a category, which
        // IS the surface. Everything else opens the exact item.
        if (kind === "account") { accountIntent.fire(id); setActive("money"); }
        else if (kind === "category") { brainIntent.fire(id); setActive("brain"); }
        else void navigateToEntity(kind, id);
      }} /></Suspense>}
    </div>
    </GoogleSessionProvider>
  );
}
