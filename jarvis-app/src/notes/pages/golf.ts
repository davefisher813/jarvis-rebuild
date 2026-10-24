// GOLF, THE REBUILD (Dave's template decisions, 2026-10-23, Decision 1). Pure functions over a scorecard page; nothing here draws.
//
// What the rebuild stands on:
//  - A par is real or it is not there. A new round starts with NO pars (0), never eighteen fours; a hole with no par is left out of
//    "to par" and says so. A score is never written for the person: a hole nobody scored has no score, and par is never copied in.
//  - Net and Stableford are worked out live from each player's handicap (strokes for the round) and the course's stroke index.
//  - Greens in regulation are WORKED OUT, never asked: a green is in regulation when the strokes before the putts, the score less the
//    putts, are at most par less two.
//  - A course is remembered with its real pars (and stroke index) on the Rounds page, so one setup is the only setup.
import {
  type PageData, type PageRecord, type GolfInfo,
  scoreOf, toParLabel, holeWord,
} from "./pageModel";

// ---------------------------------------------------------------------------
// The per-hole stats a record can carry beside its score. They live in the record's values under their own keys, never in the
// page's fields (a field named like a hole would be drawn as a column). All of them are optional, one tap each.

export const puttKey = (h: number) => "pt" + h;
export const fairKey = (h: number) => "fw" + h;
export const penKey = (h: number) => "pn" + h;
export const sandKey = (h: number) => "sd" + h;

export type Fairway = "L" | "H" | "R";
export const FAIRWAYS: { key: Fairway; label: string }[] = [{ key: "L", label: "Left" }, { key: "H", label: "Hit" }, { key: "R", label: "Right" }];

export interface HoleStats { putts: number | null; fairway: Fairway | null; penalties: number; sand: boolean }

const intOf = (s: string | undefined): number | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
};

export function statsOf(r: PageRecord, hole: number): HoleStats {
  const fw = (r.v[fairKey(hole)] ?? "").trim();
  return {
    putts: intOf(r.v[puttKey(hole)]),
    fairway: fw === "L" || fw === "H" || fw === "R" ? fw : null,
    penalties: Math.max(0, intOf(r.v[penKey(hole)]) ?? 0),
    sand: (r.v[sandKey(hole)] ?? "") === "1",
  };
}

/** One stat set or cleared. A blank value is removed, so a cleared stat leaves no trace. */
export function setStat(page: PageData, recordId: string, key: string, value: string): PageData {
  return {
    ...page,
    records: page.records.map((r) => {
      if (r.id !== recordId) return r;
      const v = { ...r.v };
      if (value === "") delete v[key]; else v[key] = value;
      return { ...r, v };
    }),
  };
}

// ---------------------------------------------------------------------------
// Pars and the stroke index.

/** The hole's par, or null when it has not been set (never a guess). */
export function parOf(g: GolfInfo, hole: number): number | null {
  const p = g.par[hole - 1];
  return typeof p === "number" && p >= 3 && p <= 6 ? p : null;
}

/** How many of the round's holes have a real par. */
export function parsSet(g: GolfInfo): number {
  let n = 0;
  for (let h = 1; h <= g.holes; h++) if (parOf(g, h) !== null) n++;
  return n;
}

export const parsComplete = (g: GolfInfo): boolean => parsSet(g) >= g.holes;

/** A par set on a hole. Three to six; anything else is refused by returning the page unchanged. */
export function setHolePar(page: PageData, hole: number, par: number | null): PageData {
  const g = page.golf!;
  if (hole < 1 || hole > 18) return page;
  const p = g.par.slice();
  while (p.length < 18) p.push(0);
  p[hole - 1] = par === null ? 0 : Math.min(6, Math.max(3, Math.round(par)));
  return { ...page, golf: { ...g, par: p } };
}

/** The stroke index of each hole, hardest first, 1 to 18. Absent on the course: the holes in order. */
export function siOf(g: GolfInfo, hole: number): number {
  const s = g.si?.[hole - 1];
  return typeof s === "number" && s >= 1 && s <= 18 ? s : hole;
}

/** The rank of each played hole by stroke index, 1 = hardest, so a nine-hole round shares its strokes across its own nine. */
function ranks(g: GolfInfo): number[] {
  const order = Array.from({ length: g.holes }, (_, i) => i + 1).sort((a, b) => siOf(g, a) - siOf(g, b) || a - b);
  const out: number[] = [];
  order.forEach((h, i) => { out[h] = i + 1; });
  return out;
}

/** A player's handicap for this round: the strokes they get, as the person typed them. Null when none was given. */
export function hcpOf(r: PageRecord): number | null {
  const n = intOf(r.v.hcp);
  return n === null ? null : Math.min(54, Math.max(0, n));
}

/** Strokes a player receives on a hole: the whole laps of the round, then one more on each of the hardest holes that are left. */
export function strokesOn(g: GolfInfo, hcp: number | null, hole: number): number {
  if (hcp === null || hcp <= 0) return 0;
  const n = g.holes;
  const rank = ranks(g)[hole] ?? hole;
  return Math.floor(hcp / n) + (rank <= hcp % n ? 1 : 0);
}

/** Stableford on one hole: two for net par, one more for each stroke under it, none above a net bogey. */
export function stablefordOn(score: number, par: number, strokes: number): number {
  return Math.max(0, 2 + par - (score - strokes));
}

/** Greens in regulation, worked out: the strokes before the putts were par less two or fewer. Null until the putts are in. */
export function girOn(score: number | null, putts: number | null, par: number | null): boolean | null {
  if (score === null || putts === null || par === null) return null;
  return score - putts <= par - 2;
}

// ---------------------------------------------------------------------------
// One player's round, live.

export interface PlayerRound {
  played: number; thru: number;
  gross: number; out: number; in: number;
  /** Strokes over or under par across the holes that were scored AND have a par. Null when none has both. */
  toPar: number | null;
  /** Scored holes that have no par yet, so "to par" can say it leaves them out. */
  noPar: number;
  hcp: number | null;
  /** Gross less the strokes received on the holes played. Null with no handicap. */
  net: number | null;
  points: number | null;
  putts: number | null;
  fwHit: number; fwOf: number;
  gir: number; girOf: number;
  penalties: number; sand: number;
  birds: number; pars: number; bogeys: number; doubles: number;
  best: { hole: number; word: string } | null;
  worst: { hole: number; word: string } | null;
}

export function playerRound(page: PageData, r: PageRecord): PlayerRound {
  const g = page.golf!;
  const hcp = hcpOf(r);
  const o: PlayerRound = {
    played: 0, thru: 0, gross: 0, out: 0, in: 0, toPar: null, noPar: 0, hcp, net: null, points: null,
    putts: null, fwHit: 0, fwOf: 0, gir: 0, girOf: 0, penalties: 0, sand: 0, birds: 0, pars: 0, bogeys: 0, doubles: 0, best: null, worst: null,
  };
  let toPar = 0, sawPar = false, strokes = 0, pts = 0, puttSum = 0, puttHoles = 0;
  let bestD = Infinity, worstD = -Infinity;
  for (let h = 1; h <= g.holes; h++) {
    const s = scoreOf(r, h);
    if (s === null) continue;
    const par = parOf(g, h);
    o.played++; o.thru = h; o.gross += s;
    if (h <= 9) o.out += s; else o.in += s;
    strokes += strokesOn(g, hcp, h);
    if (par === null) o.noPar++;
    else {
      sawPar = true;
      const d = s - par;
      toPar += d;
      if (hcp !== null) pts += stablefordOn(s, par, strokesOn(g, hcp, h));
      if (s === 1 || d <= -1) o.birds++; else if (d === 0) o.pars++; else if (d === 1) o.bogeys++; else o.doubles++;
      if (d < bestD) { bestD = d; o.best = { hole: h, word: holeWord(s, par) }; }
      if (d > worstD) { worstD = d; o.worst = { hole: h, word: holeWord(s, par) }; }
    }
    const st = statsOf(r, h);
    if (st.putts !== null) { puttSum += st.putts; puttHoles++; }
    if (st.fairway && (par === null || par >= 4)) { o.fwOf++; if (st.fairway === "H") o.fwHit++; }
    const gir = girOn(s, st.putts, par);
    if (gir !== null) { o.girOf++; if (gir) o.gir++; }
    o.penalties += st.penalties;
    if (st.sand) o.sand++;
  }
  o.toPar = sawPar ? toPar : null;
  if (hcp !== null && o.played > 0) { o.net = o.gross - strokes; o.points = pts; }
  o.putts = puttHoles > 0 ? puttSum : null;
  // A best hole is only worth saying when it beat par; a worst only when it lost to it.
  if (o.best && bestD >= 0) o.best = null;
  if (o.worst && worstD <= 0) o.worst = null;
  return o;
}

/** Net to par: the net score against the par of the holes that were scored. Null without a handicap or any par. */
export function netToPar(page: PageData, r: PageRecord): number | null {
  const p = playerRound(page, r);
  if (p.net === null || p.toPar === null) return null;
  const g = page.golf!;
  let parSum = 0, grossOnPar = 0;
  for (let h = 1; h <= g.holes; h++) {
    const s = scoreOf(r, h); const par = parOf(g, h);
    if (s === null || par === null) continue;
    parSum += par; grossOnPar += s;
  }
  // The net of only the holes that have a par, so a hole without one never skews the figure.
  let given = 0;
  for (let h = 1; h <= g.holes; h++) if (scoreOf(r, h) !== null && parOf(g, h) !== null) given += strokesOn(g, p.hcp, h);
  return grossOnPar - given - parSum;
}

// ---------------------------------------------------------------------------
// Match play: two players, a hole at a time, net of their strokes.

export interface MatchState {
  /** Holes up for the first player (negative: the second leads). */
  lead: number;
  thru: number;
  over: boolean;
  /** Who is ahead: 0 or 1, or null when level. */
  leader: 0 | 1 | null;
  /** The status said as parts for a facts line: who, how far, and where. */
  words: { who: string | null; what: string };
}

export function matchState(page: PageData): MatchState | null {
  const g = page.golf!;
  if (!g.match || page.records.length !== 2) return null;
  const [a, b] = page.records as [PageRecord, PageRecord];
  const ha = hcpOf(a), hb = hcpOf(b);
  // Strokes go to the higher handicap, off the lower: the difference, which is how a match is played.
  const low = Math.min(ha ?? 0, hb ?? 0);
  const ga = ha === null ? null : Math.max(0, ha - low), gb = hb === null ? null : Math.max(0, hb - low);
  let lead = 0, thru = 0;
  for (let h = 1; h <= g.holes; h++) {
    const sa = scoreOf(a, h), sb = scoreOf(b, h);
    if (sa === null || sb === null) break;
    thru = h;
    const na = sa - strokesOn(g, ga, h), nb = sb - strokesOn(g, gb, h);
    if (na < nb) lead++; else if (nb < na) lead--;
  }
  const remaining = g.holes - thru;
  const leader: 0 | 1 | null = lead > 0 ? 0 : lead < 0 ? 1 : null;
  const name = (i: 0 | 1) => (page.records[i]!.v.name ?? "").trim() || "Player";
  const up = Math.abs(lead);
  const over = thru > 0 && (up > remaining || remaining === 0);
  let words: MatchState["words"];
  if (thru === 0) words = { who: null, what: "Not Started" };
  else if (over && leader === null) words = { who: null, what: "Halved" };
  else if (over && leader !== null) words = { who: name(leader), what: remaining === 0 ? `Wins ${up} Up` : `Wins ${up} and ${remaining}` };
  else if (leader === null) words = { who: null, what: `All Square Thru ${thru}` };
  else words = { who: name(leader), what: `${up} Up Thru ${thru}` };
  return { lead, thru, over, leader, words };
}

// ---------------------------------------------------------------------------
// The finish: the story of the round, and what goes into the Rounds record.

export interface RoundLine { name: string; facts: string[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The round told per player, each fact a short phrase in Title Case (they are drawn as separate facts, never joined by a dot). */
export function roundStory(page: PageData): RoundLine[] {
  const g = page.golf!;
  return page.records.map((r) => {
    const p = playerRound(page, r);
    const facts: string[] = [];
    if (p.played === 0) return { name: (r.v.name ?? "").trim() || "Player", facts: ["No Scores"] };
    facts.push(`${p.gross} Gross`);
    if (p.toPar !== null) facts.push(toParLabel(p.toPar));
    if (p.net !== null) facts.push(`${p.net} Net`);
    if (p.points !== null) facts.push(`${p.points} Points`);
    if (p.played > 9 && g.holes === 18 && p.played >= 18) {
      const d = p.in - p.out;
      facts.push(d === 0 ? `${p.out} Out and ${p.in} In` : d > 0 ? `${p.out} Out, ${p.in} In, Back Nine Cost ${d} More` : `${p.out} Out, ${p.in} In, Back Nine Saved ${-d}`);
    }
    if (p.birds) facts.push(plural(p.birds, "Birdie or Better", "Birdies or Better"));
    if (p.bogeys + p.doubles > 0 && p.worst) facts.push(`Hardest Hole ${p.worst.hole}, ${p.worst.word}`);
    if (p.best) facts.push(`Best Hole ${p.best.hole}, ${p.best.word}`);
    if (p.putts !== null) facts.push(`${p.putts} Putts`);
    if (p.fwOf) facts.push(`${p.fwHit} of ${p.fwOf} Fairways`);
    if (p.girOf) facts.push(`${p.gir} of ${p.girOf} Greens`);
    if (p.penalties) facts.push(plural(p.penalties, "Penalty", "Penalties"));
    if (p.noPar) facts.push(`${plural(p.noPar, "Hole Has", "Holes Have")} No Par`);
    return { name: (r.v.name ?? "").trim() || "Player", facts };
  });
}

/** Who won, said once, when there is something to say: the match when it is on, otherwise the lowest net or gross over a full card. */
export function winnerLine(page: PageData): string | null {
  const m = matchState(page);
  if (m) return m.words.who ? `${m.words.who} ${m.words.what}` : m.words.what;
  const g = page.golf!;
  if (page.records.length < 2) return null;
  const rows = page.records.map((r) => ({ r, p: playerRound(page, r) }));
  if (!rows.every((x) => x.p.played >= g.holes)) return null;
  const hasNet = rows.every((x) => x.p.net !== null);
  const key = (x: (typeof rows)[number]) => (hasNet ? x.p.net! : x.p.gross);
  const best = Math.min(...rows.map(key));
  const winners = rows.filter((x) => key(x) === best);
  if (winners.length !== 1) return "Tied";
  const nm = (winners[0]!.r.v.name ?? "").trim() || "Player";
  return `${nm} Won, ${best} ${hasNet ? "Net" : "Gross"}`;
}

export const ROUNDS_FIELDS = ["date", "course", "player", "score", "topar", "net", "pts", "putts", "fairways", "greens"] as const;

/** One value row per player for the Rounds page. `rid` ties a row to the round and player, so finishing twice replaces, never doubles. */
export function roundRows(page: PageData, roundId: string): { rid: string; v: Record<string, string> }[] {
  const g = page.golf!;
  const out: { rid: string; v: Record<string, string> }[] = [];
  for (const r of page.records) {
    const p = playerRound(page, r);
    if (p.played === 0) continue;
    const v: Record<string, string> = {
      date: g.date, course: g.course, player: (r.v.name ?? "").trim() || "Player", score: String(p.gross),
    };
    if (p.toPar !== null) v.topar = toParLabel(p.toPar);
    if (p.net !== null) v.net = String(p.net);
    if (p.points !== null) v.pts = String(p.points);
    if (p.putts !== null) v.putts = String(p.putts);
    if (p.fwOf) v.fairways = `${p.fwHit} of ${p.fwOf}`;
    if (p.girOf) v.greens = String(p.gir);
    out.push({ rid: `${roundId}:${r.id}`, v });
  }
  return out;
}

/** The Rounds page with this round's rows in it: a row for the same round and player is replaced, the rest are kept. */
export function withRounds(rounds: PageData, rows: { rid: string; v: Record<string, string> }[], newId: (p: string) => string): PageData {
  const records = rounds.records.slice();
  for (const row of rows) {
    const i = records.findIndex((r) => r.v.rid === row.rid);
    if (i >= 0) records[i] = { ...records[i]!, v: { ...row.v, rid: row.rid } };
    else records.push({ id: newId("r"), v: { ...row.v, rid: row.rid } });
  }
  return { ...rounds, records };
}

// ---------------------------------------------------------------------------
// The course book: a course is remembered with its real pars after one setup. It lives on the Rounds page, in its settings.

export interface CourseMemo { name: string; holes: 9 | 18; par: number[]; si?: number[] }

export const courseKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");
const BOOK = "course:";

export function readCourseBook(rounds: PageData | null | undefined): CourseMemo[] {
  const out: CourseMemo[] = [];
  for (const [k, raw] of Object.entries(rounds?.meta ?? {})) {
    if (!k.startsWith(BOOK)) continue;
    try {
      const m = JSON.parse(raw) as CourseMemo;
      if (m && typeof m.name === "string" && Array.isArray(m.par) && m.par.length === 18) out.push({ name: m.name, holes: m.holes === 9 ? 9 : 18, par: m.par, ...(Array.isArray(m.si) && m.si.length === 18 ? { si: m.si } : {}) });
    } catch { /* a book entry that cannot be read is skipped, never fatal */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function findCourse(book: CourseMemo[], name: string): CourseMemo | null {
  const k = courseKey(name);
  return k ? book.find((c) => courseKey(c.name) === k) ?? null : null;
}

/** The course kept in the book, but only once every hole of the round has a real par. Nothing half-set is ever remembered. */
export function rememberCourse(rounds: PageData, golf: GolfInfo): PageData {
  if (!golf.course.trim() || !parsComplete(golf)) return rounds;
  const memo: CourseMemo = { name: golf.course.trim(), holes: golf.holes, par: golf.par.slice(0, 18), ...(golf.si ? { si: golf.si.slice(0, 18) } : {}) };
  return { ...rounds, meta: { ...(rounds.meta ?? {}), [BOOK + courseKey(golf.course)]: JSON.stringify(memo) } };
}

/** A round on a remembered course comes in with its pars and stroke index. */
export function applyCourse(golf: GolfInfo, memo: CourseMemo | null): GolfInfo {
  if (!memo) return golf;
  return { ...golf, par: memo.par.slice(0, 18), ...(memo.si ? { si: memo.si.slice(0, 18) } : {}) };
}

/** Is the round finished by the person: kept as a finished card. */
export const isFinished = (g: GolfInfo): boolean => typeof g.finishedAt === "number";

