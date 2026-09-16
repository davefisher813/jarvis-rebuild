// THE FIFTEEN, WHILE IT RUNS (Dave 2026-09-16: "All buttons need to do
// something THAT ACTUALLY helps... I still haven't clicked a button and it
// helped me in any single way on this home page").
//
// Start used to be a write and a toast. It booked fifteen minutes on the
// calendar, said so once, and then Today went back to looking exactly as it
// did before the tap, which is the same as nothing having happened. The
// whole reason Just Fifteen works is the second half of its own promise:
// "fifteen minutes, and it ENDS" (tasks/rightNow.ts). A commitment you
// cannot see the end of is one you cannot see yourself finishing, so the end
// has to be on screen while it runs, and it has to arrive.
//
// So a running fifteen is a thing now, and it lives here. Two rules, both
// borrowed from the live gym session, which had this problem first:
//
//   1. IT LIVES IN localStorage, NOT IN REACT. The block is fifteen real
//      minutes of a person's life, and phones lock, apps background and
//      webviews get killed. A countdown held in component state is a
//      countdown that resets when he checks a message.
//   2. IT IS A FUNCTION OF THE CLOCK. Never of how many timer ticks the
//      webview let fire. The remaining time is startedAt + minutes - now,
//      asked fresh, so a backgrounded app comes back correct rather than
//      behind.
//
// Nothing here writes to the calendar. TodayFlow owns that, because the
// commit is a service call and this file is meant to be answerable without
// mounting anything.

const KEY = "jarvis.today.fifteen.v1";

export interface LiveFifteen {
  taskId: string;
  /** The task's words, so the card can name it without a lookup. */
  text: string;
  /** Wall-clock ms the block started. */
  startedAt: number;
  /** The block's own start, as the calendar holds it. Another fifteen grows
   *  the existing event rather than booking a second one, and that needs
   *  the original edge. */
  startHHMM: string;
  /** The day it started, for the staleness check. */
  date: string;
  /** Total committed minutes: 15, then 30 after one more, and so on. */
  minutes: number;
  /** How many fifteens he has taken in a row. 1 on the first Start. */
  rounds: number;
}

export interface Storage2 { read(k: string): string | null; write(k: string, v: string): void; remove(k: string): void }

function browserStorage(): Storage2 {
  return {
    read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
}

export function readFifteen(store: Storage2 = browserStorage()): LiveFifteen | null {
  try {
    const raw = store.read(KEY);
    return raw ? (JSON.parse(raw) as LiveFifteen) : null;
  } catch {
    return null;
  }
}

export function writeFifteen(s: LiveFifteen, store: Storage2 = browserStorage()): void {
  store.write(KEY, JSON.stringify(s));
}

export function clearFifteen(store: Storage2 = browserStorage()): void {
  store.remove(KEY);
}

/** Milliseconds left on the block. Zero once it is up, never negative. */
export function remainingMs(s: LiveFifteen, now: number = Date.now()): number {
  return Math.max(0, s.startedAt + s.minutes * 60_000 - now);
}

/** Milliseconds since the block ran out. Zero while it is still running. */
export function overdueMs(s: LiveFifteen, now: number = Date.now()): number {
  return Math.max(0, now - (s.startedAt + s.minutes * 60_000));
}

/**
 * AN UNANSWERED QUESTION EXPIRES (2026-09-16). The end prompt is worth
 * asking at the moment the block ends and for a little while after, and it
 * is worth nothing the next morning: a card asking whether he finished
 * something he was doing yesterday evening is a chore, not a help, and the
 * honest answer by then is "the app was closed". So a block nobody answered
 * for an hour stops asking, and a block from another day is gone outright.
 */
export const STALE_MS = 60 * 60 * 1000;

export function isStillLive(s: LiveFifteen, todayIso: string, now: number = Date.now()): boolean {
  if (s.date !== todayIso) return false;
  return overdueMs(s, now) < STALE_MS;
}

/** "14:32", always mm:ss, counting the ceiling so a block that has 1 ms
 *  left says 0:01 rather than 0:00. Zero is what `over` is for. */
export function countdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface FifteenFace {
  taskId: string;
  text: string;
  /** True once the block is up and the question is on the table. */
  over: boolean;
  /**
   * The one line the card says. Running, it is the clock: "14:32 Left", the
   * fact he tapped Start to get. Up, it states the fact and nothing else --
   * not "well done", not "keep going". The two verbs under it are the
   * question, and a line that already leans on one of them is a nudge
   * wearing a fact's clothes.
   */
  line: string;
}

export function fifteenFace(s: LiveFifteen, now: number = Date.now()): FifteenFace {
  const left = remainingMs(s, now);
  return {
    taskId: s.taskId,
    text: s.text,
    over: left === 0,
    line: left === 0 ? `${s.minutes} Minutes up` : `${countdown(left)} Left`,
  };
}

/**
 * One more fifteen: fifteen minutes from NOW, not from where the last block
 * happened to end. The distinction is the whole point of answering the
 * prompt late. If the question sat on screen for six minutes while he
 * finished a thought, "another fifteen" means the next fifteen minutes of
 * his evening, and a block that expired six minutes ago plus fifteen would
 * be a timer that starts already spent.
 *
 * It grows the existing block rather than booking a second one, because he
 * did not stop and start again, he kept going, and the calendar should say
 * one sitting.
 */
export function extended(s: LiveFifteen, add: number, now: number = Date.now()): LiveFifteen {
  const elapsedMin = Math.max(0, Math.round((now - s.startedAt) / 60_000));
  return { ...s, minutes: elapsedMin + add, rounds: s.rounds + 1 };
}
