// TEMPLATE PAGES (issue #115, slice 1). A template page is a NOTE with
// structure: the same engine item (entity "note"), the same list, search,
// pin, archive, area and trash, with one more field on its data, `page`.
// There is no second store. Everything here is pure: a function takes a page
// and returns the next one, so the flow can keep the one before it for Undo
// and the service writes the result in one update.
//
// THE SHAPE. A page holds RECORDS (a player, a contact, a lineup entry), each
// with an id that never changes, values keyed by FIELD keys that never
// change, and labels the person may rename freely. A field's key is what an
// export, a reimport and every snapshot read; its label is only what is
// drawn. That split is what lets "Number" become "Jersey" without a single
// record moving.
//
// Values are strings, the way a sheet cell is. jsonb_strip_nulls drops an
// object field set to null at every depth (core/patch.ts), so an empty value
// is the empty string or an absent key, never null.

import { TEMPLATE_NAMES, templateDef, type TemplateKey } from "./templateDefs";

export type PageKind = "scorecard" | "team" | "lineup" | "outreach" | TemplateKey;
/** check: a done mark the row leads with. money: a number drawn and totalled as dollars. */
export type FieldType = "text" | "number" | "date" | "choice" | "check" | "money";

export interface PageField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** Brought in from an import column this page had no field for. Kept, never dropped. */
  extra?: boolean;
}

export interface PageRecord {
  id: string;
  v: Record<string, string>;
  /** Values the import was not sure of, by field key, with the reason. Shown until confirmed or corrected. */
  flags?: Record<string, string>;
  /** The values as of the last export or import: the common ancestor a reimport compares against. */
  base?: Record<string, string>;
  /** A task made from this record on purpose (Outreach's Make a Task). Never made by accepting a field. */
  taskId?: string;
  /** The section this row sits in (a key from the page's `sections`). Absent: it sits above every section. */
  sec?: string;
  /** A sensitive record's last confirmation, as an ISO day. Only ever set by the person's own tap. */
  confirmedOn?: string;
  /** The app record this row points at, by id, when one does (a Debt Payoff row's Money account). A pointer, never a copy. */
  link?: string;
}

/** A heading the page's rows are grouped under, named and ordered by the person. Every section is drawn on the page, rows or
 *  none, with its own Add (2026-10-16); an export walks only the ones with rows. */
export interface PageSection { key: string; label: string }

/** One played game on a standings page: two teams (their record ids), the date and the score. Standings are worked out from these. */
export interface GameRow { id: string; date: string; a: string; b: string; sa: number; sb: number }

/** A scoreboard's game: which sport, how it is scored, and what its columns are called. */
export interface ScoreInfo {
  sport: string;
  /** The sport's name as drawn ("Table Tennis"). */
  label: string;
  /** periods: columns added up. target: one running score to a target. bowling: ten frames. countdown: down from a start. */
  mode: "periods" | "target" | "bowling" | "countdown";
  /** Columns in periods mode (quarters, innings, rounds). Always as many as the sport's own count; extra ones can be added. */
  periods: number;
  /** What a column is called, singular: Quarter, Inning, Set, Round. */
  unit: string;
  /** Who wins a periods game: the highest total, or whoever took the most columns (sets). */
  winBy: "total" | "periodsWon";
  /** Target mode: the score that ends it. Countdown mode: the number it starts from. */
  target?: number;
  date: string;
}

export interface GolfInfo {
  course: string;
  holes: 9 | 18;
  /** Par for all eighteen holes, always eighteen long, so a 9 to 18 change loses nothing. */
  par: number[];
  date: string;
}

export interface LineupInfo {
  teamId: string;
  teamTitle: string;
  date: string;
  /** When the lineup's own copy of names and numbers was taken from the roster. */
  takenAt: number;
}

export interface PageOriginal {
  at: number;
  name: string;
  mime: string;
  bytes: number;
  /** Where the file itself lives in the person's private storage. */
  path?: string;
  /** Pasted text has no file; it is kept here as typed. */
  text?: string;
  /** False until its rows have been brought into the page. Usable either way. */
  used: boolean;
}

export type SnapshotWhy = "import" | "reimport" | "export" | "manual" | "change" | "restore";

export interface PageSnapshot {
  at: number;
  why: SnapshotWhy;
  fields: PageField[];
  records: PageRecord[];
  sections?: PageSection[];
  golf?: GolfInfo;
  lineup?: LineupInfo;
  score?: ScoreInfo;
  meta?: Record<string, string>;
  games?: GameRow[];
}

export interface PageData {
  v: 1;
  kind: PageKind;
  fields: PageField[];
  records: PageRecord[];
  golf?: GolfInfo;
  lineup?: LineupInfo;
  score?: ScoreInfo;
  /** Headings the rows group under. An empty one is still drawn on the page, as structure with an Add of its own. */
  sections?: PageSection[];
  /** Games played, on a standings page. */
  games?: GameRow[];
  /** A page's own small settings (a pitching limit, a session's start time), by key. Text, like a sheet cell. */
  meta?: Record<string, string>;
  /** True on a page kept as the person's own template: structure only, no rows. It starts new pages of its kind. */
  mine?: boolean;
  originals?: PageOriginal[];
  snapshots?: PageSnapshot[];
}

export const KIND_NAME: Record<PageKind, string> = {
  scorecard: "Golf Scorecard",
  team: "Team Sheet",
  lineup: "Lineup Card",
  outreach: "Outreach Tracker",
  ...TEMPLATE_NAMES,
};

export const OUTREACH_CHANNELS = ["Email", "Phone", "Text", "In Person", "LinkedIn", "Other"];
export const OUTREACH_STATUS = ["To Contact", "Reached Out", "Replied", "Meeting Set", "Closed"];

export const SNAPSHOT_CAP = 20;

export function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return prefix + "_" + crypto.randomUUID().slice(0, 13).replace(/-/g, "");
  return prefix + "_" + Math.random().toString(36).slice(2, 13);
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ---------------------------------------------------------------------------
// The four templates, at their smallest useful size (the spec: smallest
// useful structure first, grown when an input says so).

export function teamFields(): PageField[] {
  return [
    { key: "name", label: "Name", type: "text" },
    { key: "number", label: "Number", type: "number" },
    { key: "position", label: "Position", type: "text" },
    { key: "contact", label: "Contact", type: "text" },
  ];
}

export function newTeamPage(): PageData {
  return { v: 1, kind: "team", fields: teamFields(), records: [] };
}

export function newOutreachPage(): PageData {
  return {
    v: 1,
    kind: "outreach",
    fields: [
      { key: "who", label: "Who", type: "text" },
      { key: "org", label: "Organization", type: "text" },
      { key: "channel", label: "Channel", type: "choice", options: OUTREACH_CHANNELS },
      { key: "status", label: "Status", type: "choice", options: OUTREACH_STATUS },
      { key: "last", label: "Last Contact", type: "date" },
      { key: "next", label: "Next Step", type: "text" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    records: [],
  };
}

export const holeKey = (h: number) => "h" + h;

export function scorecardFields(): PageField[] {
  return [{ key: "name", label: "Player", type: "text" }, ...Array.from({ length: 18 }, (_, i) => ({ key: holeKey(i + 1), label: String(i + 1), type: "number" as const }))];
}

/** A round, ready to score: no columns to arrange. Course and players are optional. */
export function newScorecardPage(opts: { course?: string; holes?: 9 | 18; players?: string[]; date: string }): PageData {
  const names = (opts.players ?? []).map((p) => p.trim()).filter(Boolean);
  const players = names.length ? names : ["Player 1"];
  return {
    v: 1,
    kind: "scorecard",
    fields: scorecardFields(),
    records: players.map((name) => ({ id: newId("r"), v: { name } })),
    golf: { course: (opts.course ?? "").trim(), holes: opts.holes ?? 18, par: Array.from({ length: 18 }, () => 4), date: opts.date },
  };
}

export function lineupFields(): PageField[] {
  return [
    { key: "name", label: "Player", type: "text" },
    { key: "number", label: "Number", type: "number" },
    { key: "position", label: "Position", type: "text" },
  ];
}

/** A lineup made FROM a team sheet: the players are picked, never retyped. Each entry keeps its own copy of the
 *  player's name and number, so a later roster edit cannot rewrite a lineup that was already used. */
export function newLineupPage(team: { id: string; title: string; page: PageData }, picks: { playerId: string; position?: string }[], date: string, now: number): PageData {
  const byId = new Map(team.page.records.map((r) => [r.id, r]));
  const records: PageRecord[] = [];
  for (const p of picks) {
    const r = byId.get(p.playerId);
    if (!r) continue;
    records.push({ id: newId("r"), v: { player: r.id, name: r.v.name ?? "", number: r.v.number ?? "", position: (p.position ?? r.v.position ?? "").trim() } });
  }
  return { v: 1, kind: "lineup", fields: lineupFields(), records, lineup: { teamId: team.id, teamTitle: team.title, date, takenAt: now } };
}

// ---------------------------------------------------------------------------
// Editing. Labels are free; values clear their own uncertainty when edited.

export function fieldOf(page: PageData, key: string): PageField | undefined {
  return page.fields.find((f) => f.key === key);
}

export function labelOf(page: PageData, key: string): string {
  return fieldOf(page, key)?.label ?? key;
}

export function addRecord(page: PageData, values: Record<string, string> = {}): { page: PageData; id: string } {
  const id = newId("r");
  return { page: { ...page, records: [...page.records, { id, v: cleanValues(values) }] }, id };
}

function cleanValues(v: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
}

export function setValues(page: PageData, recordId: string, patch: Record<string, string>): PageData {
  return {
    ...page,
    records: page.records.map((r) => {
      if (r.id !== recordId) return r;
      const v = { ...r.v, ...cleanValues(patch) };
      const flags = r.flags ? { ...r.flags } : undefined;
      if (flags) for (const k of Object.keys(patch)) delete flags[k];
      const next: PageRecord = { ...r, v };
      if (flags && Object.keys(flags).length) next.flags = flags;
      else delete next.flags;
      return next;
    }),
  };
}

/** The person looked at an uncertain value and kept it as it is. */
export function confirmValue(page: PageData, recordId: string, key: string): PageData {
  return setValues(page, recordId, { [key]: page.records.find((r) => r.id === recordId)?.v[key] ?? "" });
}

export function removeRecord(page: PageData, recordId: string): PageData {
  return { ...page, records: page.records.filter((r) => r.id !== recordId) };
}

export function moveRecord(page: PageData, recordId: string, by: -1 | 1): PageData {
  const i = page.records.findIndex((r) => r.id === recordId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= page.records.length) return page;
  const records = page.records.slice();
  [records[i], records[j]] = [records[j]!, records[i]!];
  return { ...page, records };
}

export function renameField(page: PageData, key: string, label: string): PageData {
  const clean = label.replace(/\s+/g, " ").trim();
  if (!clean) return page;
  return { ...page, fields: page.fields.map((f) => (f.key === key ? { ...f, label: clean } : f)) };
}

export function addField(page: PageData, label: string, type: FieldType = "text"): { page: PageData; key: string } {
  const key = newId("f");
  const clean = label.replace(/\s+/g, " ").trim() || "New Field";
  return { page: { ...page, fields: [...page.fields, { key, label: clean, type }] }, key };
}

/** What removing a field would cost, said before it happens. */
export function fieldImpact(page: PageData, key: string): number {
  return page.records.filter((r) => (r.v[key] ?? "").trim() !== "").length;
}

/** Removes a field. The page is snapshotted first, so the values it held are still there to see. */
export function removeField(page: PageData, key: string, now: number): PageData {
  const kept = takeSnapshot(page, "change", now);
  return {
    ...kept,
    fields: kept.fields.filter((f) => f.key !== key),
    records: kept.records.map((r) => {
      const v = { ...r.v };
      delete v[key];
      return { ...r, v };
    }),
  };
}

/** Fields the person sees and edits on a record (the scorecard's hole fields are scored on the hole screen). */
export function editableFields(page: PageData): PageField[] {
  if (page.kind === "scorecard" || page.kind === "scoreboard" || page.kind === "standings") return page.fields.filter((f) => f.key === "name");
  if (page.kind === "lineup") return page.fields.filter((f) => f.key !== "player");
  return page.fields;
}

/** The record's name as drawn: its first text field with words in it. */
export function recordName(page: PageData, r: PageRecord): string {
  const def = templateDef(page.kind);
  const key = def ? def.headline : page.kind === "outreach" ? (r.v.who?.trim() ? "who" : "org") : "name";
  return (r.v[key] ?? "").trim();
}

// ---------------------------------------------------------------------------
// Golf, stroke play.

export function scoreOf(r: PageRecord, hole: number): number | null {
  const s = (r.v[holeKey(hole)] ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface GolfTotals { thru: number; out: number; in: number; total: number; toPar: number; played: number }

export function golfTotals(page: PageData, r: PageRecord): GolfTotals {
  const g = page.golf!;
  let out = 0, inn = 0, toPar = 0, played = 0, thru = 0;
  for (let h = 1; h <= g.holes; h++) {
    const s = scoreOf(r, h);
    if (s === null) continue;
    played++;
    thru = h;
    if (h <= 9) out += s; else inn += s;
    toPar += s - (g.par[h - 1] ?? 4);
  }
  return { thru, out, in: inn, total: out + inn, toPar, played };
}

export function toParLabel(n: number): string {
  return n === 0 ? "Even" : n > 0 ? "+" + n : String(n);
}

/** The word for one hole's score against its par. */
export function holeWord(score: number, par: number): string {
  const d = score - par;
  if (score === 1) return "Hole in One";
  if (d <= -3) return "Albatross";
  if (d === -2) return "Eagle";
  if (d === -1) return "Birdie";
  if (d === 0) return "Par";
  if (d === 1) return "Bogey";
  if (d === 2) return "Double Bogey";
  return "+" + d;
}

/** The first hole a player has not scored, for where the round picks up. */
export function nextHole(page: PageData): number {
  const g = page.golf!;
  for (let h = 1; h <= g.holes; h++) if (page.records.some((r) => scoreOf(r, h) === null)) return h;
  return g.holes;
}

export function setScore(page: PageData, recordId: string, hole: number, score: number | null): PageData {
  return setValues(page, recordId, { [holeKey(hole)]: score === null ? "" : String(Math.max(1, Math.round(score))) });
}

export function setPar(page: PageData, hole: number, par: number): PageData {
  const g = page.golf!;
  const p = g.par.slice();
  p[hole - 1] = Math.min(6, Math.max(3, Math.round(par)));
  return { ...page, golf: { ...g, par: p } };
}

/** Scores that a change to `holes` would hide. They are never deleted: the record keeps them and 18 brings them back. */
export function holesImpact(page: PageData, holes: 9 | 18): number {
  if (holes === 18) return 0;
  let n = 0;
  for (const r of page.records) for (let h = 10; h <= 18; h++) if (scoreOf(r, h) !== null) n++;
  return n;
}

export function setHoles(page: PageData, holes: 9 | 18): PageData {
  return { ...page, golf: { ...page.golf!, holes } };
}

// ---------------------------------------------------------------------------
// Lineups keep their own history.

export interface RosterChange { entryId: string; name: string; what: "name" | "number" | "gone" }

/** Where the team sheet has moved on since this lineup was made. Read-only: the lineup is never rewritten by it. */
export function rosterChanges(lineup: PageData, team: PageData | null): RosterChange[] {
  if (!team) return [];
  const byId = new Map(team.records.map((r) => [r.id, r]));
  const out: RosterChange[] = [];
  for (const e of lineup.records) {
    const p = byId.get(e.v.player ?? "");
    if (!p) { out.push({ entryId: e.id, name: e.v.name ?? "", what: "gone" }); continue; }
    if ((p.v.name ?? "").trim() !== (e.v.name ?? "").trim()) out.push({ entryId: e.id, name: e.v.name ?? "", what: "name" });
    else if ((p.v.number ?? "").trim() !== (e.v.number ?? "").trim()) out.push({ entryId: e.id, name: e.v.name ?? "", what: "number" });
  }
  return out;
}

/** The person asked for the roster's current names and numbers on this lineup. */
export function refreshFromRoster(lineup: PageData, team: PageData, now: number): PageData {
  const byId = new Map(team.records.map((r) => [r.id, r]));
  return {
    ...lineup,
    lineup: { ...lineup.lineup!, takenAt: now },
    records: lineup.records.map((e) => {
      const p = byId.get(e.v.player ?? "");
      return p ? { ...e, v: { ...e.v, name: p.v.name ?? "", number: p.v.number ?? "" } } : e;
    }),
  };
}

// ---------------------------------------------------------------------------
// Snapshots: the structured data as it was, dated, read-only.

export function takeSnapshot(page: PageData, why: SnapshotWhy, now: number): PageData {
  const snap: PageSnapshot = {
    at: now,
    why,
    fields: clone(page.fields),
    records: clone(page.records).map(({ base: _b, ...r }) => { void _b; return r; }),
    ...(page.golf ? { golf: clone(page.golf) } : {}),
    ...(page.lineup ? { lineup: clone(page.lineup) } : {}),
    ...(page.sections ? { sections: clone(page.sections) } : {}),
    ...(page.score ? { score: clone(page.score) } : {}),
    ...(page.meta ? { meta: clone(page.meta) } : {}),
    ...(page.games ? { games: clone(page.games) } : {}),
  };
  return { ...page, snapshots: [...(page.snapshots ?? []), snap].slice(-SNAPSHOT_CAP) };
}

/** Put a snapshot back. What is on the page now is kept as a snapshot first, so a restore loses nothing. */
export function restoreSnapshot(page: PageData, at: number, now: number): PageData {
  const s = page.snapshots?.find((x) => x.at === at);
  if (!s) return page;
  const kept = takeSnapshot(page, "restore", now);
  return {
    ...kept, fields: clone(s.fields), records: clone(s.records),
    ...(s.golf ? { golf: clone(s.golf) } : {}), ...(s.lineup ? { lineup: clone(s.lineup) } : {}),
    ...(s.sections ? { sections: clone(s.sections) } : {}), ...(s.score ? { score: clone(s.score) } : {}),
    ...(s.meta ? { meta: clone(s.meta) } : {}), ...(s.games ? { games: clone(s.games) } : {}),
  };
}

export const SNAPSHOT_WHY: Record<SnapshotWhy, string> = {
  import: "Before Import",
  reimport: "Before Reimport",
  export: "At Export",
  manual: "Saved by You",
  change: "Before a Field Change",
  restore: "Before a Restore",
};

/** Marks every record's current values as the common ancestor for the next reimport. */
export function markBase(page: PageData): PageData {
  return { ...page, records: page.records.map((r) => ({ ...r, base: { ...r.v } })) };
}

// ---------------------------------------------------------------------------
// Search and the list row.

/** Every word on the page a person might search for: titles of fields are not, values are. */
export function pageText(page: PageData | undefined): string[] {
  if (!page || !Array.isArray(page.records)) return [];
  const out: string[] = [];
  if (page.golf?.course) out.push(page.golf.course);
  if (page.lineup?.teamTitle) out.push(page.lineup.teamTitle);
  const textKeys = new Set(page.fields.filter((f) => !/^h\d+$/.test(f.key) && f.key !== "player").map((f) => f.key));
  for (const r of page.records) for (const [k, v] of Object.entries(r.v ?? {})) if (textKeys.has(k) && v && v.trim()) out.push(v.trim());
  for (const o of page.originals ?? []) out.push(o.name);
  return out;
}

/** The row's second line: what the page holds, said once. */
export function pageSummary(page: PageData): string {
  const n = page.records.length;
  if (page.mine) return "Your Template";
  if (page.kind === "scorecard") {
    const g = page.golf!;
    const done = page.records.length > 0 && page.records.every((r) => golfTotals(page, r).played >= g.holes);
    return done ? `${g.holes} Holes Played` : `${g.holes} Holes, ${n === 1 ? "1 Player" : n + " Players"}`;
  }
  const def = templateDef(page.kind);
  if (def) {
    if (page.kind === "scoreboard") return `${page.score?.label ?? "Game"}, ${n === 1 ? "1 Side" : n + " Sides"}`;
    if (page.kind === "standings") { const g = page.games?.length ?? 0; return `${n === 1 ? "1 Team" : n + " Teams"}, ${g === 1 ? "1 Game" : g + " Games"}`; }
    if (page.kind === "profile") return "One-Pager";
    if (def.derived) return "Read From Money";
    return n === 1 ? `1 ${def.noun}` : `${n} ${def.plural}`;
  }
  if (page.kind === "team") return n === 1 ? "1 Player" : `${n} Players`;
  if (page.kind === "lineup") return n === 1 ? "1 Player" : `${n} Players`;
  return n === 1 ? "1 Contact" : `${n} Contacts`;
}

export function isPage(x: unknown): x is PageData {
  return !!x && typeof x === "object" && (x as PageData).v === 1 && Array.isArray((x as PageData).records) && Array.isArray((x as PageData).fields);
}

/** A copy for Duplicate Page: new record ids (a copy is a new page, not the same records twice), no originals (their
 *  files belong to the page they came in on) and no snapshots. A lineup's link to its players is kept. */
export function duplicatePage(page: PageData): PageData {
  const { originals: _o, snapshots: _s, ...rest } = clone(page);
  void _o; void _s;
  return { ...rest, records: rest.records.map(({ base: _b, ...r }) => { void _b; return { ...r, id: newId("r") }; }) };
}
