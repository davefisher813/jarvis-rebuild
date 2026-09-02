// THE CONDITIONING BLOCK (Closing Round, ruled 2026-09-01; The Row and
// Health and Check, Health, Stop, picked 2026-09-02).
//
// "Two states: the timer while it runs, the log after, round splits
// captured free." This file is every derivation the two states share, so
// the face and the receipt cannot disagree about what a round is or what
// the score reads. Nothing here touches the DOM or the clock; it takes
// elapsed seconds and answers questions about them.
//
// What the market does (fu catalog, 2026-09-01): SmartWOD, BoxClock and
// PushPress all run a huge clock, count rounds by a tap, and take the score
// by hand after. Interval formats (EMOM, Tabata) mark their own rounds;
// AMRAP and For Time need the athlete to say when a round ended.

import type { CondBlock, CondFormat, Exercise, SetEntry, SetLog } from "./types";
import { COND_LABEL } from "./types";
import { newSetId } from "./strip";

/** "7:42", "0:07", "12:00". */
export function mmss(totalSec: number): string {
  const t = Math.max(0, Math.round(totalSec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** A whole block from its parts, so the sheet never stores a cap that
 *  disagrees with its own intervals. */
export function condCap(format: CondFormat, parts: { minutes?: number; intervalSec?: number; restSec?: number; rounds?: number }): number {
  if (format === "emom") return (parts.intervalSec ?? 60) * (parts.rounds ?? 10);
  if (format === "tabata") return ((parts.intervalSec ?? 20) + (parts.restSec ?? 10)) * (parts.rounds ?? 8);
  return Math.max(1, Math.round((parts.minutes ?? 12) * 60));
}

/** The head line: "AMRAP · 12:00", "EMOM · 10 × 1:00", "For Time · cap 20:00", "Tabata · 8 × 0:20 / 0:10". */
export function condSummary(c: CondBlock): string {
  const name = COND_LABEL[c.format];
  if (c.format === "emom") return `${name} · ${c.rounds ?? 0} × ${mmss(c.intervalSec ?? 60)}`;
  if (c.format === "tabata") return `${name} · ${c.rounds ?? 0} × ${mmss(c.intervalSec ?? 20)} / ${mmss(c.restSec ?? 10)}`;
  if (c.format === "for_time") return `${name} · cap ${mmss(c.capSec)}`;
  return `${name} · ${mmss(c.capSec)}`;
}

/** Interval formats mark their own rounds; the other two wait for a tap. */
export function marksOwnRounds(c: CondBlock): boolean {
  return c.format === "emom" || c.format === "tabata";
}

/** Where an interval clock is at `elapsed`: the round (1-based), the phase,
 *  and how much of the phase is left. Past the cap it reports the last
 *  round with nothing left. */
export function intervalAt(c: CondBlock, elapsed: number): { round: number; phase: "work" | "rest"; left: number } {
  const work = c.intervalSec ?? (c.format === "tabata" ? 20 : 60);
  const rest = c.format === "tabata" ? (c.restSec ?? 10) : 0;
  const span = work + rest;
  const rounds = Math.max(1, c.rounds ?? Math.floor(c.capSec / span));
  const e = Math.max(0, elapsed);
  const idx = Math.min(rounds - 1, Math.floor(e / span));
  const into = e - idx * span;
  if (into < work) return { round: idx + 1, phase: "work", left: work - into };
  return { round: idx + 1, phase: "rest", left: Math.max(0, span - into) };
}

/** Whole intervals an interval clock has finished at `elapsed`. */
export function intervalsDone(c: CondBlock, elapsed: number): number {
  const work = c.intervalSec ?? (c.format === "tabata" ? 20 : 60);
  const rest = c.format === "tabata" ? (c.restSec ?? 10) : 0;
  const span = Math.max(1, work + rest);
  const rounds = Math.max(1, c.rounds ?? Math.floor(c.capSec / span));
  return Math.min(rounds, Math.floor(Math.max(0, elapsed) / span));
}

/** Per-round durations from cumulative splits, with the change from the
 *  round before: +6 means six seconds slower, -11 eleven faster. */
export function perRound(splits: number[]): { round: number; sec: number; delta: number | null }[] {
  const out: { round: number; sec: number; delta: number | null }[] = [];
  let prev = 0;
  splits.forEach((s, i) => {
    const sec = Math.max(0, s - prev);
    const before = out[i - 1]?.sec;
    out.push({ round: i + 1, sec, delta: before == null ? null : Math.round(sec - before) });
    prev = s;
  });
  return out;
}

/** The entry the clock writes when it stops. The kind says what the score
 *  is; the clock's own facts ride along so the receipt can show them. */
export function condResultEntry(ex: Pick<Exercise, "kind" | "unit" | "cond">, elapsedSec: number, splits: number[]): SetEntry {
  const elapsed = Math.round(elapsedSec);
  const base: SetLog = { elapsed, ...(splits.length ? { splits: splits.map((s) => Math.round(s)) } : {}) };
  const rounds = ex.cond && marksOwnRounds(ex.cond) ? intervalsDone(ex.cond, elapsed) : splits.length;
  switch (ex.kind) {
    case "rounds":
      return { id: newSetId(), ...base, ...(rounds > 0 ? { r: rounds } : {}), ...(rounds === 0 ? { done: true } : {}) };
    case "time_faster":
    case "time_longer": {
      const v = ex.unit === "min" ? Math.round((elapsed / 60) * 100) / 100 : elapsed;
      return { id: newSetId(), ...base, v };
    }
    case "reps":
      return { id: newSetId(), ...base, done: true };
    default:
      return { id: newSetId(), ...base, done: true };
  }
}

/** The score as the receipt prints it: "7 + 12", "7 rounds", "7:42", "Done". */
export function condScore(ex: Pick<Exercise, "kind" | "unit">, s: SetLog): string {
  if (ex.kind === "rounds") {
    const r = s.r ?? 0;
    if (r === 0 && !s.extra) return s.done ? "Done" : "Empty";
    return s.extra ? `${r} + ${s.extra}` : `${r} ${r === 1 ? "round" : "rounds"}`;
  }
  if (ex.kind === "time_faster" || ex.kind === "time_longer") {
    if (s.elapsed != null) return mmss(s.elapsed);
    if (s.v != null) return ex.unit === "min" ? mmss(s.v * 60) : mmss(s.v);
    return s.done ? "Done" : "Empty";
  }
  return s.done || s.elapsed != null ? "Done" : "Empty";
}

/** What the score field is called on the receipt. */
export function condScoreLabel(ex: Pick<Exercise, "kind" | "cond">): string {
  if (ex.kind === "rounds") return "Rounds + reps";
  if (ex.kind === "time_faster" || ex.kind === "time_longer") return "Time";
  return ex.cond?.format === "emom" || ex.cond?.format === "tabata" ? "Rounds" : "Result";
}

/** The seconds an entry's clock ran, from either fact it may carry. */
export function elapsedOf(ex: Pick<Exercise, "kind" | "unit">, s: SetLog): number | null {
  if (s.elapsed != null) return s.elapsed;
  if ((ex.kind === "time_faster" || ex.kind === "time_longer") && s.v != null) return ex.unit === "min" ? s.v * 60 : s.v;
  return null;
}
