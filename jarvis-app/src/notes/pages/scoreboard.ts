// THE SCOREBOARD (issue #115, wave 2): the Golf Scorecard's interaction, for every other game. Pick the sport and the page arranges
// itself: its columns, how a total is worked out, who is ahead and what ends the game. Nothing to arrange first, and changing the
// sport never discards a score (the columns that no longer apply are hidden, the scores kept).
//
// Four ways to score, enough for the whole index:
//   periods    columns added up (quarters, innings, halves, rounds), or columns WON (sets): basketball, baseball, volleyball, game night
//   target     one running score to a number (pickleball to 11, cornhole to 21)
//   bowling    ten frames with the real strike and spare scoring
//   countdown  down from a number to exactly zero, a turn that goes under does not count (darts 501)

import { type PageData, type PageRecord, type ScoreInfo, newId } from "./pageModel";

export interface SportPreset {
  key: string;
  name: string;
  group: "Team Sports" | "Racquet and Net" | "Target Games" | "Game Night";
  mode: ScoreInfo["mode"];
  periods: number;
  unit: string;
  winBy: ScoreInfo["winBy"];
  target?: number;
  /** Starting names for the sides. */
  sides: string[];
}

const two = ["Home", "Away"];
const P = (key: string, name: string, group: SportPreset["group"], periods: number, unit: string, winBy: SportPreset["winBy"] = "total", sides = two): SportPreset =>
  ({ key, name, group, mode: "periods", periods, unit, winBy, sides });

export const SPORTS: SportPreset[] = [
  P("basketball", "Basketball", "Team Sports", 4, "Quarter"),
  P("football", "Football", "Team Sports", 4, "Quarter"),
  P("soccer", "Soccer", "Team Sports", 2, "Half"),
  P("hockey", "Hockey", "Team Sports", 3, "Period"),
  P("baseball", "Baseball", "Team Sports", 9, "Inning"),
  P("softball", "Softball", "Team Sports", 7, "Inning"),
  P("lacrosse", "Lacrosse", "Team Sports", 4, "Quarter"),
  P("rugby", "Rugby", "Team Sports", 2, "Half"),
  P("waterpolo", "Water Polo", "Team Sports", 4, "Quarter"),
  P("volleyball", "Volleyball", "Racquet and Net", 3, "Set", "periodsWon"),
  P("tennis", "Tennis", "Racquet and Net", 3, "Set", "periodsWon", ["Player 1", "Player 2"]),
  { key: "pickleball", name: "Pickleball", group: "Racquet and Net", mode: "target", periods: 1, unit: "Game", winBy: "total", target: 11, sides: ["Team 1", "Team 2"] },
  { key: "tabletennis", name: "Table Tennis", group: "Racquet and Net", mode: "target", periods: 1, unit: "Game", winBy: "total", target: 11, sides: ["Player 1", "Player 2"] },
  { key: "cornhole", name: "Cornhole", group: "Target Games", mode: "target", periods: 1, unit: "Game", winBy: "total", target: 21, sides: ["Team 1", "Team 2"] },
  { key: "bowling", name: "Bowling", group: "Target Games", mode: "bowling", periods: 10, unit: "Frame", winBy: "total", sides: ["Player 1"] },
  { key: "darts501", name: "Darts 501", group: "Target Games", mode: "countdown", periods: 1, unit: "Turn", winBy: "total", target: 501, sides: ["Player 1", "Player 2"] },
  { key: "darts301", name: "Darts 301", group: "Target Games", mode: "countdown", periods: 1, unit: "Turn", winBy: "total", target: 301, sides: ["Player 1", "Player 2"] },
  P("gamenight", "Game Night", "Game Night", 5, "Round", "total", ["Player 1", "Player 2", "Player 3", "Player 4"]),
  P("trivia", "Trivia", "Game Night", 6, "Round", "total", ["Team 1", "Team 2", "Team 3"]),
];

export const SPORT_GROUPS: SportPreset["group"][] = ["Team Sports", "Racquet and Net", "Target Games", "Game Night"];

export const sportOf = (key: string): SportPreset | undefined => SPORTS.find((s) => s.key === key);

export const pKey = (n: number) => "p" + n;
/** Bowling: frame n, roll a, b or (frame 10 only) c. */
export const bKey = (frame: number, roll: "a" | "b" | "c") => `b${frame}${roll}`;
/** Darts: the nth turn. */
export const dKey = (turn: number) => "d" + turn;

export function newScoreboardPage(sportKey: string, sides: string[] | undefined, date: string): PageData {
  const sp = sportOf(sportKey) ?? SPORTS[0]!;
  const names = (sides ?? []).map((s) => s.trim()).filter(Boolean);
  const use = names.length ? names : sp.sides;
  return {
    v: 1,
    kind: "scoreboard",
    fields: [{ key: "name", label: sp.mode === "bowling" || sp.winBy === "periodsWon" || /Player/.test(sp.sides[0] ?? "") ? "Player" : "Team", type: "text" }],
    records: use.map((name) => ({ id: newId("r"), v: { name } })),
    score: { sport: sp.key, label: sp.name, mode: sp.mode, periods: sp.periods, unit: sp.unit, winBy: sp.winBy, ...(sp.target ? { target: sp.target } : {}), date },
  };
}

// ---------------------------------------------------------------------------
// Reading a side's scores.

const n = (s: string | undefined): number | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};

export function periodScore(r: PageRecord, p: number): number | null { return n(r.v[pKey(p)]); }

export interface Frame { n: number; rolls: number[]; score: number | null; total: number | null; mark: "X" | "/" | "" }

/** The ten frames with the real scoring: a strike is ten plus the next two rolls, a spare ten plus the next one, the tenth frame up to three rolls.
 *  A frame's running total is null until every roll it depends on has been thrown. */
export function bowlingFrames(r: PageRecord): Frame[] {
  const frames: Frame[] = [];
  for (let f = 1; f <= 10; f++) {
    const a = n(r.v[bKey(f, "a")]), b = n(r.v[bKey(f, "b")]), c = f === 10 ? n(r.v[bKey(f, "c")]) : null;
    const rolls = [a, b, c].filter((x): x is number => x !== null);
    frames.push({ n: f, rolls, score: null, total: null, mark: a === 10 ? "X" : a !== null && b !== null && a + b === 10 ? "/" : "" });
  }
  // Every roll in order, to look ahead for strikes and spares.
  const flat: number[] = [];
  const at: number[] = [];
  for (const fr of frames) { at.push(flat.length); flat.push(...fr.rolls); }
  let running = 0;
  for (let i = 0; i < 10; i++) {
    const fr = frames[i]!;
    const i0 = at[i]!;
    if (fr.rolls.length === 0) break;
    let need = 0;
    let sc: number | null = null;
    if (i < 9) {
      if (fr.rolls[0] === 10) { need = 3; sc = (flat[i0] ?? 0) + (flat[i0 + 1] ?? 0) + (flat[i0 + 2] ?? 0); }
      else if (fr.rolls.length === 2 && fr.rolls[0]! + fr.rolls[1]! === 10) { need = 3; sc = 10 + (flat[i0 + 2] ?? 0); }
      else if (fr.rolls.length === 2) { need = 2; sc = fr.rolls[0]! + fr.rolls[1]!; }
      else break;
      if (flat.length < i0 + need) break;
    } else {
      const done = fr.rolls[0] === 10 || (fr.rolls.length >= 2 && fr.rolls[0]! + fr.rolls[1]! === 10) ? fr.rolls.length === 3 : fr.rolls.length === 2;
      if (!done) break;
      sc = fr.rolls.reduce((x, y) => x + y, 0);
    }
    running += sc;
    fr.score = sc;
    fr.total = running;
  }
  return frames;
}

/** Pins the roll after `rolls` can still knock down in this frame, so entry never offers an impossible roll. */
export function pinsLeft(r: PageRecord, frame: number, roll: "a" | "b" | "c"): number {
  const a = n(r.v[bKey(frame, "a")]) ?? 0;
  const b = n(r.v[bKey(frame, "b")]) ?? 0;
  if (roll === "a") return 10;
  if (frame < 10) return 10 - a;
  if (roll === "b") return a === 10 ? 10 : 10 - a;
  // Tenth frame, third roll: a fresh rack after a strike or a spare.
  return a === 10 && b !== 10 ? 10 - b : 10;
}

export interface Turn { n: number; thrown: number; remaining: number; bust: boolean }

/** Darts: down from the start to exactly zero. A turn that would go under zero is a bust and does not count. */
export function dartTurns(page: PageData, r: PageRecord): Turn[] {
  const start = page.score?.target ?? 501;
  const out: Turn[] = [];
  let left = start;
  for (let t = 1; t <= 60; t++) {
    const s = n(r.v[dKey(t)]);
    if (s === null) break;
    if (s > left) { out.push({ n: t, thrown: s, remaining: left, bust: true }); continue; }
    left -= s;
    out.push({ n: t, thrown: s, remaining: left, bust: false });
  }
  return out;
}

export function dartsLeft(page: PageData, r: PageRecord): number {
  const t = dartTurns(page, r);
  return t.length ? t[t.length - 1]!.remaining : page.score?.target ?? 501;
}

/** A side's total in the page's own way of counting. For countdown, what is left. */
export function sideTotal(page: PageData, r: PageRecord): number {
  const sc = page.score!;
  if (sc.mode === "bowling") return bowlingFrames(r).reduce((last, f) => (f.total !== null ? f.total : last), 0);
  if (sc.mode === "countdown") return dartsLeft(page, r);
  if (sc.mode === "target") return periodScore(r, 1) ?? 0;
  let t = 0;
  for (let p = 1; p <= sc.periods; p++) t += periodScore(r, p) ?? 0;
  return t;
}

/** Columns a side has taken (sets won): one point per column it led, ties to nobody. */
export function periodsWon(page: PageData, r: PageRecord): number {
  const sc = page.score!;
  let won = 0;
  for (let p = 1; p <= sc.periods; p++) {
    const mine = periodScore(r, p);
    if (mine === null) continue;
    const best = Math.max(...page.records.filter((x) => x.id !== r.id).map((x) => periodScore(x, p) ?? -1));
    if (mine > best) won++;
  }
  return won;
}

/** The number the page ranks by and shows large: the total, or sets won, or what is left. */
export function headline(page: PageData, r: PageRecord): number {
  const sc = page.score!;
  return sc.winBy === "periodsWon" && sc.mode === "periods" ? periodsWon(page, r) : sideTotal(page, r);
}

export interface Standing { id: string; name: string; value: number; secondary: number | null; leading: boolean; done: boolean }

/** Who is ahead, and whether the game is over (a target reached, zero hit, ten frames done, every column played). */
export function scoreStanding(page: PageData): Standing[] {
  const sc = page.score!;
  const rows = page.records.map((r) => ({ r, v: headline(page, r), s: sc.winBy === "periodsWon" ? sideTotal(page, r) : null }));
  const lowWins = sc.mode === "countdown";
  const best = rows.length ? (lowWins ? Math.min(...rows.map((x) => x.v)) : Math.max(...rows.map((x) => x.v))) : 0;
  const anyScore = rows.some((x) => (sc.mode === "countdown" ? x.v < (sc.target ?? 501) : x.v > 0));
  return rows.map(({ r, v, s }) => ({
    id: r.id,
    name: (r.v.name ?? "").trim() || "Side",
    value: v,
    secondary: s,
    leading: anyScore && v === best && rows.filter((x) => x.v === best).length === 1,
    done: sc.mode === "target" ? v >= (sc.target ?? 11) : sc.mode === "countdown" ? v === 0 : sc.mode === "bowling" ? bowlingFrames(r)[9]!.total !== null : false,
  }));
}

/** The first column nobody has a score in yet (where the game picks up). */
export function nextPeriod(page: PageData): number {
  const sc = page.score!;
  if (sc.mode === "bowling") {
    for (let f = 1; f <= 10; f++) if (page.records.some((r) => n(r.v[bKey(f, "a")]) === null)) return f;
    return 10;
  }
  if (sc.mode === "countdown") return Math.max(1, ...page.records.map((r) => dartTurns(page, r).length + 1));
  for (let p = 1; p <= sc.periods; p++) if (page.records.some((r) => periodScore(r, p) === null)) return p;
  return sc.periods;
}

export function setPeriodScore(page: PageData, recordId: string, p: number, score: number | null): PageData {
  return {
    ...page,
    records: page.records.map((r) => (r.id === recordId ? { ...r, v: { ...r.v, [pKey(p)]: score === null ? "" : String(Math.max(0, Math.round(score))) } } : r)),
  };
}

export function setCell(page: PageData, recordId: string, key: string, score: number | null): PageData {
  return {
    ...page,
    records: page.records.map((r) => (r.id === recordId ? { ...r, v: { ...r.v, [key]: score === null ? "" : String(Math.max(0, Math.round(score))) } } : r)),
  };
}

/** One more column (an extra inning, a tiebreak set). Always allowed; scores already entered are untouched. */
export function addPeriod(page: PageData): PageData {
  const sc = page.score!;
  return { ...page, score: { ...sc, periods: sc.periods + 1 } };
}

/** Switching sport re-arranges how it is counted. Scores stay on the sides, so switching back brings them all back: columns that no
 *  longer apply are not drawn, never deleted. */
export function setSport(page: PageData, sportKey: string): PageData {
  const sp = sportOf(sportKey);
  if (!sp || !page.score) return page;
  return { ...page, score: { ...page.score, sport: sp.key, label: sp.name, mode: sp.mode, periods: Math.max(sp.periods, 1), unit: sp.unit, winBy: sp.winBy, ...(sp.target ? { target: sp.target } : { target: undefined }) } };
}

/** How many entered scores a change of sport would stop drawing, said before it happens. */
export function sportChangeImpact(page: PageData, sportKey: string): number {
  const sp = sportOf(sportKey);
  if (!sp || !page.score || sp.mode === page.score.mode && sp.periods >= page.score.periods) return 0;
  let hidden = 0;
  for (const r of page.records) for (const [k, v] of Object.entries(r.v)) {
    if (!(v ?? "").trim()) continue;
    if (sp.mode !== page.score.mode && /^(p\d+|b\d+[abc]|d\d+)$/.test(k)) hidden++;
    else if (sp.mode === page.score.mode && sp.mode === "periods") { const m = /^p(\d+)$/.exec(k); if (m && Number(m[1]) > sp.periods) hidden++; }
  }
  return hidden;
}

export function sportName(page: PageData): string { return sportOf(page.score?.sport ?? "")?.name ?? "Game"; }
