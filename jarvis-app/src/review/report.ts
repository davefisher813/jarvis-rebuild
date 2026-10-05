import type { MonthSealData } from "./seal";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { Workout } from "../gym/types";
import { lineCase } from "../shared/casing";
import { formatMoney } from "../money/types";
import { RUNG_AT } from "../messages/mailAction";
import { hoursRows, hoursLabel } from "./hours";
import { stillTrueGoals } from "./stillTrue";

// THE MONTHLY REPORT'S MODEL (2026-08-25). Pure functions from a sealed
// month (plus its predecessor, plus the Store's own dated series) to the
// cards the page renders. The laws of this surface, from the approved
// catalog: reassurance leads; no score, rank, or comparison to another
// human; every sentence must be capable of being false and carries its
// receipts; setbacks never get a win's visual weight; exactly one proposed
// change; nothing counted that the app decided not to count; it ends in a
// setting, not a feeling. Every gate errs toward silence.
//
// AMENDED 2026-09-26 (pass-off): every title and sub line here is Title
// Case through lineCase() (the whole casing rule), a sub line is a list of
// FACTS the page draws as one .facts line (one grey, one key colour, the
// dot drawn by CSS: §AK, §AM F2/F3), a sentence-length note is a footer
// under its card rather than a caps line under a title, and the report
// carries Money, Mail, People, Health and Decisions from the seal's v4
// numbers. Each of those cards has an EXIT (Open Money, Check In...) and
// never a proposed rule: One Change stays the only proposed change.

// A win is done, achieved or paid, so every win wears the key's green (§AM);
// it used to carry a slot index that picked green, blue, purple or amber by
// position alone.
export interface ReportWin { name: string; value: string }
export interface ReportTile {
  num: string;
  label: string;
  // Done is green (done). Every other tile is a count with no state, so its
  // number is white (§AM): blue meant nothing, sky is kept for an estimate
  // the app worked out, and amber for what needs him soon.
  tint: "good" | "plain";
  delta: { text: string; up: boolean } | null;
}
export interface ReportSegment { id: string; name: string; color: string; n: number }
// WHERE THE HOURS WENT (handoff item 13, Dave's option A: one more section of
// the report you already get). A row per area, plus the areas a live goal
// reaches into that got no scheduled time at all. Facts, in both directions,
// with no target between them: the report says where the hours went and what
// had none, and never which of those is the right answer.
export interface TimeRow { id: string; name: string; color: string; label: string; pct: number;
  // C-65 (Astra, 2026-09-12): "26% Vs Usual 35%", beside the hours, only
  // inside a report and only when the share moved against last month.
  vs?: string;
}
export interface TimeSection {
  rows: TimeRow[];
  /** Total scheduled time, already formatted. */
  total: string;
  /** Live-goal areas with nothing on the calendar. Named, never scored. */
  quiet: { id: string; name: string }[];
}
export interface CarriedTask { id: string; text: string; n: number }

// ONE FACT ON A SUB LINE (2026-09-26). The page draws a list of these as one
// .facts line: the words grey, a count white (`parts`, the §AM F1 <b>), and
// at most one fact wearing a key colour. `text` is the same words joined,
// for the receipts sheet and the tests.
export type FactPart = string | { b: string };
export interface ReportFact { text: string; tone?: "good" | "warn" | "red"; parts?: FactPart[] }

/** A fact's words with every count split out as a part of its own, so the
 *  page can draw the counts white and leave the words grey. */
export function boldCounts(text: string): FactPart[] {
  // A percent belongs to its number ("78%" is one white count, never "78" and a stranded "%").
  return text.split(/(\d[\d,.]*%?)/).filter((s) => s.length > 0).map((s) => (/^\d[\d,.]*%?$/.test(s) ? { b: s } : s));
}
/** A grey fact whose counts are white. */
const plain = (text: string): ReportFact => ({ text, parts: boldCounts(text) });

export interface WorthCard {
  id: "carried" | "quiet" | "cut" | "stillTrue";
  title: string;
  sub: ReportFact[] | null;
  /** A sentence-length note, drawn under the card as a field note (the
   *  group-footer pattern), never as a caps line under the title. */
  foot?: string;
  carried?: CarriedTask[];
  receipts: string[];
}
// A pattern is a title and its one facts line. It never carries a pill: a count or a rate is a fact on the line under the
// title (Dave 2026-10-05, locked: no pills inside a row), and a rise is the line's one green fact.
export interface PatternRow {
  id: string;
  title: string;
  sub: ReportFact[] | null;
  receipts: string[];
}
// THE LIFE CARDS (2026-09-26). Money, Mail, People, Health and Decisions,
// each one title, one facts line, and an exit: a door to the place the
// numbers came from, never a rule proposed. The report may propose exactly
// one change and that is One Change below.
export type ExitKind = "money" | "email" | "person" | "health" | "decisions";
export interface LifeCard {
  id: "money" | "mail" | "people" | "health" | "decisions";
  title: string;
  facts: ReportFact[];
  exit: { label: string; kind: ExitKind; id?: string };
  receipts: string[];
}
export interface ReportCloser {
  n: number;
  question: string;
  sub: string;
  foot: string;
}
export interface MonthReport {
  month: string;
  monthName: string;
  hero: { big: string; label: string; anchor: string | null; wins: ReportWin[] };
  tiles: ReportTile[];
  hours: { label: string; byHour: number[]; bandStart: number } | null;
  went: ReportSegment[] | null;
  /** WHERE THE HOURS WENT (item 13). Null below the floor, or on any seal
   *  written before this shipped. */
  time: TimeSection | null;
  worth: WorthCard[];
  patterns: PatternRow[];
  /** The life cards, in a fixed order; absent on a seal without the
   *  numbers, and silent below each card's floor. */
  life: LifeCard[];
  learned: { title: string; sub: ReportFact[] | null; receipts: string[] } | null;
  did: { title: string; sub: ReportFact[] | null; receipts: string[] } | null;
  closer: ReportCloser | null;
  sealed: { title: string; sub: string };
}

export interface ReportInputs {
  seal: MonthSealData;
  prev: MonthSealData | null;
  categories: { id: string; name: string; color: string }[];
  goals: Goal[];
  projects: Project[];
  workouts: Workout[];
  /** Open tasks by id, for resolving the carried list. */
  openTaskText: (id: string) => string | null;
  /** True when a chosen plan cap is already set; the closer stays quiet. */
  alreadyCapped: boolean;
  /** The live people list, for resolving the seal's quiet ids to names. A
   *  person no longer in it is dropped without a word. Optional. */
  people?: { id: string; name: string }[];
  /** The health area's category id, for the Health card's exit. Optional:
   *  without it the card still renders and its exit is the health page by
   *  kind alone. */
  healthCategoryId?: string | null;
  /** The month is still being lived (the So Far page). A comparison of a month in progress with a whole one is a
   *  number that is only going to shrink the page's mood ("-77 Vs September" on the 5th), so no tile carries a delta. */
  stillOpen?: boolean;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}
function nextMonthName(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH_NAMES[m % 12] ?? month;
}
function hour12(h: number): string {
  const ap = h % 24 < 12 ? "AM" : "PM";
  const x = h % 12 || 12;
  return `${x} ${ap}`;
}
function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(y, m, 0).getDate();
}
const MINUS = "−";
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A tile's delta. Up wears good; down is a muted fact, never a red one; and it always says what it is against, because
 *  "-25" with nothing beside it is a number nobody can read (Dave 2026-10-05, the review). No change says nothing: a row
 *  with nothing to say shows nothing, so "Same" is not drawn. */
export function deltaOf(now: number, prev: number | null, vs: string | null): { text: string; up: boolean } | null {
  if (prev == null) return null;
  const d = now - prev;
  if (d === 0) return null;
  if (d > 0) return { text: vs ? lineCase(`+${d} vs ${vs}`) : `+${d}`, up: true };
  return { text: vs ? lineCase(`${MINUS}${Math.abs(d)} vs ${vs}`) : `${MINUS}${Math.abs(d)}`, up: false };
}

/** Goals achieved and projects closed inside the month, by their stamps. */
export function movedIn(month: string, goals: Goal[], projects: Project[]): { name: string; kind: "goal" | "project" }[] {
  const out: { name: string; kind: "goal" | "project" }[] = [];
  for (const g of goals) if (g.data.achievedOn?.startsWith(month)) out.push({ name: g.data.title, kind: "goal" });
  for (const p of projects) if (p.data.closedOn?.startsWith(month)) out.push({ name: p.data.title, kind: "project" });
  return out;
}

// BRAIN-F-19 (2026-09-05): bestWeek lived here with no caller and no test,
// and keyed its weeks off toISOString, which is the UTC-day bug this codebase
// bans. Nothing rendered a "best week", so it went rather than got fixed.

// ---- pattern gates -------------------------------------------------------

const PICK_MIN_OUTCOMES = 10;
const PICK_FIRST_RATE = 0.55;
const PICK_LATE_RATE = 0.4;
const PICK_LATE_MIN = 4;
const OVERRUN_MIN_BLOCKS = 6;
const OVERRUN_MIN_AVG = 10;
const JOIN_MIN_DAYS = 3;
const MIRROR_MIN = 6;
const QUIET_MIN_PREV = 6;

export interface PickFacts {
  firstRate: number;
  lateRate: number;
  firstDone: number;
  firstPicked: number;
  latePicked: number;
  outcomes: number;
}

export function pickFacts(byPick: MonthSealData["byPick"]): PickFacts | null {
  const first = byPick.find((b) => b.n === 1);
  const late = byPick.filter((b) => b.n >= 4);
  const latePicked = late.reduce((a, b) => a + b.picked, 0);
  const lateDone = late.reduce((a, b) => a + b.done, 0);
  const outcomes = byPick.reduce((a, b) => a + b.picked, 0);
  if (!first || first.picked === 0 || outcomes < PICK_MIN_OUTCOMES) return null;
  return {
    firstRate: first.done / first.picked,
    lateRate: latePicked > 0 ? lateDone / latePicked : 0,
    firstDone: first.done,
    firstPicked: first.picked,
    latePicked,
    outcomes,
  };
}

/** Done-per-day on training days versus the rest. Null until both sides
 *  have enough days to mean anything. */
export function trainJoin(doneByDay: Record<string, number>, workouts: Workout[], month: string): { on: number; off: number } | null {
  const trained = new Set(workouts.filter((w) => w.data.date.startsWith(month)).map((w) => w.data.date));
  let onSum = 0, onDays = 0, offSum = 0, offDays = 0;
  const days = new Set([...Object.keys(doneByDay), ...trained]);
  for (const day of days) {
    const n = doneByDay[day] ?? 0;
    if (trained.has(day)) { onSum += n; onDays++; }
    else { offSum += n; offDays++; }
  }
  if (onDays < JOIN_MIN_DAYS || offDays < JOIN_MIN_DAYS) return null;
  return { on: onSum / onDays, off: offSum / offDays };
}

// ---- the life cards ------------------------------------------------------

/** The wait's tone follows the mail rail's one ladder (mailAction.toneFor):
 *  firm is red, direct amber, and a gentle wait is not a fact this card
 *  needs to say. */
export function waitFact(days: number): ReportFact | null {
  if (days < RUNG_AT.direct) return null;
  return { text: lineCase(`Waiting ${days} days on a reply`), tone: days >= RUNG_AT.switch ? "red" : "warn" };
}

/** Money, Mail, People, Health and Decisions, each silent below its floor.
 *  Exported so the week card can carry the same lines at week scale. */
export function lifeCards(seal: MonthSealData, name: string, people: { id: string; name: string }[], healthCategoryId: string | null | undefined): LifeCard[] {
  const out: LifeCard[] = [];
  const b = seal.bills;
  if (b && (b.paid > 0 || b.open > 0)) {
    const facts: ReportFact[] = [];
    if (b.paid > 0) facts.push({ text: formatMoney(b.total), tone: "good" });
    // With nothing paid the title already says still due; the line does
    // not say it twice.
    if (b.open > 0 && b.paid > 0) facts.push(plain(lineCase(`${b.open} still due`)));
    out.push({
      id: "money",
      title: b.paid > 0 ? lineCase(`Paid ${b.paid} ${plural(b.paid, "bill", "bills")}`) : lineCase(`${b.open} ${plural(b.open, "bill", "bills")} still due`),
      facts,
      exit: { label: "Open Money", kind: "money" },
      receipts: [
        ...(b.paid > 0 ? [lineCase(`${b.paid} ${plural(b.paid, "bill", "bills")} paid in ${name}, ${formatMoney(b.total)} in all`)] : []),
        b.open > 0 ? lineCase(`${b.open} dated in ${name} and not yet paid`) : lineCase(`Nothing dated in ${name} left to pay`),
        "Only the Bills the App Holds; Never a Claim About the Account",
      ],
    });
  }
  const m = seal.mail;
  const wait = m ? waitFact(m.waitDays) : null;
  if (m && (m.handled > 0 || wait)) {
    const facts: ReportFact[] = [];
    if (wait) facts.push(wait);
    if (seal.deck.sent > 0) {
      const drafts = lineCase(`${seal.deck.asWritten} of ${seal.deck.sent} drafts unedited`);
      // As written is done, so it is green: unless the wait already spent
      // the line's one colour, in which case it is the line's grey.
      facts.push(wait ? plain(drafts) : { text: drafts, tone: "good" });
    }
    out.push({
      id: "mail",
      title: m.handled > 0 ? lineCase(`Handled ${m.handled} ${plural(m.handled, "email", "emails")}`) : "Mail",
      facts,
      exit: { label: "Open Email", kind: "email" },
      receipts: [
        lineCase(`${m.handled} handled in ${name}`),
        ...(seal.deck.sent > 0 ? [lineCase(`${seal.deck.asWritten} of ${seal.deck.sent} drafts went out as written`)] : []),
        ...(wait ? [lineCase(`The longest wait for a reply is ${m.waitDays} days`)] : []),
      ],
    });
  }
  const p = seal.people;
  if (p) {
    const quiet = p.quiet.map((id) => people.find((x) => x.id === id)).filter((x): x is { id: string; name: string } => !!x);
    if (p.reached > 0 || quiet.length > 0) {
      const names = quiet.map((q) => q.name).join(", ");
      const facts: ReportFact[] = [];
      if (quiet.length > 0 && p.reached > 0) facts.push({ text: `Gone Quiet: ${names}`, tone: "warn" });
      if (quiet.length > 1 && p.reached === 0) facts.push({ text: `Gone Quiet: ${quiet.slice(1).map((q) => q.name).join(", ")}`, tone: "warn" });
      out.push({
        id: "people",
        title: p.reached > 0 ? lineCase(`Reached ${p.reached} ${plural(p.reached, "person", "people")}`) : lineCase(`${quiet[0]!.name} went quiet`),
        facts,
        exit: quiet.length > 0 ? { label: "Check In", kind: "person", id: quiet[0]!.id } : { label: "Open People", kind: "person" },
        receipts: [
          lineCase(`${p.reached} ${plural(p.reached, "call, message or check-in", "calls, messages and check-ins")} in ${name}`),
          ...quiet.map((q) => `No Word Either Way with ${q.name} in 30 Days`),
          "A Quiet Month Can Be on Purpose",
        ],
      });
    }
  }
  const t = seal.training;
  if (t && seal.sessions > 0) {
    const facts: ReportFact[] = [];
    if (t.prs > 0) facts.push({ text: `${t.prs} ${plural(t.prs, "PR", "PRs")}`, tone: "good" });
    if (t.sets > 0) facts.push(plain(lineCase(`${t.sets} working ${plural(t.sets, "set", "sets")}`)));
    out.push({
      id: "health",
      title: lineCase(`${seal.sessions} ${plural(seal.sessions, "session", "sessions")}`),
      facts,
      exit: { label: "Open Health Insights", kind: "health", ...(healthCategoryId ? { id: healthCategoryId } : {}) },
      receipts: [
        lineCase(`${seal.sessions} ${plural(seal.sessions, "session", "sessions")} logged in ${name}`),
        lineCase(`${t.sets} working ${plural(t.sets, "set", "sets")}; warm-ups and drops are not counted`),
        ...(t.prs > 0 ? [lineCase(`${t.prs} ${plural(t.prs, "lift", "lifts")} set a personal best`)] : []),
      ],
    });
  }
  const d = seal.decisions;
  if (d && (d.made > 0 || d.revisited > 0)) {
    const facts: ReportFact[] = [];
    if (d.worked > 0) facts.push({ text: lineCase(`${d.worked} worked`), tone: "good" });
    if (d.revisited > 0) facts.push(plain(lineCase(`${d.revisited} revisited`)));
    out.push({
      id: "decisions",
      title: d.made > 0 ? lineCase(`Made ${d.made} ${plural(d.made, "decision", "decisions")}`) : lineCase(`Revisited ${d.revisited} ${plural(d.revisited, "decision", "decisions")}`),
      facts,
      exit: { label: "Open Decisions", kind: "decisions" },
      receipts: [
        lineCase(`${d.made} recorded in ${name}`),
        ...(d.revisited > 0 ? [lineCase(`${d.revisited} revisited and still good`)] : []),
        ...(d.worked > 0 ? [lineCase(`${d.worked} marked worked`)] : []),
        "A Decision Is Kept, Not Judged",
      ],
    });
  }
  return out;
}

// ---- the report ----------------------------------------------------------

export function buildReport(inp: ReportInputs): MonthReport {
  const { seal, prev } = inp;
  const month = seal.month;
  const name = monthName(month);
  const prevName = prev ? monthName(prev.month) : null;
  const catById = new Map(inp.categories.map((c) => [c.id, c] as const));

  // HERO. Named crossings lead; a month with none leads with its done count,
  // which is still true and still yours. Anchor is your own last month only.
  const moved = movedIn(month, inp.goals, inp.projects);
  const wins: ReportWin[] = moved.slice(0, 3).map((m) => ({
    name: m.name,
    // The tile is already green, so the word is all it says (a typed check is a glyph in a string: Dave 2026-10-05).
    // A project's closedOn is only ever written when its status becomes done (ProjectsService), so a closed project IS a done one and
    // wears the done green. Its word says so: "Closed" read as cut or shelved on a green tile (round 3 review).
    value: m.kind === "goal" ? "Achieved" : "Done",
  }));
  if (seal.saved > 0 && wins.length < 4) {
    wins.push({ name: "Put Away", value: `$${seal.saved.toLocaleString()}` });
  }
  const movedCount = moved.length + (seal.saved > 0 ? 1 : 0);
  const prevMoved = prev ? movedIn(prev.month, inp.goals, inp.projects).length + (prev.saved > 0 ? 1 : 0) : null;
  const hero = movedCount > 0
    ? {
        big: String(movedCount),
        label: movedCount === 1 ? "Thing Moved" : "Things Moved",
        anchor: prev && prevMoved != null ? lineCase(`${prevMoved} in ${prevName}`) : null,
        wins,
      }
    : {
        big: String(seal.done),
        label: seal.done === 1 ? "Thing Done" : "Things Done",
        anchor: prev ? lineCase(`${prev.done} in ${prevName}`) : null,
        wins: [],
      };

  // TILES. Zeros never render; deltas only against a real predecessor, and never on a month still being lived. When the
  // hero already leads with the done count, a Done tile would say the same number twice, so it is not drawn.
  const vsName = inp.stillOpen ? null : prevName;
  const dl = (now: number, was: number | null | undefined) => (inp.stillOpen ? null : deltaOf(now, was ?? null, vsName));
  const tiles: ReportTile[] = [];
  if (seal.done > 0 && movedCount > 0) tiles.push({ num: String(seal.done), label: "Done", tint: "good", delta: dl(seal.done, prev?.done) });
  if (seal.sessions > 0) tiles.push({ num: String(seal.sessions), label: seal.sessions === 1 ? "Session" : "Sessions", tint: "plain", delta: dl(seal.sessions, prev?.sessions) });
  if (seal.daysIn > 0) tiles.push({ num: `${seal.daysIn}/${daysInMonth(month)}`, label: "Days Checked In", tint: "plain", delta: dl(seal.daysIn, prev?.daysIn) });
  if (seal.deposits > 0) tiles.push({ num: String(seal.deposits), label: seal.deposits === 1 ? "Deposit" : "Deposits", tint: "plain", delta: dl(seal.deposits, prev?.deposits) });

  const hours = seal.bandStart != null
    ? { label: `${hour12(seal.bandStart)} to ${hour12(seal.bandStart + 3)}`, byHour: seal.byHour, bandStart: seal.bandStart }
    : null;

  const segments = Object.entries(seal.byCategory)
    .map(([id, n]) => ({ id, n, cat: catById.get(id) }))
    .filter((s) => !!s.cat)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((s) => ({ id: s.id, name: s.cat!.name, color: s.cat!.color, n: s.n }));
  const went = segments.length >= 2 ? segments : null;

  // WHERE THE HOURS WENT (item 13). Calendar-mined, entirely passive, and
  // silent below the floor. The uncategorised bucket ("" ) is rendered as
  // "Everything Else" rather than dropped, so the percentages the reader adds
  // up in their head actually reach a hundred.
  const timeRows = hoursRows(seal.hours ?? {});
  // C-65: last month's shares, for the one percent a report may say.
  const prevRows = prev?.hours ? hoursRows(prev.hours) : [];
  const time: TimeSection | null = timeRows.length === 0 ? null : {
    rows: timeRows.map((r) => {
      const cat = r.category ? catById.get(r.category) : undefined;
      const was = prevRows.find((p) => p.category === r.category);
      const vs = was && Math.abs(r.pct - was.pct) >= 5 ? lineCase(`${r.pct}% vs usual ${was.pct}%`) : undefined;
      return {
        id: r.category,
        name: cat?.name ?? "Everything Else",
        color: cat?.color ?? "graphite",
        label: hoursLabel(r.minutes),
        pct: r.pct,
        ...(vs ? { vs } : {}),
      };
    }),
    total: hoursLabel(timeRows.reduce((a, r) => a + r.minutes, 0)),
    // Only areas that still exist and still have a name. A goal tagged with a
    // deleted category is not a fact worth reporting.
    quiet: (seal.goalAreasUnscheduled ?? [])
      .map((id) => ({ id, name: catById.get(id)?.name ?? "" }))
      .filter((q) => !!q.name)
      .slice(0, 3),
  };

  // WORTH A LOOK. Every card that names a gap keeps an exit, and the copy
  // states facts about work, never verdicts about the person.
  const worth: WorthCard[] = [];
  const carried = seal.carried
    .map((c) => ({ id: c.id, n: c.n, text: inp.openTaskText(c.id) }))
    .filter((c): c is { id: string; n: number; text: string } => c.text != null)
    .map((c) => ({ id: c.id, text: c.text, n: c.n }));
  if (carried.length > 0) {
    worth.push({
      id: "carried",
      title: lineCase(`${carried.length} ${plural(carried.length, "task", "tasks")} followed you all month`),
      sub: null,
      carried,
      receipts: carried.map((c) => lineCase(`${c.text}, ${c.n} Pushes`)),
    });
  }
  if (prev) {
    const quiet = Object.entries(prev.byCategory)
      .map(([id, was]) => ({ id, was, now: seal.byCategory[id] ?? 0, cat: catById.get(id) }))
      .filter((q) => !!q.cat && q.was >= QUIET_MIN_PREV && q.now <= q.was / 3)
      .sort((a, b) => (b.was - b.now) - (a.was - a.now))[0];
    if (quiet) {
      worth.push({
        id: "quiet",
        title: lineCase(`${quiet.cat!.name} went quiet`),
        // Stalled is amber (§AM): the count first, then last month's in the
        // line's one grey with its count white.
        sub: [{ text: lineCase(`${quiet.now} this month`), tone: "warn" }, plain(lineCase(`${quiet.was} in ${prevName}`))],
        receipts: [lineCase(`${quiet.was} finishes in ${prevName}, ${quiet.now} in ${name}`), "A Quiet Month Can Be on Purpose", "Leave It Means Exactly That"],
      });
    }
  }
  // "STILL TRUE?" (handoff item 10, the remnant Dave kept). Only ever asked
  // about a goal that WAS moving last month and moved in no way at all this
  // one; see stillTrue.ts for why that standard, and not "no activity", is
  // the only one that makes this a question rather than a nag. It changes
  // nothing on its own: cutting a goal is a decision with a record, and that
  // path is elsewhere.
  const still = stillTrueGoals(seal, prev, inp.goals);
  if (still.length > 0) {
    // The question sits on the goal's own row as its facts (Dave 2026-10-05, the review: an italic line under the card
    // saying "Nothing Finished and Nothing Scheduled This Month" read as a verdict on the whole page, and the title
    // "...: Still True?" left "True?" alone on a line). The goal is the title; the question is the amber fact; last
    // month's count is the line's one grey.
    worth.push({
      id: "stillTrue",
      title: still.length === 1 ? lineCase(still[0]!.title) : lineCase(`${still.length} Goals Went Still`),
      sub: still.length === 1
        ? [{ text: "Still True?", tone: "warn" }, plain(lineCase(`${still[0]!.wasDone} finished in ${prevName}`))]
        : [{ text: "Still True?", tone: "warn" }],
      receipts: [
        ...still.map((g) => lineCase(`${g.title}: ${g.wasDone} finished in ${prevName}, none in ${name}`)),
        "A Month Off a Goal Is Not the Same as Dropping It",
        "Yes Is a Complete Answer",
      ],
    });
  }

  const cut = inp.goals.filter((g) => g.data.dropped?.on.startsWith(month));
  if (cut.length > 0) {
    worth.push({
      id: "cut",
      title: lineCase(`${cut.length} ${plural(cut.length, "goal", "goals")} cut`),
      sub: null,
      foot: "Cutting Is a Decision, and It Counts",
      receipts: cut.map((g) => lineCase(g.data.title)),
    });
  }

  // PATTERNS. One line, one number, receipts behind the tap.
  const patterns: PatternRow[] = [];
  const picks = pickFacts(seal.byPick);
  if (picks && picks.firstRate >= PICK_FIRST_RATE && picks.latePicked >= PICK_LATE_MIN && picks.lateRate <= PICK_LATE_RATE) {
    patterns.push({
      id: "picks",
      title: "First Picks Finish",
      // Two facts, the dot between them drawn by the stylesheet (a typed comma is a punctuation mark in a string: round 3 review).
      sub: [plain(lineCase(`Firsts ${Math.round(picks.firstRate * 100)}%`)), plain(lineCase(`Later picks ${Math.round(picks.lateRate * 100)}%`))],
      receipts: [
        lineCase(`${picks.firstDone} of ${picks.firstPicked} first picks done that day`),
        lineCase(`${picks.latePicked} picks landed fourth or later`),
      ],
    });
  }
  const overrun = Object.entries(seal.overrunByCategory)
    .map(([id, o]) => ({ id, avg: o.min / o.n, n: o.n, cat: catById.get(id) }))
    .filter((o) => !!o.cat && o.n >= OVERRUN_MIN_BLOCKS && Math.abs(o.avg) >= OVERRUN_MIN_AVG)
    .sort((a, b) => Math.abs(b.avg) - Math.abs(a.avg))[0];
  if (overrun) {
    const mins = Math.round(Math.abs(overrun.avg));
    patterns.push({
      id: "overrun",
      title: lineCase(`${overrun.cat!.name} runs ${hoursLabel(mins)} ${overrun.avg > 0 ? "over" : "under"}`),
      sub: [plain(lineCase(`Across ${overrun.n} Corrections`))],
      receipts: ["Plan Lengths Already Learn from This; New Blocks Pre-Fill from Your History"],
    });
  }
  const join = trainJoin(seal.doneByDay, inp.workouts, month);
  if (join && join.on > join.off * 1.3 && join.on - join.off >= 1) {
    const pct = Math.round(((join.on - join.off) / Math.max(0.1, join.off)) * 100);
    patterns.push({
      id: "train",
      title: "Train Days Win",
      // The rise is the line's one green fact, drawn beside the two rates (no pill: Dave 2026-10-05, locked).
      // Each rate names its days, so no "vs" is needed and none can differ in casing from the tiles' "Vs". Short enough that
      // all three facts fit one line at 390px (the longer "Done on Train Days" ellipsized both).
      sub: [plain(lineCase(`${join.on.toFixed(1)} train days`)), plain(lineCase(`${join.off.toFixed(1)} other days`)), { text: `+${pct}%`, tone: "good" }],
      receipts: ["A Pattern in Your Data, Not a Cause"],
    });
  }
  const mirror = Object.entries(seal.suggestions)
    .map(([kind, v]) => ({ kind, ...v, total: v.acc + v.dis }))
    .filter((m) => m.total >= MIRROR_MIN);
  const taken = mirror.filter((m) => m.acc / m.total >= 0.7).sort((a, b) => b.total - a.total)[0];
  const skipped = mirror.filter((m) => m.acc / m.total <= 0.25).sort((a, b) => b.total - a.total)[0];
  const KIND_TAKEN: Record<string, string> = { first_step: "You Take First Steps", pattern: "You Take the Patterns", ai: "You Take the AI's Offers", routine: "You Take the Routine Blocks", proj_step: "You Take Project Steps", link: "You Take the Links" };
  const KIND_SKIP: Record<string, string> = { link: "Links Get Skipped", ai: "AI Offers Get Skipped", pattern: "Patterns Get Skipped", first_step: "First Steps Get Skipped", routine: "Routine Blocks Get Skipped", proj_step: "Project Steps Get Skipped" };
  if (taken) {
    patterns.push({
      id: "mirror-taken",
      title: KIND_TAKEN[taken.kind] ?? "You Take the Suggestions",
      sub: [plain(lineCase(`${taken.acc} of ${taken.total} accepted`))],
      receipts: [lineCase(`${taken.acc} accepted, ${taken.dis} dismissed`)],
    });
  }
  if (skipped) {
    patterns.push({
      id: "mirror-skipped",
      title: KIND_SKIP[skipped.kind] ?? "Some Suggestions Get Skipped",
      sub: [plain(lineCase(`${skipped.acc} of ${skipped.total} taken`))],
      receipts: [lineCase(`${skipped.dis} dismissed this month`)],
    });
  }
  if (seal.slip) {
    const cat = catById.get(seal.slip.category);
    if (cat) {
      patterns.push({
        id: "slip",
        title: lineCase(`${cat.name} slips most`),
        // The count is the row's one fact, in the one grey with its number white. Nothing here is due, so no amber.
        sub: [plain(lineCase(`${seal.slip.n} Pushes`))],
        receipts: [lineCase(`${seal.slip.n} Pushes in ${name}, the most of any category`), "A Fact About Tasks, Never a Verdict"],
      });
    }
  }

  // THE LIFE CARDS (2026-09-26): what the app already keeps, each with a
  // door out and nothing proposed.
  const life = lifeCards(seal, name, inp.people ?? [], inp.healthCategoryId);

  // JARVIS. The learned line's second half is the anti-horoscope device:
  // a system that shows its own retractions is one whose claims can be false.
  const fixes = seal.strands.corrected + seal.strands.deleted;
  const learned = seal.strands.created > 0
    ? {
        title: lineCase(`Learned ${seal.strands.created} ${plural(seal.strands.created, "thing", "things")} about you`),
        sub: fixes > 0 ? [plain(lineCase(`You fixed ${fixes}`)), plain("Gone for Good")] : null,
        // A row that is drawn as a door opens something (Dave 2026-10-05, the review: these two read as rows and did nothing).
        receipts: [
          lineCase(`${seal.strands.created} ${plural(seal.strands.created, "thing", "things")} learned in ${name}`),
          ...(fixes > 0 ? [lineCase(`${fixes} corrected or deleted by you, and gone for good`)] : []),
        ],
      }
    : null;
  const didCount = seal.remindersTicked + seal.deck.sent;
  const didParts: ReportFact[] = [];
  if (seal.remindersTicked > 0) didParts.push(plain(lineCase(`${seal.remindersTicked} ${plural(seal.remindersTicked, "reminder", "reminders")}`)));
  // As written is done, so the drafts fact is green (§AM); the reminders
  // count stays the line's one grey with its number white.
  if (seal.deck.sent > 0) didParts.push({ text: lineCase(`${seal.deck.asWritten} of ${seal.deck.sent} drafts unedited`), tone: "good" });
  const did = didCount > 0
    ? {
        title: lineCase(`Kept ${didCount} ${plural(didCount, "thing", "things")} moving`),
        sub: didParts.length ? didParts : null,
        receipts: [
          ...(seal.remindersTicked > 0 ? [lineCase(`${seal.remindersTicked} ${plural(seal.remindersTicked, "reminder", "reminders")} ticked off in ${name}`)] : []),
          ...(seal.deck.sent > 0 ? [lineCase(`${seal.deck.asWritten} of ${seal.deck.sent} drafts went out as written`)] : []),
        ],
      }
    : null;

  // THE ONE CHANGE. Exactly one, and only when the evidence carries it.
  const closer = !inp.alreadyCapped && picks && picks.firstRate >= 0.6 && picks.lateRate <= 0.35 && picks.latePicked >= PICK_LATE_MIN
    ? {
        n: 3,
        question: "Cap the Day at Three?",
        sub: "Your First Three Get Done, the Later Picks Mostly Do Not",
        foot: "Starting Tomorrow, Change It Any Time",
      }
    : null;

  return {
    month,
    monthName: name,
    hero,
    tiles,
    hours,
    went,
    time,
    worth,
    patterns,
    life,
    learned,
    did,
    closer,
    sealed: { title: `${name} Sealed`, sub: lineCase(`${nextMonthName(month)} compares to this`) },
  };
}
