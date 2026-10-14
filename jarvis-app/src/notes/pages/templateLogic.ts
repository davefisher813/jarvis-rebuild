// THE PURE PARTS OF THE TEMPLATE ENGINE (issue #115, waves 2 to 4): sections, field order, suggested fields, sums, and the little
// bits of arithmetic a template does for the person (pitching rest, a session's clock, league standings). Every function takes a page
// and returns the next one, or reads it; none writes anything, so the flow can keep the page before for Undo.

import { type PageData, type PageRecord, type PageField, type PageSection, type GameRow, newId } from "./pageModel";
import { templateDef, newTemplatePage, isTemplateKey } from "./templateDefs";

// ---------------------------------------------------------------------------
// Sections: headings the rows sit under. Named, added, removed and ordered by the person; one with no rows is not drawn.

const cleanLabel = (s: string) => s.replace(/\s+/g, " ").trim();

export function addSection(page: PageData, label: string): { page: PageData; key: string } {
  const key = newId("s");
  const clean = cleanLabel(label) || "New Section";
  return { page: { ...page, sections: [...(page.sections ?? []), { key, label: clean }] }, key };
}

export function renameSection(page: PageData, key: string, label: string): PageData {
  const clean = cleanLabel(label);
  if (!clean) return page;
  return { ...page, sections: (page.sections ?? []).map((s) => (s.key === key ? { ...s, label: clean } : s)) };
}

/** Rows in a removed section are kept: they move up above the headings. */
export function removeSection(page: PageData, key: string): PageData {
  return {
    ...page,
    sections: (page.sections ?? []).filter((s) => s.key !== key),
    records: page.records.map((r) => {
      if (r.sec !== key) return r;
      const { sec: _s, ...rest } = r;
      void _s;
      return rest;
    }),
  };
}

export function sectionImpact(page: PageData, key: string): number {
  return page.records.filter((r) => r.sec === key).length;
}

export function moveSection(page: PageData, key: string, by: -1 | 1): PageData {
  const list = (page.sections ?? []).slice();
  const i = list.findIndex((s) => s.key === key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return page;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return { ...page, sections: list };
}

export function setSection(page: PageData, recordId: string, key: string | null): PageData {
  return {
    ...page,
    records: page.records.map((r) => {
      if (r.id !== recordId) return r;
      if (key === null) { const { sec: _s, ...rest } = r; void _s; return rest; }
      return { ...r, sec: key };
    }),
  };
}

export interface RowGroup { section: PageSection | null; records: PageRecord[] }

/** The rows in the order they are drawn: the ones above every heading first, then each heading that has rows. */
export function groupedRecords(page: PageData): RowGroup[] {
  const sections = page.sections ?? [];
  const known = new Set(sections.map((s) => s.key));
  const out: RowGroup[] = [];
  const loose = page.records.filter((r) => !r.sec || !known.has(r.sec));
  if (loose.length) out.push({ section: null, records: loose });
  for (const s of sections) {
    const recs = page.records.filter((r) => r.sec === s.key);
    if (recs.length) out.push({ section: s, records: recs });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fields: reorder, and the suggested ones a template offers.

export function moveField(page: PageData, key: string, by: -1 | 1): PageData {
  const list = page.fields.slice();
  const i = list.findIndex((f) => f.key === key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return page;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return { ...page, fields: list };
}

/** The template's suggested fields this page does not have yet. */
export function suggestedFor(page: PageData): PageField[] {
  const d = templateDef(page.kind);
  if (!d?.suggested) return [];
  const have = new Set(page.fields.map((f) => f.key));
  return d.suggested.filter((x) => !have.has(x.key));
}

export function addSuggested(page: PageData, key: string): PageData {
  const f = suggestedFor(page).find((x) => x.key === key);
  return f ? { ...page, fields: [...page.fields, { ...f, ...(f.options ? { options: [...f.options] } : {}) }] } : page;
}

export function setFieldType(page: PageData, key: string, type: PageField["type"]): PageData {
  return { ...page, fields: page.fields.map((f) => (f.key === key ? { ...f, type } : f)) };
}

// ---------------------------------------------------------------------------
// Sums.

export const num = (s: string | undefined): number | null => {
  const t = (s ?? "").trim().replace(/[$,]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function sumOf(records: PageRecord[], key: string): number {
  let t = 0;
  for (const r of records) t += num(r.v[key]) ?? 0;
  return t;
}

/** A page's totals as words for its head: "75 Min". Only the totals the template names and the page still has a field for. */
export function totalsLine(page: PageData, fmtMoney: (n: number) => string = (n) => "$" + n.toLocaleString("en-US")): string {
  const d = templateDef(page.kind);
  if (!d?.totals) return "";
  return d.totals
    .filter((t) => page.fields.some((x) => x.key === t.key))
    .map((t) => (t.money ? fmtMoney(sumOf(page.records, t.key)) : `${sumOf(page.records, t.key)} ${t.label}`))
    .filter((x, _i, all) => all.length > 0 && x !== "")
    .join(" · ");
}

// ---------------------------------------------------------------------------
// My templates: an edited page kept as structure, to start new pages from.

/** The structure of a page with none of its rows: fields, headings and settings. */
export function asMyTemplate(page: PageData): PageData {
  const { originals: _o, snapshots: _s, games: _g, golf: _gf, lineup: _l, ...rest } = page;
  void _o; void _s; void _g; void _gf; void _l;
  return {
    ...rest,
    mine: true,
    records: [],
    fields: page.fields.map((f) => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) })),
    ...(page.sections ? { sections: page.sections.map((s) => ({ ...s })) } : {}),
    ...(page.meta ? { meta: { ...page.meta } } : {}),
  };
}

/** A new page from the person's own template: same structure, fresh ids, no rows, and not itself a template. */
export function fromMyTemplate(t: PageData): PageData {
  const { mine: _m, ...rest } = t;
  void _m;
  return { ...rest, records: [], fields: t.fields.map((f) => ({ ...f })), ...(t.sections ? { sections: t.sections.map((s) => ({ ...s })) } : {}) };
}

/** A catalog page's own starting structure, for "back to the template". */
export function startingStructure(kind: string): PageData | null {
  return isTemplateKey(kind) ? newTemplatePage(kind) : null;
}

// ---------------------------------------------------------------------------
// Pitching Board: rest follows from the pitches thrown (the common youth baseball rest table), and the day's limit is the page's own.

/** Days of rest a start of this many pitches asks for. */
export function restDaysFor(pitches: number): number {
  if (pitches >= 66) return 4;
  if (pitches >= 51) return 3;
  if (pitches >= 36) return 2;
  if (pitches >= 21) return 1;
  return 0;
}

export interface PitcherStatus { name: string; last: PageRecord | null; availableOn: string | null; availableNow: boolean; pitchesLast: number; total: number }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Each pitcher's last outing and the first day they can pitch again, as of `today`. */
export function pitcherStatuses(page: PageData, today: string): PitcherStatus[] {
  const by = new Map<string, PageRecord[]>();
  for (const r of page.records) {
    const n = (r.v.name ?? "").trim();
    if (!n) continue;
    by.set(n, [...(by.get(n) ?? []), r]);
  }
  const out: PitcherStatus[] = [];
  for (const [name, list] of by) {
    const dated = list.filter((r) => ISO.test((r.v.date ?? "").trim())).sort((a, b) => (a.v.date! < b.v.date! ? -1 : 1));
    const last = dated.length ? dated[dated.length - 1]! : null;
    const p = last ? num(last.v.pitches) ?? 0 : 0;
    const availableOn = last ? addDaysIso(last.v.date!, restDaysFor(p) + 1) : null;
    out.push({ name, last, availableOn, availableNow: !availableOn || availableOn <= today, pitchesLast: p, total: sumOf(list, "pitches") });
  }
  return out.sort((a, b) => Number(b.availableNow) - Number(a.availableNow) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Session Plan: with a start time, every activity gets a clock time from the minutes before it.

function pad(n: number) { return String(n).padStart(2, "0"); }

/** "6:30 PM" style time for a start "HH:MM" plus minutes. */
export function clockAfter(start: string, plusMin: number): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(start.trim());
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + plusMin;
  const h24 = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const ap = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(mm)} ${ap}`;
}

/** Each row's start time in the order it is drawn (sections in order, rows in order), by record id. Empty when no start is set. */
export function sessionClock(page: PageData): Map<string, string> {
  const out = new Map<string, string>();
  const start = (page.meta?.start ?? "").trim();
  if (!start) return out;
  let at = 0;
  for (const g of groupedRecords(page)) {
    for (const r of g.records) {
      const t = clockAfter(start, at);
      if (t) out.set(r.id, t);
      at += num(r.v.min) ?? 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// League Standings: worked out from the games, so there is nothing to keep in step by hand.

export interface StandingRow { id: string; name: string; w: number; l: number; t: number; pf: number; pa: number; pts: number; gp: number }

export function standingsOf(page: PageData): StandingRow[] {
  const rows = new Map<string, StandingRow>(page.records.map((r) => [r.id, { id: r.id, name: (r.v.name ?? "").trim() || "Team", w: 0, l: 0, t: 0, pf: 0, pa: 0, pts: 0, gp: 0 }]));
  for (const g of page.games ?? []) {
    const a = rows.get(g.a), b = rows.get(g.b);
    if (!a || !b) continue;
    a.gp++; b.gp++;
    a.pf += g.sa; a.pa += g.sb; b.pf += g.sb; b.pa += g.sa;
    if (g.sa > g.sb) { a.w++; b.l++; } else if (g.sa < g.sb) { b.w++; a.l++; } else { a.t++; b.t++; }
  }
  for (const r of rows.values()) r.pts = r.w * 2 + r.t;
  return [...rows.values()].sort((x, y) => y.pts - x.pts || (y.pf - y.pa) - (x.pf - x.pa) || y.pf - x.pf || x.name.localeCompare(y.name));
}

export function addGame(page: PageData, g: Omit<GameRow, "id">): PageData {
  return { ...page, games: [...(page.games ?? []), { id: newId("g"), ...g }] };
}

export function removeGame(page: PageData, id: string): PageData {
  return { ...page, games: (page.games ?? []).filter((g) => g.id !== id) };
}

/** Removing a team takes its games with it, since a game with one side gone means nothing. The count is said first. */
export function gamesOfTeam(page: PageData, teamId: string): number {
  return (page.games ?? []).filter((g) => g.a === teamId || g.b === teamId).length;
}

export function removeTeamAndGames(page: PageData, teamId: string): PageData {
  return { ...page, records: page.records.filter((r) => r.id !== teamId), games: (page.games ?? []).filter((g) => g.a !== teamId && g.b !== teamId) };
}
