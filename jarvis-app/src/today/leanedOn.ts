// THE STRAND THE DAY'S PLAN LEANED ON (C-25, wired 2026-09-13). The AI
// planner says which strand changed the plan (schedule/planDayAI.ts
// leanedOn); the plan sheet shows it while it is open and then it was lost,
// so WhySheet's leaningOn seam was never fed. The first leaned-on text is
// remembered here for the day it was committed, and the Why sheet on a task
// that was one of that day's picks reads it back. One key, one day: a new
// commit replaces it, and nothing about it leaves the phone.
import type { Storage2 } from "../gym/liveSession";

const KEY = "jarvis.plan.leanedOn.v1";

function browserStorage(): Storage2 {
  return {
    read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
}

export function rememberLeanedOn(day: string, text: string | null | undefined, store: Storage2 = browserStorage()): void {
  const t = text?.trim();
  if (!t) { store.remove(KEY); return; }
  store.write(KEY, JSON.stringify({ day, text: t }));
}

/** The strand behind today's plan, for a task that was one of its picks. */
export function leanedOnFor(day: string, taskId: string, picks: string[], store: Storage2 = browserStorage()): { text: string } | null {
  try {
    const raw = store.read(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { day?: unknown; text?: unknown };
    if (v.day !== day || typeof v.text !== "string" || !v.text) return null;
    if (!picks.includes(taskId)) return null;
    return { text: v.text };
  } catch {
    return null;
  }
}
