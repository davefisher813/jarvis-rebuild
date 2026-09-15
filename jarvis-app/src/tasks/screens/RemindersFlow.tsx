import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useTasks, useProfile, useNotes, useDecisions, usePeople, useSchedule, useCategories } from "../../data/NotesProvider";
import type { TaskItem } from "../TasksService";
import type { ReminderInfo, LinkedItem } from "../../notes/types";
import type { ProfileData } from "../../profile/types";
import { pageSections, nextOccurrence, runsOn, isDone, scheduleKindOf, type PageTab } from "../reminders";
import { catName } from "../../shared/categories";
import { todayISO } from "../grouping";
import { nowHHMM } from "../../today/todayData";
import { attemptWrite } from "../../shared/guard";
import { showToast } from "../../shared/toast";
import { fmtTime } from "../../schedule/calendar";
import { notificationPermissionState, sendTestReminder, TEST_REMINDER_DELAY_S, type NotifyPermission } from "../../shared/notifications";
import { remindersToIcs, saveIcsFile } from "../ics";
import { displayTitle } from "../../notes/docModel";
import { SHORTCUTS } from "../../health/settings";
import RowActionSheet from "../../shared/RowActionSheet";
import RemindersPage, { type PageChrome } from "./RemindersPage";
import ReminderDetailSheet from "./ReminderDetailSheet";
import SnoozeSheet from "./SnoozeSheet";
import ReminderSettingsSheet, { DEFAULT_REMINDER_PREFS, type ReminderPrefs } from "./ReminderSettingsSheet";
import ReminderSheet from "./ReminderSheet";
import type { LinkCandidate } from "./LinkedItemSheet";

// THE REMINDERS FLOW (the reminders rebuild push E, 2026-09-15). One
// component that owns the page's data and every sheet over it, so Today
// (pushed from the strip's See All) and Life (a segment) mount the same
// thing and stay in step. Every write says what it did, and the ones that
// can be undone offer Undo on the toast.

export default function RemindersFlow({ chrome, onOpenEntity, openId, onOpened, pageless }: {
  chrome?: PageChrome;
  onOpenEntity?: (kind: string, id: string) => void;
  /** Arrive with this reminder's details up (Today's strip, a banner). */
  openId?: string;
  onOpened?: () => void;
  /** Mount only the sheets (detail, snooze, edit, settings, delete-confirm)
   * over whatever screen is already showing, with no Reminders Home
   * underneath and no navigation away from it. Today mounts RemindersFlow
   * this way so tapping a reminder row opens its detail in place instead of
   * swapping the whole screen for Reminders Home behind it (Dave 2026-09-15:
   * the sheet opened, but dismissing it left you on Reminders, not Today). */
  pageless?: boolean;
}) {
  const tasks = useTasks();
  const profile = useProfile();
  const notesSvc = useNotes();
  const decisionsSvc = useDecisions();
  const peopleSvc = usePeople();
  const schedule = useSchedule();
  const categoriesSvc = useCategories();
  const today = todayISO();
  const now = nowHHMM();

  const [items, setItems] = useState<TaskItem[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string; color: string }[]>([]);
  // The page shows one view, Today, since the fixture Dave signed off carries
  // no view tabs (2026-09-15). pageSections still builds the others, so this
  // is the only line that has to change to bring them back.
  const tab: PageTab = "today";
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ mode: "new" } | { mode: "edit"; id: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notify, setNotify] = useState<ProfileData["notify"]>(undefined);
  const [perm, setPerm] = useState<NotifyPermission>("unsupported");
  const [testing, setTesting] = useState(false);
  const [linkCandidates, setLinkCandidates] = useState<LinkCandidate[]>([]);

  const reload = useCallback(async () => {
    try { setItems(await tasks.listTasks()); } catch { /* the next write reloads */ }
  }, [tasks]);
  useEffect(() => {
    void reload();
    void profile.get().then((p) => setNotify(p?.notify)).catch(() => {});
    void categoriesSvc.list().then((cs) => setCats(cs.map((c) => ({ id: c.id, name: c.data.name, color: String(c.data.color ?? "") })))).catch(() => {});
    void notificationPermissionState().then(setPerm);
  }, [reload, profile, categoriesSvc]);

  // What a reminder can be about, loaded once a form is open.
  useEffect(() => {
    if (!sheet) return;
    let on = true;
    void (async () => {
      try {
        const [notes, decisions, people, events] = await Promise.all([notesSvc.listNotes(), decisionsSvc.listAll(), peopleSvc.list(), schedule.listEvents()]);
        if (!on) return;
        setLinkCandidates([
          ...items.filter((t) => !t.data.done && !t.data.reminder).map((t) => ({ type: "task" as const, id: t.id, label: t.data.text })),
          ...events.filter((e) => e.data.date >= today).map((e) => ({ type: "event" as const, id: e.id, label: e.data.title })),
          ...notes.map((n) => ({ type: "note" as const, id: n.id, label: displayTitle(n.data as { title?: string }) || "Untitled" })),
          ...decisions.map((d) => ({ type: "decision" as const, id: d.id, label: d.data.decision })),
          ...people.map((p) => ({ type: "contact" as const, id: p.id, label: p.data.name })),
          ...SHORTCUTS.map((s) => ({ type: "healthItem" as const, id: s.key, label: s.label })),
        ]);
      } catch { /* the picker lists what it has */ }
    })();
    return () => { on = false; };
    // The lists are read once per opening; the items in hand are enough.
  }, [sheet !== null]);

  useEffect(() => {
    if (!openId || items.length === 0) return;
    if (items.some((t) => t.id === openId)) setDetailId(openId);
    onOpened?.();
  }, [openId, items.length]);

  const prefs: ReminderPrefs = {
    ...DEFAULT_REMINDER_PREFS,
    quietHours: !!notify?.quietHours,
    quietFrom: notify?.quietFrom ?? DEFAULT_REMINDER_PREFS.quietFrom,
    quietTo: notify?.quietTo ?? DEFAULT_REMINDER_PREFS.quietTo,
    defaultFollowUp: !!notify?.defaultFollowUp,
    privateAlerts: !!notify?.privateAlerts,
  };
  const areaName = (id: string) => (cats.find((c) => c.id === id)?.name ?? catName(id));
  const sections = pageSections(items, tab, today, now, query, areaName);
  const itemOf = (id: string | null) => (id ? items.find((t) => t.id === id) ?? null : null);

  // ---- the writes, each with its word ----
  const tick = async (id: string, done: boolean) => {
    const ok = await attemptWrite(() => (done ? tasks.tickReminder(id, today) : tasks.untickReminder(id)));
    await reload();
    if (!ok) return;
    if (done) showToast({ message: "Done · In Done for today", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.untickReminder(id)); await reload(); } });
    else showToast({ message: "Occurrence Reopened" });
  };
  const move = async (id: string, fromDate: string, toDate: string, time: string) => {
    const ok = await attemptWrite(() => tasks.moveOccurrence(id, fromDate, toDate, time));
    await reload();
    setSnoozeId(null);
    if (ok) { const t = fmtTime(time); showToast({ message: `Moved · ${toDate === today ? "Today" : toDate === addDay(today) ? "Tomorrow" : toDate}, ${t.time} ${t.ap}` }); }
  };
  const skip = async (id: string, date: string) => {
    const ok = await attemptWrite(() => tasks.skipReminderOccurrence(id, date));
    await reload();
    setDetailId(null);
    if (ok) showToast({ message: "Occurrence Skipped · The series continues", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.restoreOccurrence(id, date)); await reload(); } });
  };
  const restore = async (id: string, date: string) => {
    const ok = await attemptWrite(() => tasks.restoreOccurrence(id, date));
    await reload();
    if (ok) showToast({ message: "Occurrence Restored" });
  };
  const pause = async (id: string, paused: boolean) => {
    const ok = await attemptWrite(() => tasks.pauseReminder(id, paused));
    await reload();
    setDetailId(null);
    if (ok) showToast({ message: paused ? "Reminder Paused · No alerts until you resume" : "Reminder Resumed", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.pauseReminder(id, !paused)); await reload(); } });
  };
  const keepSchedule = async (id: string) => {
    const ok = await attemptWrite(() => tasks.logReminderEvent(id, "keptSchedule"));
    await reload();
    if (ok) showToast({ message: "Kept the Schedule" });
  };
  const remove = async (id: string) => {
    const t = itemOf(id);
    setConfirmDelete(null);
    setDetailId(null);
    if (!t?.data.reminder) return;
    const kept = { text: t.data.text, reminder: t.data.reminder, category: t.data.category ?? "", due: t.data.due ?? null };
    const ok = await attemptWrite(() => tasks.deleteTask(id));
    await reload();
    if (ok) showToast({ message: "Reminder Deleted", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.createReminder(kept.text, kept.reminder, kept.category, kept.due)); await reload(); } });
  };
  const exportOne = async (id: string) => {
    const t = itemOf(id);
    if (!t?.data.reminder) return;
    try {
      await saveIcsFile(remindersToIcs([{ id: t.id, text: t.data.text, reminder: t.data.reminder }], today), "jarvis-reminder.ics");
      showToast({ message: "Opening Calendar · Tap Add to confirm" });
    } catch {
      showToast({ message: "Couldn't hand it to your calendar · Try again" });
    }
  };
  const openLinked = (link: LinkedItem) => { onOpenEntity?.(link.type === "contact" ? "person" : link.type, link.id); };
  const saveReminder = async (text: string, r: ReminderInfo, extra: { due: string | null; category: string; receipt: string }) => {
    const s = sheet;
    setSheet(null);
    if (!s) return;
    let ok = false;
    if (s.mode === "new") {
      ok = await attemptWrite(async () => !!(await tasks.createTask(text, { reminder: r, category: extra.category, due: extra.due })));
    } else {
      ok = await attemptWrite(async () => {
        await tasks.editText(s.id, text);
        await tasks.editReminder(s.id, r);
        await tasks.setDue(s.id, extra.due);
        await tasks.setCategory(s.id, extra.category);
        await tasks.logReminderEvent(s.id, "edited");
      });
    }
    await reload();
    if (ok) {
      showToast({ message: extra.receipt });
    }
  };
  const saveSettings = async (p: ReminderPrefs) => {
    setSettingsOpen(false);
    const next = { overdue: true, events: true, goals: true, ...(notify ?? {}), ...p };
    const ok = await attemptWrite(() => profile.save({ notify: next }));
    if (ok) { setNotify(next); showToast({ message: "Reminder Settings Saved" }); }
  };
  const sendTest = async () => {
    if (testing) return;
    setTesting(true);
    const r = await sendTestReminder();
    setTesting(false);
    showToast({ message: r === "sent" ? `Test reminder in ${TEST_REMINDER_DELAY_S} seconds · Lock the phone to see it` : r === "denied" ? "Notifications are off for JARVIS in iOS Settings" : "Test reminders need the phone app" });
  };

  const detail = itemOf(detailId);
  const snoozing = itemOf(snoozeId);
  const snoozeFrom = snoozing?.data.reminder ? occurrenceDate(snoozing.data.reminder, today, now) : today;
  const editing = sheet?.mode === "edit" ? itemOf(sheet.id) : null;

  return (
    <>
      {!pageless && (
      <RemindersPage
        chrome={chrome ?? {}}
        sections={sections}
        query={query}
        onQuery={setQuery}
        searchOpen={searchOpen}
        onSearchToggle={() => { setSearchOpen((v) => !v); setQuery(""); }}
        today={today}
        onNew={() => setSheet({ mode: "new" })}
        onSettings={() => setSettingsOpen(true)}
        onOpen={setDetailId}
        onTick={(id, done) => void tick(id, done)}
        onSnooze={setSnoozeId}
        onOpenLinked={onOpenEntity ? openLinked : undefined}
        onResume={(id) => void pause(id, false)}
        onRestore={(id, date) => void restore(id, date)}
      />
      )}
      {detail && (
        <ReminderDetailSheet
          item={detail}
          today={today}
          now={now}
          onClose={() => setDetailId(null)}
          onOpenLinked={onOpenEntity ? openLinked : undefined}
          onComplete={(id) => { const t = itemOf(id); void tick(id, !(t?.data.reminder && isDone(t.data.reminder, today))); setDetailId(null); }}
          onSnooze={(id) => { setDetailId(null); setSnoozeId(id); }}
          onEdit={(id) => { setDetailId(null); setSheet({ mode: "edit", id }); }}
          onPause={(id, paused) => void pause(id, paused)}
          onSkip={(id, date) => void skip(id, date)}
          onKeepSchedule={(id) => void keepSchedule(id)}
          onExport={(id) => void exportOne(id)}
          onDelete={(id) => setConfirmDelete(id)}
        />
      )}
      {snoozing && (
        <SnoozeSheet title={snoozing.data.text} fromDate={snoozeFrom} today={today}
          onPick={(toDate, time) => void move(snoozing.id, snoozeFrom, toDate, time)} onCancel={() => setSnoozeId(null)} />
      )}
      {sheet && (
        <ReminderSheet
          mode={sheet.mode}
          initial={editing?.data.reminder ? { text: editing.data.text, reminder: editing.data.reminder, due: editing.data.due ?? null, category: editing.data.category ?? "" } : undefined}
          categories={cats}
          defaultFollowUp={prefs.defaultFollowUp}
          linkCandidates={linkCandidates}
          today={today}
          nowHHMM={now}
          onOpenLinked={onOpenEntity ? openLinked : undefined}
          onSave={(text, r, extra) => void saveReminder(text, r, extra)}
          onCancel={() => setSheet(null)}
        />
      )}
      {settingsOpen && (
        <ReminderSettingsSheet initial={prefs} native={Capacitor.isNativePlatform()} permission={perm} testing={testing}
          onSave={(p) => void saveSettings(p)} onTest={() => void sendTest()} onCancel={() => setSettingsOpen(false)} />
      )}
      {confirmDelete && (
        <RowActionSheet title="Delete this reminder? What it links to stays." onCancel={() => setConfirmDelete(null)}
          actions={[{ label: "Delete Reminder", destructive: true, onPick: () => void remove(confirmDelete) }]} />
      )}
    </>
  );
}

function addDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1, 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// The occurrence a snooze is about: today's when it runs today and is not
// done, otherwise the next one.
function occurrenceDate(r: ReminderInfo, today: string, now: string): string {
  if (scheduleKindOf(r) !== "timed") return today;
  if (runsOn(r, today) && !isDone(r, today)) return today;
  return nextOccurrence(r, today, now)?.date ?? today;
}
