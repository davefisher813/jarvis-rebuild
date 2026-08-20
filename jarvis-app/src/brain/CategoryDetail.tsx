import { useCallback, useEffect, useState } from "react";
import { useTasks, useSchedule, useNotes, useCategories, useProjects, useGoals, useRoutine, usePeople } from "../data/NotesProvider";
import { useOptionalGoogle } from "../connections/google/GoogleSession";
import type { Person } from "../people/types";
import { personInitials, avatarClass } from "../people/types";
import { upcomingBirthdays } from "../people/birthdays";
import { lastContactFor, agoLabel, isQuiet, checkinPrompt } from "../people/lastContact";
import { findWaiting, nudgePrompt, type WaitingRow } from "../messages/waiting";
import { useAI } from "../ai/useAI";
import { useOptionalAIContext } from "../ai/useAIContext";
import { voiceToText } from "../ai/context";
import { noDashes } from "../ai/suggestions";
import type { Category } from "../categories/types";
import type { NoteData, Recurrence } from "../notes/types";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import { showToast } from "../shared/toast";
import type { TaskItem } from "../tasks/TasksService";
import { effectiveKind } from "../categories/kinds";
import { weekReceipt, receiptLine, afterHoursLine, type WeekEvent } from "../categories/receipts";
import { categoryRecord, type RecordEntry } from "../categories/record";
import { StatTiles, DayDivide, RowIcon } from "../shared/anatomy";
import { eventLog } from "../events";
import { readSamples } from "../shared/timeSense";
import { todayISO } from "../tasks/grouping";
import { nextActionOf } from "../bigger/related";
import { goalTitleOf } from "../schedule/planMeta";
import { dayPhrase } from "../money/bills";
import { fmtTime } from "../schedule/calendar";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import ProjectSheet from "../projects/ProjectSheet";
import CategorySheet, { type CategoryDraft } from "../categories/screens/CategorySheet";
import GymFlow from "../gym/GymFlow";
import { useGym } from "../data/NotesProvider";
import type { Program } from "../gym/types";
import { capAfterNumber } from "../shared/casing";

const CHEV = (
  <div className="chev" />
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);

const UP_NEXT_CAP = 6;
const CHECK_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);
const CAL_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
);
const FOLDER_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
);

// V2 anatomy: one day label per group, not one per row.
function groupByDay(recent: RecordEntry[]): { day: string; rows: RecordEntry[] }[] {
  const out: { day: string; rows: RecordEntry[] }[] = [];
  for (const r of recent) {
    const last = out[out.length - 1];
    if (last && last.day === r.when) last.rows.push(r);
    else out.push({ day: r.when, rows: [r] });
  }
  return out;
}
const NOTES_CAP = 4;

type SheetState = { kind: "closed" } | { kind: "task" } | { kind: "project" } | { kind: "edit" };

const DUMBBELL = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6.5 6.5 11 11" /><path d="m21 21-1-1" /><path d="m3 3 1 1" /><path d="m18 22 4-4" /><path d="m2 6 4-4" /><path d="m3 10 7-7" /><path d="m14 21 7-7" /></svg>
);

// The category page (2026-08-03), replacing the read-only archive. Pages are
// RECEIPTS for behavior happening elsewhere: the Record is derived from real
// completions and events, Up Next is the real open tasks, adds are born
// tagged. The org kind adds Projects (6.6 machinery scoped here) and the
// Season / Work hours settings via the editor.
export default function CategoryDetail({
  categoryId,
  onBack,
  onOpenNote,
  onOpenProject,
  onOpenPerson,
  onOpenContacts,
  onChanged,
}: {
  categoryId: string;
  onBack: () => void;
  onOpenNote?: (id: string) => void;
  onOpenProject?: (id: string) => void;
  onOpenPerson?: (id: string) => void;
  onOpenContacts?: () => void;
  onChanged?: () => void;
}) {
  const tasksSvc = useTasks();
  const schedule = useSchedule();
  const notesSvc = useNotes();
  const catsSvc = useCategories();
  const projectsSvc = useProjects();
  const goalsSvc = useGoals();
  const routine = useRoutine();
  const peopleSvc = usePeople();
  const google = useOptionalGoogle();

  const [cat, setCat] = useState<Category | null>(null);
  const [allCats, setAllCats] = useState<Category[]>([]);
  const [open, setOpen] = useState<TaskItem[]>([]);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);
  const [events, setEvents] = useState<WeekEvent[]>([]);
  // Full event rows for the Coming Up section (WeekEvent above is the thin
  // shape the receipt needs; this keeps titles and times).
  const [upcoming, setUpcoming] = useState<{ id: string; title: string; date: string; start: string }[]>([]);
  // The people in this category (person.categoryIds, set from the person's
  // own card). Written since the person-pass; READ for the first time here.
  const [catPeople, setCatPeople] = useState<Person[]>([]);
  // Last mail contact per person id, derived from Gmail when connected.
  const [contact, setContact] = useState<Record<string, number | null>>({});
  // Sent-and-unanswered threads keyed by person id (waiting.ts derivation).
  const [waitingBy, setWaitingBy] = useState<Record<string, WaitingRow>>({});
  // Person id currently having a nudge drafted (disables the button).
  const [nudging, setNudging] = useState<string | null>(null);
  const [work, setWork] = useState<{ startMin: number; endMin: number } | null>(null);
  const [pushedWeek, setPushedWeek] = useState(0);
  const [sheet, setSheet] = useState<SheetState>({ kind: "closed" });
  const gymSvc = useGym();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [gymOpen, setGymOpen] = useState(false);
  const today = todayISO();

  const reload = useCallback(async () => {
    const [c, cs, tk, pj, gl, nt, ev, rt, ppl] = await Promise.all([
      catsSvc.get(categoryId),
      catsSvc.list(),
      tasksSvc.listTasks(),
      projectsSvc.list(),
      goalsSvc.list(),
      notesSvc.listNotes(),
      schedule.listEvents(),
      routine.get(),
      peopleSvc.list(),
    ]);
    setCat(c);
    setAllCats(cs);
    setAllTasks(tk);
    setOpen(
      tk.filter((t) => t.data.category === categoryId && !t.data.done)
        .sort((a, b) => (a.data.due ?? "9999").localeCompare(b.data.due ?? "9999"))
        .slice(0, UP_NEXT_CAP),
    );
    setProjects(pj.filter((p) => p.data.category === categoryId && p.data.status !== "done"));
    setGoals(gl);
    setNotes(
      tk && nt
        ? nt.filter((n) => (n.data as unknown as NoteData).category === categoryId)
            .slice(0, NOTES_CAP)
            .map((n) => ({ id: n.id, title: ((n.data as unknown as NoteData).title || "Untitled") }))
        : [],
    );
    setEvents(ev.map((e) => ({ date: e.data.date, start: e.data.start, category: e.data.category })));
    const nowIso = todayISO();
    setUpcoming(
      ev.filter((e) => e.data.category === categoryId && e.data.date >= nowIso)
        .sort((a, b) => (a.data.date + a.data.start).localeCompare(b.data.date + b.data.start))
        .slice(0, 4)
        .map((e) => ({ id: e.id, title: e.data.title, date: e.data.date, start: e.data.start })),
    );
    setCatPeople(ppl.filter((p) => (p.data.categoryIds ?? []).includes(categoryId)));
    // Pushed-forward count for the week (2026-08-10): the receipt told half
    // the story (what got done); this is the honest other half, read from the
    // same local event log the pushes already write to.
    const weekAgo = Date.now() - 7 * 86400000;
    setPushedWeek(eventLog.all().filter((e) => e.type === "task.pushed" && e.ts >= weekAgo && e.props?.category === categoryId).length);
    setWork(rt ? { startMin: rt.workStartMin, endMin: rt.workEndMin } : null);
  }, [catsSvc, tasksSvc, projectsSvc, goalsSvc, notesSvc, schedule, routine, peopleSvc, categoryId]);

  useEffect(() => { void reload(); }, [reload]);

  // Training lives behind the health kind (gym track, 2026-08-04).
  useEffect(() => {
    let on = true;
    gymSvc.listPrograms().then((p) => { if (on) setPrograms(p); }).catch(() => {});
    return () => { on = false; };
  }, [gymSvc, gymOpen]);

  // Last contact (2026-08-10): one cached Gmail lookup per person with an
  // email. Silent degrade: no Google session or no email means the subline
  // simply is not there, never an error and never a spinner.
  useEffect(() => {
    const api = google?.api();
    if (!api || catPeople.length === 0) return;
    let on = true;
    (async () => {
      const now = Date.now();
      for (const p of catPeople.slice(0, 15)) {
        const email = p.data.email;
        if (!email) continue;
        const ms = await lastContactFor(api, email, now);
        if (!on) return;
        setContact((prev) => ({ ...prev, [p.id]: ms }));
      }
      // Waiting On, scoped to these people: emails the user sent them that
      // never got a reply. One derivation call, matched by address.
      try {
        const rows = await findWaiting(api, now, 15);
        if (!on) return;
        const byId: Record<string, WaitingRow> = {};
        for (const p of catPeople) {
          const e = p.data.email?.trim().toLowerCase();
          if (!e) continue;
          const row = rows.find((r) => r.toEmail.toLowerCase() === e);
          if (row) byId[p.id] = row;
        }
        setWaitingBy(byId);
      } catch { /* silent: the section just shows less */ }
    })();
    return () => { on = false; };
  }, [google, catPeople]);

  // One-tap nudge (2026-08-10): drafts a short message in the user's voice
  // (follow-up when they owe a reply, check-in when things just went quiet)
  // and opens the mail app with it, via mailto. Nothing sends without the
  // user hitting send in their own mail app. AI unavailable = a blank
  // compose, still useful, never an error.
  const ai = useAI();
  const gatherCtx = useOptionalAIContext();
  const nudge = async (p: Person) => {
    const email = p.data.email;
    if (!email || nudging) return;
    setNudging(p.id);
    try {
      const wrow = waitingBy[p.id];
      let body = "";
      if (ai.available) {
        const voice = await gatherCtx().then((c) => (c ? voiceToText(c) : "")).catch(() => "");
        const prompt = wrow
          ? nudgePrompt(wrow, voice)
          : checkinPrompt(p.data.name, contact[p.id] != null ? agoLabel(contact[p.id]!, Date.now()) : "a while ago", voice);
        body = noDashes((await ai.complete([{ role: "user", content: prompt.user }], prompt.system, { tier: "write" })).trim());
      }
      const subject = wrow ? "Re: " + wrow.subject : "";
      const q = [
        subject ? "subject=" + encodeURIComponent(subject) : "",
        body ? "body=" + encodeURIComponent(body) : "",
      ].filter(Boolean).join("&");
      window.location.href = "mailto:" + email + (q ? "?" + q : "");
    } catch {
      window.location.href = "mailto:" + email;
    } finally {
      setNudging(null);
    }
  };

  if (!cat) return <div className="screen" />;
  if (gymOpen) return <GymFlow onBack={() => setGymOpen(false)} />;
  const kind = effectiveKind(cat.data);
  const isOrg = kind === "org";
  const paused = isOrg && cat.data.season === "paused";
  const samples = readSamples();
  const receipt = weekReceipt(categoryId, samples, events, today, cat.data.workHours ? work : null);
  const line = receiptLine(receipt);
  const ahLine = cat.data.workHours ? afterHoursLine(receipt) : null;
  // The Record (2026-08-10, Dave: "records and insight... tracking what
  // someone has done is important"). Named history that survives the Monday
  // reset, plus the week-over-week compare and the pattern in the data.
  const rec = categoryRecord(categoryId, samples, allTasks, today);
  // People-kind page derivations (2026-08-10).
  const bdayById = new Map(upcomingBirthdays(catPeople, today).map((b) => [b.id, b] as const));
  const nowMs = Date.now();
  // Streaks (2026-08-10): recurring tasks in this category that are actually
  // running. The data (runLen/bestRun) has been maintained since the ADHD
  // lifecycle work; the page never showed it.
  const streaks = allTasks
    .filter((t) => t.data.category === categoryId && t.data.recurrence && (t.data.runLen ?? 0) >= 2)
    .sort((a, b) => (b.data.runLen ?? 0) - (a.data.runLen ?? 0))
    .slice(0, 5);

  const toggle = async (id: string) => { await tasksSvc.toggleDone(id); await reload(); };

  const saveTask = async (draft: TaskDraft) => {
    const rec = (draft.repeat || "") as "" | Recurrence;
    await tasksSvc.createTask(draft.text, { category: draft.category || undefined, due: draft.due || null, recurrence: rec || undefined, projectId: draft.projectId });
    setSheet({ kind: "closed" });
    await reload();
  };

  const dueLabel = (t: TaskItem): string | null => {
    const due = t.data.due;
    if (!due) return null;
    if (due < today) return "Overdue";
    const p = dayPhrase(due, today);
    return "Due " + (p === "today" || p === "tomorrow" ? p : p);
  };

  const sheetCats: SheetCategory[] = allCats.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }));

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title"><span className={"cat-dot cat-bg-" + cat.data.color} /> {cat.data.name}</div>
        <button className="nav-action-text" onClick={() => setSheet({ kind: "edit" })}>Edit</button>
      </div>

      {paused && (
        <div className="pad-x"><div className="card">
          <div className="row">
            <div className="row-grow"><div className="conn-name">Paused for Now</div></div>
            <button className="btn-sm" onClick={async () => { await catsSvc.update(categoryId, { season: undefined }); onChanged?.(); await reload(); }}>Wake Up</button>
          </div>
        </div></div>
      )}

      {(line || rec.lastWeek > 0 || rec.recent.length > 0) && (
        <>
          {/* The Record replaces the bare This Week count (2026-08-10). It
              keeps the receipt but adds what the count was hiding: the actual
              things that got done with their days, how this week compares to
              last, and the pattern once there is enough history. Still fully
              derived; still silent when nothing has ever happened here. */}
          {/* V2 anatomy (approved 2026-08-15): numbers as tinted stat tiles,
              completions grouped under one day divider each, a done check on
              every row. The old version was prose lines and repeated
              all-caps day labels; Dave: unreadable. */}
          <div className="sec-head"><div className="sec-left"><div className="sec-ico nav-tile-green">{CHECK_ICO}</div><div className="sec-title">This Week</div></div></div>
          <div className="pad-x">
            <StatTiles stats={[
              { num: receipt.done, label: "Done", tint: "good" },
              { num: receipt.events, label: receipt.events === 1 ? "Event" : "Events", tint: "sky" },
              ...(pushedWeek > 0 ? [{ num: pushedWeek, label: "Pushed", tint: "warn" as const }] : []),
              ...(rec.lastWeek > 0 ? [{ num: (receipt.done - rec.lastWeek >= 0 ? "+" : "") + (receipt.done - rec.lastWeek), label: "vs Last Week", tint: "plain" as const }] : []),
            ]} />
            {(ahLine || rec.insight) && (
              <div className="card stat-row-gap">
                {ahLine && <div className="row"><div className="conn-meta">{ahLine}</div></div>}
                {rec.insight && <div className="row"><div className="conn-meta">{rec.insight}</div></div>}
              </div>
            )}
            {groupByDay(rec.recent).map((g) => (
              <div key={g.day}>
                <DayDivide label={g.day} />
                <div className="card">
                  {g.rows.map((r) => (
                    <div className="row" key={r.key}>
                      <div className="task-check done" />
                      <div className="row-grow"><div className="conn-name truncate">{r.text}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {streaks.length > 0 && (
        <>
          {/* What keeps happening here: live streaks on this category's
              recurring tasks. Scoreboard, not a to-do list. */}
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Streaks</div></div></div>
          <div className="pad-x"><div className="card">
            {streaks.map((t) => (
              <div className="row" key={t.id}>
                <div className="row-grow">
                  <div className="conn-name truncate">{t.data.text}</div>
                  <div className="eyebrow">{t.data.runLen} in a row{(t.data.bestRun ?? 0) > (t.data.runLen ?? 0) ? ` · best ${t.data.bestRun}` : (t.data.runLen ?? 0) >= 3 ? " · your best" : ""}</div>
                </div>
              </div>
            ))}
          </div></div>
        </>
      )}

      {(kind === "people" || (isOrg && catPeople.length > 0)) && (
        <>
          {/* The point of a Family page is the family (2026-08-10, Dave:
              "actual features with real value not a place for tasks"). The
              people tagged to this category, with the two facts a person page
              can act on: a birthday coming, and how long since you talked
              (derived from Gmail when connected, silent when not). Orgs get
              the same section when they have tagged people (clients, a team);
              on an org it stays hidden while empty instead of nagging. */}
          <div className="sec-head"><div className="sec-left"><div className="sec-title">{isOrg ? "People" : "Your People"}</div></div></div>
          <div className="pad-x"><div className="card">
            {catPeople.length === 0 && (
              <div className="row">
                <div className="row-grow">
                  <div className="conn-name">No People Here Yet</div>
                  <div className="eyebrow">Open someone in Contacts and tag them {cat.data.name}</div>
                </div>
              </div>
            )}
            {catPeople.map((p) => {
              const bday = bdayById.get(p.id);
              const last = contact[p.id];
              const wrow = waitingBy[p.id];
              const quiet = last != null && isQuiet(last, nowMs);
              const bits: string[] = [];
              if (p.data.relationship) bits.push(p.data.relationship);
              if (bday) bits.push(bday.inDays === 0 ? "Birthday today" : bday.inDays === 1 ? "Birthday tomorrow" : `Birthday ${bday.label}`);
              else if (wrow) bits.push(wrow.waitingDays === 1 ? "Waiting on their reply · 1 day" : `Waiting on their reply · ${wrow.waitingDays} days`);
              else if (quiet) bits.push(`Gone quiet: last talked ${agoLabel(last, nowMs)}`);
              else if (last != null) bits.push(`Last talked ${agoLabel(last, nowMs)}`);
              const nudgeable = !!p.data.email && (quiet || !!wrow);
              return (
                <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => onOpenPerson?.(p.id)}>
                  <div className={"av " + avatarClass(p.data.color)}>{personInitials(p.data.name)}</div>
                  <div className="row-grow">
                    <div className="conn-name truncate">{p.data.name}</div>
                    {bits.length > 0 && <div className="eyebrow truncate">{bits.join(" · ")}</div>}
                  </div>
                  {nudgeable && (
                    <button className="btn-sm" disabled={nudging === p.id}
                      onClick={(e) => { e.stopPropagation(); void nudge(p); }}>
                      {nudging === p.id ? "Drafting…" : "Nudge"}
                    </button>
                  )}
                  {CHEV}
                </div>
              );
            })}
            {onOpenContacts && (
              <button className="row row-act" onClick={onOpenContacts}>Open Contacts</button>
            )}
          </div></div>
        </>
      )}

      {upcoming.length > 0 && (
        <>
          {/* What is on the calendar for this part of life. Read-only rows on
              purpose: the schedule tab owns editing. */}
          {/* V2 anatomy: type icon leads, the WHEN rides right as a colored
              time (orange = today, muted = later), never a repeated eyebrow. */}
          <div className="sec-head"><div className="sec-left"><div className="sec-ico nav-tile-sky">{CAL_ICO}</div><div className="sec-title">Coming Up</div></div></div>
          <div className="pad-x"><div className="card">
            {upcoming.map((e) => {
              const p = dayPhrase(e.date, today);
              const when = p.charAt(0).toUpperCase() + p.slice(1);
              const isToday = e.date === today;
              const label = isToday && e.start ? `${fmtTime(e.start).time} ${fmtTime(e.start).ap}` : when;
              return (
                <div className="row" key={e.id}>
                  <RowIcon kind="event" />
                  <div className="row-grow"><div className="conn-name truncate">{e.title}</div></div>
                  <span className={"urgency " + (isToday ? "urgency-warn" : "urgency-muted")}>{label}</span>
                </div>
              );
            })}
          </div></div>
        </>
      )}

      {isOrg && (
        <>
          {/* Project health, not a project list (2026-08-10, Dave: "make it
              more than just a list"). Every row answers: what moves it next,
              is it moving (done this week, from real completions), is it
              slipping (overdue count), and what goal it advances. A project
              with no open task says "Stalled" out loud instead of hiding it. */}
          <div className="sec-head"><div className="sec-left"><div className="sec-ico nav-tile-indigo">{FOLDER_ICO}</div><div className="sec-title">Projects</div></div></div>
          <div className="pad-x"><div className="card">
            {projects.map((p) => {
              const next = nextActionOf(allTasks, p.id);
              const projTasks = allTasks.filter((t) => t.data.projectId === p.id);
              const taskIds = new Set(projTasks.map((t) => t.id));
              const weekAgoMs = nowMs - 7 * 86400000;
              const doneWeek = readSamples().filter((s) => s.t >= weekAgoMs && s.id && taskIds.has(s.id)).length;
              const overdue = projTasks.filter((t) => !t.data.done && !!t.data.due && t.data.due < today).length;
              const goal = goalTitleOf(projects, goals, p.id);
              // V2 anatomy: state leads in its color (red = stalled, muted =
              // moving/paused), the week's count rides as a pill, goal link
              // stays a short fact.
              const bits: string[] = [];
              if (overdue > 0) bits.push(capAfterNumber(overdue === 1 ? "1 overdue" : `${overdue} overdue`));
              if (goal) bits.push(`Moves ${goal}`);
              const state = p.data.status === "on_hold"
                ? { cls: "urgency-muted", label: "Paused" }
                : next
                  ? { cls: "urgency-muted", label: "Moving" }
                  : { cls: "urgency-red", label: "Stalled" };
              const stateSub = next
                ? `next: ${next.data.text}${next.data.due ? ` · ${dayPhrase(next.data.due, today)}` : ""}`
                : p.data.status === "on_hold" ? "on purpose" : "no next action";
              return (
                <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => onOpenProject?.(p.id)}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{p.data.title}</div>
                    <div className="bp-sub truncate"><span className={"urgency " + state.cls}>{state.label}</span> · {stateSub}</div>
                    {bits.length > 0 && <div className="eyebrow truncate">{bits.join(" · ")}</div>}
                  </div>
                  {doneWeek > 0 && <span className="pill pill-good">{doneWeek} done</span>}
                  {CHEV}
                </div>
              );
            })}
            <button className="row row-act" onClick={() => setSheet({ kind: "project" })}>Add Project</button>
          </div></div>
        </>
      )}

      {kind === "health" && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Training</div></div></div>
          <div className="pad-x"><div className="card">
            <div className="row" role="button" tabIndex={0} onClick={() => setGymOpen(true)}>
              <div className="sec-ico ico-blue">{DUMBBELL}</div>
              <div className="row-grow">
                <div className="conn-name">{programs[0]?.data.name ?? "Set Up a Program"}</div>
                {programs[0] && <div className="eyebrow">{programs[0].data.days.length} {programs[0].data.days.length === 1 ? "day" : "days"}</div>}
              </div>
              {CHEV}
            </div>
          </div></div>
        </>
      )}

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Up Next</div></div></div>
      <div className="pad-x"><div className="card">
        {open.map((t) => {
          const due = dueLabel(t);
          return (
            <div className="row" key={t.id}>
              <div className="task-check-tap" role="checkbox" aria-checked={false} aria-label="Mark done" onClick={() => void toggle(t.id)}>
                <div className={"task-check cat-bd-" + cat.data.color} />
              </div>
              <div className="row-grow">
                <div className="conn-name truncate">{t.data.text}</div>
                {due && <div className="eyebrow">{due}</div>}
              </div>
            </div>
          );
        })}
        <button className="row row-act" onClick={() => setSheet({ kind: "task" })}>Add Task</button>
      </div></div>

      {notes.length > 0 && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Notes</div></div></div>
          <div className="pad-x"><div className="card">
            {notes.map((n) => (
              <div className="row" role="button" tabIndex={0} key={n.id} onClick={() => onOpenNote?.(n.id)}>
                <div className="row-grow"><div className="conn-name truncate">{n.title}</div></div>
                {CHEV}
              </div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />

      {sheet.kind === "task" && (
        <TaskSheet mode="new" categories={sheetCats} initial={{ category: categoryId }} onSave={saveTask} onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "project" && (
        <ProjectSheet mode="new" categories={allCats} goals={goals} initial={{ category: categoryId }}
          onSave={async (d) => { await projectsSvc.create(d); setSheet({ kind: "closed" }); await reload(); }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "edit" && (
        <CategorySheet mode="edit"
          initial={{ name: cat.data.name, color: cat.data.color, icon: cat.data.icon ?? "folder", kind: cat.data.kind, season: cat.data.season, workHours: cat.data.workHours }}
          onSave={async (d: CategoryDraft) => {
            await catsSvc.update(categoryId, { name: d.name, color: d.color, icon: d.icon, kind: d.kind, season: d.season, workHours: d.workHours });
            setSheet({ kind: "closed" });
            onChanged?.();
            await reload();
          }}
          onDelete={async () => {
            // Undo restores the category itself (new id); items that pointed
            // at the old id stay untagged either way, which the toast owns up
            // to by naming the delete rather than pretending it was free.
            const gone = cat ? { ...cat.data } : null;
            await catsSvc.remove(categoryId);
            onChanged?.();
            onBack();
            showToast({
              message: "Category deleted",
              actionLabel: "Undo",
              onAction: async () => { if (gone) await catsSvc.create(gone.name, gone.color, gone.icon); onChanged?.(); },
            });
          }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
    </div>
  );
}
