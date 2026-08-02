// Time Sense (internal engine, ADHD strategy). Phase 1 ships only the silent
// collector: every task completion logs an hour-of-day sample so Phase 2's
// surfaces (Window, Heads Up, real energy curve) launch with real data instead
// of self-report. No UI, no reads yet, storage-guarded for non-browser tests.

const KEY = "jarvis.timesense.v1";
const CAP = 1000;

export interface CompletionSample {
  t: number; // epoch ms
  h: number; // local hour 0-23
  dow: number; // 0-6
  cat: string; // category id ("" if none)
  id?: string; // task id (Session 4+): per-task timing, so anchor-relative
  // placement can one day ask "you take vitamins at 7:40, not 7:00, move it?"
  // from real data instead of a guess. Still silent, still best-effort.
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function recordCompletion(category: string, when: Date = new Date(), taskId?: string): void {
  const s = storage();
  if (!s) return;
  try {
    const all = readSamples();
    const sample: CompletionSample = { t: when.getTime(), h: when.getHours(), dow: when.getDay(), cat: category };
    if (taskId) sample.id = taskId;
    all.push(sample);
    s.setItem(KEY, JSON.stringify(all.slice(-CAP)));
  } catch {
    /* full or private mode: sampling is best-effort by design */
  }
}

export function readSamples(): CompletionSample[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(KEY) || "[]");
    return Array.isArray(raw) ? (raw as CompletionSample[]) : [];
  } catch {
    return [];
  }
}
