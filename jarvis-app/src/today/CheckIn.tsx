import { useCallback, useEffect, useState } from "react";
import { useTasks, useProfile } from "../data/NotesProvider";
import type { TaskItem } from "../tasks/TasksService";
import { todayISO } from "../schedule/calendar";
import { haptics } from "../shared/haptics";
import type { ProfileData } from "../profile/types";

// One tiny question at the right moment, built for ADHD brains:
// - the app initiates (initiation, not motivation, is the hard part)
// - exactly one question, every answer is a single tap
// - every tap has an instant visible effect and a haptic
// - snoozing is guilt-free and first-class; dismissing means gone for the day
// Questions are deterministic from state; nothing here nags or shames.

type Q =
  | { id: "one"; title: string; tasks: TaskItem[] }
  | { id: "stuck"; title: string; task: TaskItem }
  | { id: "mood"; title: string };

const AFFIRM: Record<string, string> = {
  one: "Locked in. Everything else is extra credit.",
  "stuck-now": "On it. It\u2019s on today\u2019s plate.",
  "stuck-tomorrow": "Moved to tomorrow. No guilt: that\u2019s a decision, not a failure.",
  "stuck-done": "Already done and never checked off. The most ADHD win there is.",
  mood: "Noted. That helps me plan better days.",
};

export default function CheckIn({ onChanged }: { onChanged?: () => void }) {
  const tasksSvc = useTasks();
  const profileSvc = useProfile();
  const [q, setQ] = useState<Q | null>(null);
  const [affirm, setAffirm] = useState<string | null>(null);
  const today = todayISO();

  const load = useCallback(async () => {
    const prof = await profileSvc.get();
    const day = prof?.checkin?.[today] ?? {};
    const skip = day.skip ?? [];
    const hour = new Date().getHours();
    const tasks = await tasksSvc.listTasks();
    const open = tasks.filter((t) => !t.data.done);
    const overdue = open.filter((t) => t.data.due && t.data.due < today)
      .sort((a, b) => (a.data.due! < b.data.due! ? -1 : 1));
    const dueSoon = open.filter((t) => !t.data.due || t.data.due <= today);

    if (hour < 12 && !day.one && !skip.includes("one") && dueSoon.length > 0) {
      setQ({ id: "one", title: "What\u2019s your ONE thing today?", tasks: dueSoon.slice(0, 3) });
    } else if (overdue.length > 0 && !skip.includes("stuck")) {
      const t = overdue[0]!;
      setQ({ id: "stuck", title: `Still on for \u201C${t.data.text}\u201D?`, task: t });
    } else if (hour >= 18 && !day.mood && !skip.includes("mood")) {
      setQ({ id: "mood", title: "How did today feel?" });
    } else {
      setQ(null);
    }
  }, [profileSvc, tasksSvc, today]);

  useEffect(() => { void load(); }, [load]);

  const saveDay = async (patch: { one?: string; mood?: string; addSkip?: string }) => {
    const prof = await profileSvc.get();
    const all = { ...(prof?.checkin ?? {}) };
    const day = { ...(all[today] ?? {}) };
    if (patch.one) day.one = patch.one;
    if (patch.mood) day.mood = patch.mood;
    if (patch.addSkip) day.skip = [...(day.skip ?? []), patch.addSkip];
    // keep only the last 14 days so the profile record stays small
    all[today] = day;
    const keep = Object.keys(all).sort().slice(-14);
    const trimmed: NonNullable<ProfileData["checkin"]> = {};
    for (const k of keep) trimmed[k] = all[k]!;
    await profileSvc.save({ checkin: trimmed });
  };

  const finish = (key: string) => {
    setAffirm(AFFIRM[key] ?? "Got it.");
    setQ(null);
    onChanged?.();
    window.setTimeout(() => setAffirm(null), 3500);
  };

  if (affirm) {
    return (
      <div className="pad-x"><div className="card"><div className="row">
        <div className="conn-name">{affirm}</div>
      </div></div></div>
    );
  }
  if (!q) return null;

  return (
    <div className="pad-x"><div className="card">
      <div className="row">
        <div className="row-grow"><div className="conn-name">{q.title}</div></div>
        <button className="conn-remove" aria-label="Not now" onClick={async () => { await saveDay({ addSkip: q.id }); haptics.selection(); setQ(null); }}>&times;</button>
      </div>
      {q.id === "one" && q.tasks.map((t) => (
        <div className="row" role="button" tabIndex={0} key={t.id} onClick={async () => {
          await saveDay({ one: t.id });
          await tasksSvc.setDue(t.id, today);
          haptics.success();
          finish("one");
        }}>
          <div className="row-grow"><div className="conn-name">{t.data.text}</div></div>
          <div className="chev"></div>
        </div>
      ))}
      {q.id === "stuck" && (
        <>
          <div className="row" role="button" tabIndex={0} onClick={async () => {
            await tasksSvc.setDue(q.task.id, today);
            haptics.success(); finish("stuck-now");
          }}><div className="conn-name">Right now: put it on today</div></div>
          <div className="row" role="button" tabIndex={0} onClick={async () => {
            const tmr = todayISO(new Date(Date.now() + 86400000));
            await tasksSvc.setDue(q.task.id, tmr);
            haptics.selection(); finish("stuck-tomorrow");
          }}><div className="conn-name">Tomorrow, guilt-free</div></div>
          <div className="row" role="button" tabIndex={0} onClick={async () => {
            await tasksSvc.toggleDone(q.task.id);
            haptics.success(); finish("stuck-done");
          }}><div className="conn-name">Done, actually</div></div>
        </>
      )}
      {q.id === "mood" && (
        <div className="row">
          {[["fire", "\uD83D\uDD25 Flow"], ["meh", "\uD83D\uDE10 Meh"], ["under", "\uD83C\uDF0A Underwater"]].map(([v, label]) => (
            <div className="chip" role="button" tabIndex={0} key={v} onClick={async () => {
              await saveDay({ mood: v });
              haptics.selection(); finish("mood");
            }}>{label}</div>
          ))}
        </div>
      )}
    </div></div>
  );
}
