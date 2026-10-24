// THE PURE PARTS OF THE TEMPLATE ENGINE (issue #115, waves 2 to 4): sections, field order, suggested fields, sums, and the little
// bits of arithmetic a template does for the person (pitching rest, a session's clock, league standings). Every function takes a page
// and returns the next one, or reads it; none writes anything, so the flow can keep the page before for Undo.

import { type PageData, type PageRecord, type PageField, type PageSection, type GameRow, newId } from "./pageModel";
import { templateDef, newTemplatePage, isTemplateKey } from "./templateDefs";
import { titleCase } from "../../shared/casing";

// ---------------------------------------------------------------------------
// Sections: headings the rows sit under. Named, added, removed and ordered by the person. On the page every heading is drawn,
// rows or none (Alfred 2026-10-16: a heading hidden until it had a row left 24 templates opening as an empty shell); an export
// and the session clock still walk only the headings that have rows.

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

/** The rows in the order they are drawn: the ones above every heading first, then each heading in order. With `includeEmpty`
 *  (the page itself), a heading with no rows is still a group, so the page draws it with its own Add; without it (an export, the
 *  session clock), only the headings that have rows come back. */
export function sectionGroups(page: PageData, opts: { includeEmpty?: boolean } = {}): RowGroup[] {
  const sections = page.sections ?? [];
  const known = new Set(sections.map((s) => s.key));
  const out: RowGroup[] = [];
  const all = orderedRecords(page);
  const loose = all.filter((r) => !r.sec || !known.has(r.sec));
  if (loose.length) out.push({ section: null, records: loose });
  for (const s of sections) {
    const recs = all.filter((r) => r.sec === s.key);
    if (recs.length || opts.includeEmpty) out.push({ section: s, records: recs });
  }
  return out;
}

/** The groups that have rows: what an export and the session clock walk. */
export const groupedRecords = (page: PageData): RowGroup[] => sectionGroups(page);

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
  const list = d?.suggested ?? (page.kind === "team" ? TEAM_SUGGESTED : undefined);
  if (!list) return [];
  const have = new Set(page.fields.map((f) => f.key));
  return list.filter((x) => !have.has(x.key));
}

// THE TEAM SHEET IS ALSO THE GROUP (Dave's cut list, 2026-10-23: the Group Manager Page folds into the Team Sheet: fees owed and paid,
// key dates). Nothing is added to a roster until it is asked for: each of these is one tap on the sheet, and a sheet that never asks
// is the roster it always was. A group's people, who is coming and what is owed are the same rows as a team's players.
export const TEAM_SUGGESTED: PageField[] = [
  { key: "role", label: "Role", type: "choice", options: ["Leader", "Member", "Guest"] },
  { key: "fee", label: "Fee Owed", type: "money" },
  { key: "paid", label: "Paid", type: "check" },
  { key: "coming", label: "Coming", type: "check" },
  { key: "keydate", label: "Key Date", type: "date" },
];

/** Fees owed and paid, worked out from the rows. Null until the sheet has a Fee Owed field and a fee on at least one row. */
export function groupDues(page: PageData): { owed: number; paid: number; left: number; unpaid: number } | null {
  if (!page.fields.some((x) => x.key === "fee")) return null;
  const hasPaid = page.fields.some((x) => x.key === "paid");
  let owed = 0, paid = 0, unpaid = 0, any = false;
  for (const r of page.records) {
    const fee = num(r.v.fee);
    if (fee === null || fee <= 0) continue;
    any = true;
    owed += fee;
    if (hasPaid && r.v.paid === "1") paid += fee; else unpaid++;
  }
  return any ? { owed, paid, left: owed - paid, unpaid } : null;
}

/** The dates the sheet's rows carry, soonest first, from today on. Empty when no Key Date field or none is set. */
export function keyDates(page: PageData, today: string = todayLocal()): { id: string; name: string; date: string }[] {
  if (!page.fields.some((x) => x.key === "keydate")) return [];
  return page.records
    .map((r) => ({ id: r.id, name: (r.v.name ?? "").trim(), date: (r.v.keydate ?? "").trim() }))
    .filter((x) => isoOk(x.date) && x.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
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
  // Nothing to total says nothing: no "$0" beside a head with no rows, and no "0 Min" over starter rows with no minutes yet.
  if (!d?.totals || page.records.length === 0) return "";
  return d.totals
    .filter((t) => page.fields.some((x) => x.key === t.key))
    .map((t) => { const n = sumOf(page.records, t.key); return n === 0 ? "" : t.money ? fmtMoney(n) : `${n} ${t.label}`; })
    .filter((x) => x !== "")
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

/** True when a catalog page is exactly as its template made it: the same fields, headings, settings and starter rows, nothing
 *  brought in and nothing kept. The picker opens such a page instead of making another (Alfred 2026-10-16: Event Day Pack chosen
 *  twice quietly made a second "Event Day Pack"). Ids are not compared; the values are. */
export function untouchedTemplatePage(page: PageData): boolean {
  const fresh = startingStructure(page.kind);
  if (!fresh || page.mine || (page.originals ?? []).length || (page.snapshots ?? []).length) return false;
  const shape = (p: PageData) => JSON.stringify({
    fields: p.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options ?? [] })),
    sections: (p.sections ?? []).map((s) => s.label),
    meta: p.meta ?? {},
    games: (p.games ?? []).length,
    records: p.records.map((r) => ({ v: r.v, sec: (p.sections ?? []).findIndex((s) => s.key === r.sec), link: r.link ?? "", confirmedOn: r.confirmedOn ?? "" })),
  });
  return shape(page) === shape(fresh);
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
  const only = templateDef(page.kind)?.timeline;
  for (const g of groupedRecords(page)) {
    // The Event Day Pack runs a clock over its Timeline alone: a checklist row has no time of its own.
    if (only && g.section?.label !== only) continue;
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

// ---------------------------------------------------------------------------
// WAVE 3. Pointers only, confirmation, what is coming up, and the order a page's rows are drawn in.

const todayLocal = (): string => {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
};

// ---- Pointers only (Money Map): where a thing is, never how to get into it.

/** A label that asks for a way in. A page of pointers has no field for it. */
export const SECRET_LABEL = /pass(word|code|phrase)|\bpin\b|\bcvv\b|\bcvc\b|security code|\blogin\b|username|\bsecret\b|routing|\bssn\b|social security|account number/i;
const PHONE_LABEL = /phone|contact|call|number to/i;

/** Text that is a way in: a password said out loud ("password: hunter2"), or a long number (a full account, card or social security number). */
export function looksLikeSecret(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (/\b(pass(word|code|phrase)|pwd|pin|cvv|cvc|security code|login|username)\b\s*(is|[:=])/i.test(t)) return true;
  // The digits of a number a person could use: nine or more in a row, ignoring the spaces and dashes numbers are written with.
  return /\d{9,}/.test(t.replace(/[\s-]/g, ""));
}

/** The first field on a pointers-only page whose new value is a way in, or null. A phone number is not one. */
export function secretIn(page: PageData, values: Record<string, string>): { key: string; label: string } | null {
  if (!templateDef(page.kind)?.pointersOnly) return null;
  for (const [key, value] of Object.entries(values)) {
    const label = page.fields.find((x) => x.key === key)?.label ?? key;
    if (PHONE_LABEL.test(label) || key === "contact") { if (/\b(pass(word|code|phrase)|pwd|pin)\b\s*(is|[:=])/i.test(value)) return { key, label }; continue; }
    if (looksLikeSecret(value)) return { key, label };
  }
  return null;
}

/** True when a new field's name asks for a way in, on a page of pointers. */
export function secretFieldName(page: PageData, label: string): boolean {
  return !!templateDef(page.kind)?.pointersOnly && SECRET_LABEL.test(label);
}

// ---- Confirmation: the person says a sensitive record is still true. Never automatic.

export const CONFIRM_STALE_DAYS = 365;

export function confirmRecord(page: PageData, recordId: string, iso: string): PageData {
  return { ...page, records: page.records.map((r) => (r.id === recordId ? { ...r, confirmedOn: iso } : r)) };
}

export function confirmAll(page: PageData, iso: string): PageData {
  return { ...page, records: page.records.map((r) => ({ ...r, confirmedOn: iso })) };
}

export type ConfirmState = "never" | "stale" | "fresh";

export function confirmState(r: PageRecord, today: string): ConfirmState {
  if (!r.confirmedOn) return "never";
  return daysBetween(r.confirmedOn, today) > CONFIRM_STALE_DAYS ? "stale" : "fresh";
}

/** How many rows are not confirmed this year: the page's "Confirm All" counts them. */
export function unconfirmedCount(page: PageData, today: string): number {
  return page.records.filter((r) => confirmState(r, today) !== "fresh").length;
}

// ---- What is coming up.

const isoOk = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
const dayNum = (iso: string): number => { const [y, m, d] = iso.split("-").map(Number); return Math.round(Date.UTC(y!, m! - 1, d!) / 86400000); };

/** Whole days from `a` to `b` (negative when b is before a). */
export function daysBetween(a: string, b: string): number { return dayNum(b) - dayNum(a); }

/** The next time a date's month and day come round, on or after `today`. Feb 29 is Feb 28 in a year with no 29th. */
export function nextYearly(iso: string, today: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const y = Number(today.slice(0, 4));
  const at = (yy: number): string => {
    const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
    const dd = m === 2 && d === 29 && !leap ? 28 : d!;
    return `${yy}-${pad(m!)}-${pad(dd)}`;
  };
  const thisYear = at(y);
  return thisYear >= today ? thisYear : at(y + 1);
}

export interface DueFact { text: string; tone: "warn" | "red" | "plain" }

/** The words for a date that is coming: "Due in 12 Days", "3 Days Overdue", "Today", "In 9 Days". Null when it is far off. */
export function dueFact(iso: string | undefined, today: string, yearly = false): DueFact | null {
  if (!isoOk(iso)) return null;
  const when = yearly ? nextYearly(iso.trim(), today) : iso.trim();
  const n = daysBetween(today, when);
  const days = (k: number) => (k === 1 ? "1 Day" : `${k} Days`);
  if (yearly) {
    if (n === 0) return { text: "Today", tone: "warn" };
    if (n === 1) return { text: "Tomorrow", tone: "warn" };
    return n <= 30 ? { text: `In ${days(n)}`, tone: n <= 7 ? "warn" : "plain" } : null;
  }
  if (n < 0) return { text: `${days(-n)} Overdue`, tone: "red" };
  if (n === 0) return { text: "Due Today", tone: "warn" };
  if (n === 1) return { text: "Due Tomorrow", tone: "warn" };
  return n <= 30 ? { text: `Due in ${days(n)}`, tone: n <= 7 ? "warn" : "plain" } : null;
}

/** The field whose date orders a page's rows: the template's own due field, else its first date field. */
function dateKeyOf(page: PageData): string | null {
  const d = templateDef(page.kind);
  if (d?.due) return d.due.key;
  return page.fields.find((x) => x.type === "date")?.key ?? null;
}

/** The rows in the order the page draws them: as made, unless the template sorts (newest first, or by the next time the date comes round). */
export function orderedRecords(page: PageData, today: string = todayLocal()): PageRecord[] {
  const d = templateDef(page.kind);
  const key = dateKeyOf(page);
  if (!d?.sort || !key) return page.records;
  const at = (r: PageRecord): string | null => { const v = (r.v[key] ?? "").trim(); return isoOk(v) ? v : null; };
  const rank = (r: PageRecord): string | null => { const v = at(r); return v === null ? null : d.sort === "next" ? nextYearly(v, today) : v; };
  const withIdx = page.records.map((r, i) => ({ r, i, k: rank(r) }));
  withIdx.sort((a, b) => {
    if (a.k === null && b.k === null) return a.i - b.i;
    if (a.k === null) return 1;
    if (b.k === null) return -1;
    const c = d.sort === "dateDesc" ? (a.k < b.k ? 1 : a.k > b.k ? -1 : 0) : a.k < b.k ? -1 : a.k > b.k ? 1 : 0;
    return c || a.i - b.i;
  });
  return withIdx.map((x) => x.r);
}

/** WHAT STOPS WORKING WITHOUT THIS FIELD, said before Remove (2026-10-17, the 2026-10-13 spec's Customization: a structural change
 *  with consequences, a field a calculation needs, explains what stops working BEFORE applying, Astra's boundary). Read from the
 *  template's definition alone: its `needs`, its `totals`, its `due` field and the date its `sort` reads. A field nothing reads
 *  says nothing here. */
export function fieldConsequences(page: PageData, key: string): string[] {
  const d = templateDef(page.kind);
  const field = page.fields.find((x) => x.key === key);
  if (!d || !field) return [];
  const label = titleCase(field.label);
  const out: string[] = [];
  const need = d.needs?.[key];
  if (need) out.push(need);
  if (d.totals?.some((t) => t.key === key)) out.push(`The ${label} Total Stops Adding Up`);
  if (d.due?.key === key) out.push(`${d.plural} Stop Saying When They Are Due`);
  if (d.sort && dateKeyOf(page) === key) {
    // With no due field the order falls to the next date field, if the page has one.
    const then = d.due ? undefined : page.fields.find((x) => x.type === "date" && x.key !== key);
    out.push(then ? `${d.plural} Sort by ${titleCase(then.label)} Instead` : `${d.plural} Stop Sorting by ${label}`);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Debt Payoff: which to pay first, and how long it takes, from the balances Money holds. Nothing here is stored but each debt's APR
// and minimum; the balance is read, never copied, so there is no second ledger to keep in step.

export interface DebtIn { id: string; name: string; balance: number; apr: number; min: number }
export interface DebtStep { id: string; name: string; /** The month (1 is the first) this debt reaches zero. */ month: number; interest: number }
export interface DebtPlan { order: string[]; steps: DebtStep[]; months: number | null; interest: number; total: number; monthly: number }
export type DebtMethod = "avalanche" | "snowball";

const MAX_MONTHS = 1200;

/** Pay every minimum, put everything else (the extra, and every minimum a cleared debt frees up) on one debt at a time: the highest
 *  rate first (avalanche) or the smallest balance first (snowball). `months` is null when the payments never clear the debt. */
export function payoffPlan(debts: DebtIn[], extra: number, method: DebtMethod): DebtPlan {
  const live = debts.filter((d) => d.balance > 0.005).map((d) => ({ ...d, bal: d.balance, paid: 0 }));
  const priority = (a: { bal: number; apr: number; name: string }, b: { bal: number; apr: number; name: string }) =>
    (method === "avalanche" ? b.apr - a.apr || a.bal - b.bal : a.bal - b.bal || b.apr - a.apr) || a.name.localeCompare(b.name);
  const order = [...live].sort(priority).map((d) => d.id);
  const budget = live.reduce((s, d) => s + d.min, 0) + Math.max(0, extra);
  const steps: DebtStep[] = [];
  let interest = 0;
  let month = 0;
  const open = () => live.filter((d) => d.bal > 0.005);
  while (open().length && month < MAX_MONTHS) {
    month++;
    for (const d of open()) { const i = (d.bal * d.apr) / 1200; d.bal += i; d.paid += i; interest += i; }
    let left = budget;
    for (const d of open()) { const pay = Math.min(d.min, d.bal, left); d.bal -= pay; left -= pay; }
    for (const d of [...open()].sort(priority)) { if (left <= 0) break; const pay = Math.min(left, d.bal); d.bal -= pay; left -= pay; }
    for (const d of live) if (d.bal <= 0.005 && !steps.some((s) => s.id === d.id)) steps.push({ id: d.id, name: d.name, month, interest: d.paid });
  }
  const cleared = open().length === 0;
  return { order, steps, months: cleared ? month : null, interest: Math.round(interest * 100) / 100, total: live.reduce((s, d) => s + d.balance, 0), monthly: budget };
}

/** "3 Years 2 Months" for a number of months. */
export function monthsWords(m: number): string {
  const y = Math.floor(m / 12), r = m % 12;
  const ys = y === 1 ? "1 Year" : `${y} Years`;
  const rs = r === 1 ? "1 Month" : `${r} Months`;
  return y === 0 ? rs : r === 0 ? ys : `${ys} ${rs}`;
}

/** The debts on a page as the plan reads them: a linked row takes its balance from the Money account, an unlinked one from its own field. */
export function debtsOf(page: PageData, balanceOf: (link: string) => { balance: number; name: string } | null): DebtIn[] {
  return page.records.map((r) => {
    const linked = r.link ? balanceOf(r.link) : null;
    return { id: r.id, name: linked?.name || (r.v.name ?? "").trim() || "Debt", balance: linked ? linked.balance : num(r.v.balance) ?? 0, apr: num(r.v.apr) ?? 0, min: num(r.v.min) ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// WAVE 4. Brackets, the draft board and poker night: the pages that do arithmetic for the person.

// ---- Brackets (single elimination). The entrants' order is the seeding; results are kept on the page as `w:<match>` = the winner's record id.

export interface BracketMatch { id: string; round: number; index: number; a: string | null; b: string | null; bye: boolean; winner: string | null }

/** Seed numbers in bracket order for a power-of-two size: 1 meets the last seed, 2 the one before, and the top two seeds can only meet in the final. */
function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) { const next: number[] = []; const n = order.length * 2; for (const s of order) next.push(s, n + 1 - s); order = next; }
  return order;
}

export const WINNER_PREFIX = "w:";

export function bracketOf(ids: string[], winners: Record<string, string>): { rounds: BracketMatch[][]; champion: string | null } {
  if (ids.length === 0) return { rounds: [], champion: null };
  if (ids.length === 1) return { rounds: [], champion: ids[0]! };
  let size = 2;
  while (size < ids.length) size *= 2;
  const order = seedOrder(size);
  const rounds: BracketMatch[][] = [];
  let prev: BracketMatch[] = [];
  for (let r = 0; size >> r >= 2; r++) {
    const count = size >> (r + 1);
    const cur: BracketMatch[] = [];
    for (let i = 0; i < count; i++) {
      const id = `m${r}-${i}`;
      const a = r === 0 ? ids[order[2 * i]! - 1] ?? null : prev[2 * i]!.winner;
      const b = r === 0 ? ids[order[2 * i + 1]! - 1] ?? null : prev[2 * i + 1]!.winner;
      // A seed with no opponent (the field is not a power of two) goes through without playing.
      const bye = r === 0 && ((a === null) !== (b === null));
      const stored = winners[id];
      const winner = bye ? a ?? b : stored && (stored === a || stored === b) ? stored : null;
      cur.push({ id, round: r, index: i, a, b, bye, winner });
    }
    rounds.push(cur);
    prev = cur;
  }
  return { rounds, champion: prev[0]?.winner ?? null };
}

/** The round's name by how many are left: Final, Semifinals, Quarterfinals, then Round N. */
export function roundName(round: number, total: number): string {
  const left = total - round;
  return left === 1 ? "Final" : left === 2 ? "Semifinals" : left === 3 ? "Quarterfinals" : `Round ${round + 1}`;
}

export const resultsOf = (page: PageData): Record<string, string> =>
  Object.fromEntries(Object.entries(page.meta ?? {}).filter(([k, v]) => k.startsWith(WINNER_PREFIX) && v).map(([k, v]) => [k.slice(WINNER_PREFIX.length), v]));

/** Pick a winner (or clear one with null). A result that no longer fits, because an earlier one changed or an entrant left, is dropped with it. */
export function setWinner(page: PageData, matchId: string, winnerId: string | null): PageData {
  const meta = { ...(page.meta ?? {}) };
  if (winnerId === null) delete meta[WINNER_PREFIX + matchId]; else meta[WINNER_PREFIX + matchId] = winnerId;
  return pruneResults({ ...page, meta });
}

export function pruneResults(page: PageData): PageData {
  let cur = page;
  for (let guard = 0; guard < 12; guard++) {
    const results = resultsOf(cur);
    const { rounds } = bracketOf(cur.records.map((r) => r.id), results);
    const valid = new Set(rounds.flat().filter((m) => m.winner && !m.bye).map((m) => m.id));
    const stale = Object.keys(results).filter((id) => !valid.has(id));
    if (!stale.length) return cur;
    const meta = { ...(cur.meta ?? {}) };
    for (const id of stale) delete meta[WINNER_PREFIX + id];
    cur = { ...cur, meta };
  }
  return cur;
}

// ---- The draft board: a pick belongs to a team by its place in the order, straight or snaking back.

export function managersOf(page: PageData): string[] {
  return (page.meta?.teams ?? "").split(/[,\n]/).map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean);
}

export interface DraftSlot { overall: number; round: number; pick: number; team: number }

/** Pick number `i` (from 0): its round, its place in the round (from 1) and the team that makes it. A snake reverses every second round. */
export function draftSlot(i: number, teams: number, snake: boolean): DraftSlot {
  const round = Math.floor(i / teams);
  const pos = i % teams;
  return { overall: i + 1, round: round + 1, pick: pos + 1, team: snake && round % 2 === 1 ? teams - 1 - pos : pos };
}

export function onTheClock(page: PageData): (DraftSlot & { manager: string }) | null {
  const m = managersOf(page);
  if (m.length < 2) return null;
  const slot = draftSlot(page.records.length, m.length, page.meta?.snake !== "0");
  return { ...slot, manager: m[slot.team]! };
}

export interface DraftRoster { manager: string; picks: { record: PageRecord; slot: DraftSlot }[] }

export function draftRosters(page: PageData): DraftRoster[] {
  const m = managersOf(page);
  if (m.length < 2) return [];
  const snake = page.meta?.snake !== "0";
  const out: DraftRoster[] = m.map((manager) => ({ manager, picks: [] }));
  page.records.forEach((record, i) => { const slot = draftSlot(i, m.length, snake); out[slot.team]!.picks.push({ record, slot }); });
  return out;
}

// ---- Poker night's blind schedule (the 2026-10-13 spec, auto-adjust rule 3: "poker blind schedule" is a flagship adjustment). Three
// numbers on the page (the starting small blind, the minutes a level runs, how many levels) and the schedule writes itself up the
// ladder every home game climbs: 25/50, 50/100, 75/150, 100/200, 150/300, 200/400 and on. Nothing is kept but the three numbers.

export interface BlindLevel { level: number; small: number; big: number; minutes: number }

const BLIND_LADDER = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 60, 80, 100, 120];
export const MAX_BLIND_LEVELS = BLIND_LADDER.length;

export function blindSchedule(page: PageData): BlindLevel[] {
  const start = num(page.meta?.blindStart);
  if (start === null || start <= 0) return [];
  const minutes = Math.max(0, Math.round(num(page.meta?.blindMin) ?? 0));
  const levels = Math.min(MAX_BLIND_LEVELS, Math.max(1, Math.round(num(page.meta?.blindLevels) ?? 8)));
  return BLIND_LADDER.slice(0, levels).map((m, i) => ({ level: i + 1, small: start * m, big: start * m * 2, minutes }));
}

// ---- 1:1 Log: open promises carry forward (the 2026-10-13 spec). A new meeting starts with the last meeting's follow-ups already in
// its own, so nothing promised is retyped or lost; the ones that are done are cleared by hand. The last meeting is the newest by date.

export function carriedForward(page: PageData): { from: string; values: Record<string, string> } | null {
  if (page.kind !== "oneonone" || !page.records.length) return null;
  const dated = page.records.filter((r) => isoOk(r.v.date)).sort((a, b) => (a.v.date! < b.v.date! ? 1 : a.v.date! > b.v.date! ? -1 : 0));
  const last = dated[0] ?? page.records[page.records.length - 1]!;
  const actions = (last.v.actions ?? "").trim();
  return actions ? { from: isoOk(last.v.date) ? last.v.date!.trim() : "", values: { actions } } : null;
}

// ---- Poker night: what each player is up or down, and the fewest payments that settle it.

export interface PokerRow { id: string; name: string; inCents: number; outCents: number; netCents: number }
export interface Payment { from: string; to: string; cents: number }

const cents = (s: string | undefined): number => Math.round((num(s) ?? 0) * 100);

export function pokerRows(page: PageData): PokerRow[] {
  return page.records.map((r) => {
    const inC = cents(r.v.buyin) + cents(r.v.rebuy);
    const outC = cents(r.v.cashout);
    return { id: r.id, name: (r.v.name ?? "").trim() || "Player", inCents: inC, outCents: outC, netCents: outC - inC };
  });
}

/** What is left over when the cash-outs and the buy-ins do not match: positive means more was cashed out than went in. */
export const potGap = (rows: PokerRow[]): number => rows.reduce((s, r) => s + r.netCents, 0);

/** Each person who is down pays someone who is up, the largest to the largest, until everyone is square. Only worked out when the table balances. */
export function settleUp(rows: PokerRow[]): Payment[] {
  const up = rows.filter((r) => r.netCents > 0).map((r) => ({ name: r.name, left: r.netCents })).sort((a, b) => b.left - a.left);
  const down = rows.filter((r) => r.netCents < 0).map((r) => ({ name: r.name, left: -r.netCents })).sort((a, b) => b.left - a.left);
  const out: Payment[] = [];
  let i = 0, j = 0;
  while (i < down.length && j < up.length) {
    const pay = Math.min(down[i]!.left, up[j]!.left);
    if (pay > 0) out.push({ from: down[i]!.name, to: up[j]!.name, cents: pay });
    down[i]!.left -= pay; up[j]!.left -= pay;
    if (down[i]!.left === 0) i++;
    if (up[j]!.left === 0) j++;
  }
  return out;
}
