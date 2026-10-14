// BRINGING A TABLE INTO A PAGE (issue #115, slice 1: one verified path, a
// roster into a Team Sheet, with correction and reimport).
//
// 1. PROPOSE. Each column of the file gets a proposed home: one of the page's
//    fields, the stable id column, or "Keep as Extra Field". Nothing is left
//    out unless the person says so, and what is left out is listed.
// 2. CONFIRM. Values the import cannot be sure of (a number that is not one
//    number, a position that names two) are flagged with the reason and stay
//    visibly uncertain until corrected or kept.
// 3. RECONCILE. A file that comes back (export, edit in Sheets, reimport) is
//    matched to the page by the id column. Each record is compared three
//    ways: the value at the last export (`base`), the value on the page now,
//    and the value in the file. A change on one side only is taken without
//    asking; the same change on both is no change; different changes on both
//    sides are the only thing asked about. Rows without an id are new; ids
//    the file no longer has are removals, unless the page changed that record
//    since, which is a conflict. Nothing is duplicated: an id that is already
//    on the page is that record.

import { type PageData, type PageField, type PageRecord, newId, recordName, takeSnapshot } from "./pageModel";

export const ID_HEADER = "JARVIS ID";

export type Target = string; // a field key, or one of the three below
export const T_ID = "@id";
export const T_EXTRA = "@extra";
export const T_SKIP = "@skip";

export interface ColumnMap { col: number; header: string; target: Target; sure: boolean }

const SYNONYMS: Record<string, string[]> = {
  name: ["name", "player", "player name", "full name", "athlete", "who", "kid", "child"],
  "@first": ["first", "first name", "given name"],
  "@last": ["last", "last name", "surname", "family name"],
  number: ["number", "no", "no.", "num", "#", "jersey", "jersey number", "jersey #", "uniform", "uniform number"],
  position: ["position", "pos", "positions", "spot"],
  contact: ["contact", "phone", "email", "e-mail", "parent", "parent contact", "guardian", "mobile", "cell", "parent phone", "parent email"],
  who: ["who", "name", "contact", "person"],
  org: ["organization", "organisation", "org", "company", "school", "team", "club"],
  channel: ["channel", "how", "via", "method"],
  status: ["status", "stage", "state"],
  last: ["last contact", "last contacted", "date", "last touch"],
  next: ["next step", "next", "follow up", "follow-up", "todo", "to do"],
  notes: ["notes", "note", "comments", "comment"],
};

const norm = (s: string) => s.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

/** The proposed home for every column. A header that names a field (by its current label, or a word that means it)
 *  goes there; a column with no match is kept as an extra field. */
export function proposeMapping(page: PageData, header: string[]): ColumnMap[] {
  const taken = new Set<string>();
  const out: ColumnMap[] = header.map((h, col) => ({ col, header: h, target: T_EXTRA, sure: false }));
  const fields = page.fields.filter((f) => !/^h\d+$/.test(f.key) && f.key !== "player");
  const tryAssign = (pred: (h: string, f: PageField) => boolean, sure: boolean) => {
    for (const m of out) {
      if (m.target !== T_EXTRA) continue;
      const h = norm(m.header);
      if (!h) continue;
      if (h === norm(ID_HEADER) || h === "id") { if (!taken.has(T_ID)) { m.target = T_ID; m.sure = true; taken.add(T_ID); } continue; }
      const f = fields.find((x) => !taken.has(x.key) && pred(h, x));
      if (f) { m.target = f.key; m.sure = sure; taken.add(f.key); }
    }
  };
  // The page's own labels first (a reimport of our own export maps exactly), then the words that mean them.
  tryAssign((h, f) => h === norm(f.label), true);
  tryAssign((h, f) => (SYNONYMS[f.key] ?? []).includes(h), true);
  // A roster split into first and last names becomes one Name.
  if (page.kind === "team" && !taken.has("name")) {
    const first = out.find((m) => m.target === T_EXTRA && SYNONYMS["@first"]!.includes(norm(m.header)));
    const last = out.find((m) => m.target === T_EXTRA && SYNONYMS["@last"]!.includes(norm(m.header)));
    if (first && last) { first.target = "name"; last.target = "name"; first.sure = true; last.sure = true; taken.add("name"); }
  }
  tryAssign((h, f) => (SYNONYMS[f.key] ?? []).some((s) => s.length > 2 && h.includes(s)), false);
  return out;
}

/** Does this mapping need the person to look at it? A reimport of the page's own export does not. */
export function mappingIsExact(page: PageData, map: ColumnMap[]): boolean {
  return map.every((m) => m.target === T_ID || (m.target !== T_EXTRA && m.target !== T_SKIP && norm(page.fields.find((f) => f.key === m.target)?.label ?? "") === norm(m.header)) || (!m.header.trim()));
}

export interface ImportPlan {
  /** Fields the page gains: one per column kept as an extra field. */
  newFields: PageField[];
  records: PageRecord[];
  /** Columns left out, by header, so the person can be told. They stay in the original file. */
  leftOut: string[];
  notes: string[];
}

function extraKeyFor(page: PageData, header: string): string | null {
  const f = page.fields.find((x) => x.extra && norm(x.label) === norm(header));
  return f ? f.key : null;
}

/** The fields an apply would add, and the key each column writes to. */
function columnKeys(page: PageData, map: ColumnMap[]): { keys: (string | null)[]; newFields: PageField[] } {
  const newFields: PageField[] = [];
  const keys = map.map((m) => {
    if (m.target === T_SKIP || m.target === T_ID) return null;
    if (m.target !== T_EXTRA) return m.target;
    if (!m.header.trim()) return null;
    const existing = extraKeyFor(page, m.header) ?? newFields.find((f) => norm(f.label) === norm(m.header))?.key;
    if (existing) return existing;
    const f: PageField = { key: newId("f"), label: m.header.trim(), type: "text", extra: true };
    newFields.push(f);
    return f.key;
  });
  return { keys, newFields };
}

function rowValues(map: ColumnMap[], keys: (string | null)[], row: string[]): Record<string, string> {
  const v: Record<string, string> = {};
  map.forEach((m, i) => {
    const k = keys[i];
    if (!k) return;
    const cell = (row[m.col] ?? "").trim();
    // Two columns into one field (first and last name) join with a space.
    v[k] = v[k] ? (cell ? v[k] + " " + cell : v[k]) : cell;
  });
  return v;
}

const POS_SPLIT = /\s*(?:\/|,|\bor\b|&)\s*/i;

/** What an import is unsure of in one record, by field key. The reasons are short and Title Case: they are drawn. */
export function uncertainties(kind: PageData["kind"], v: Record<string, string>): Record<string, string> {
  const f: Record<string, string> = {};
  if (kind === "team" || kind === "lineup") {
    const n = (v.number ?? "").trim().replace(/^#/, "");
    if (n && !/^\d{1,3}$/.test(n)) f.number = /\d/.test(n) ? "Not One Clear Number" : "Not a Number";
    const p = (v.position ?? "").trim();
    if (p && (POS_SPLIT.test(p) && p.split(POS_SPLIT).filter(Boolean).length > 1)) f.position = "More Than One Position";
    else if (p.includes("?")) f.position = "Marked Unsure";
    const name = (v.name ?? "").trim();
    const rest = Object.entries(v).some(([k, x]) => k !== "name" && x.trim());
    if (!name && rest) f.name = "No Name";
    else if (/\d/.test(name)) f.name = "Has a Number in It";
  }
  return f;
}

/** A number written as "#7" is the number 7: the import tidies what it is sure of and flags what it is not. */
function tidy(page: PageData, v: Record<string, string>): Record<string, string> {
  const out = { ...v };
  // A done mark comes back as Yes, true, x or a tick in a sheet; it is the page's own "1" once it is read.
  for (const f of page.fields) if (f.type === "check" && f.key in out) out[f.key] = /^(1|y|yes|true|x|done|paid|\u2713|\u2714)$/i.test((out[f.key] ?? "").trim()) ? "1" : "";
  if (page.kind !== "team") return out;
  if (out.number && /^#\s*\d{1,3}$/.test(out.number.trim())) out.number = out.number.trim().replace(/^#\s*/, "");
  return out;
}

/** The records a first import would make, each flagged where it is unsure, plus what was left out. */
export function planImport(page: PageData, rows: string[][], map: ColumnMap[], notes: string[] = []): ImportPlan {
  const { keys, newFields } = columnKeys(page, map);
  const idCol = map.find((m) => m.target === T_ID)?.col;
  const records: PageRecord[] = [];
  const seen = new Set(page.records.map((r) => r.id));
  for (const row of rows) {
    const v = tidy(page, rowValues(map, keys, row));
    if (!Object.values(v).some((x) => x.trim())) continue;
    const given = idCol !== undefined ? (row[idCol] ?? "").trim() : "";
    const id = given && /^r_[A-Za-z0-9]+$/.test(given) && !seen.has(given) ? given : newId("r");
    seen.add(id);
    const flags = uncertainties(page.kind, v);
    records.push({ id, v, ...(Object.keys(flags).length ? { flags } : {}) });
  }
  const leftOut = map.filter((m) => m.target === T_SKIP && m.header.trim()).map((m) => m.header.trim());
  return { newFields, records, leftOut, notes };
}

/** Lays a confirmed plan onto the page. The page is snapshotted first; what came in becomes the base for a reimport. */
export function applyImport(page: PageData, plan: ImportPlan, now: number): PageData {
  const snap = page.records.length ? takeSnapshot(page, "import", now) : page;
  const records = plan.records.map((r) => ({ ...r, base: { ...r.v } }));
  return { ...snap, fields: [...snap.fields, ...plan.newFields], records: [...snap.records, ...records] };
}

// ---------------------------------------------------------------------------
// Reimport.

export interface FieldChange { key: string; label: string; from: string; to: string }
export interface Conflict { id: string; name: string; key: string; label: string; local: string; incoming: string }
export interface Changes {
  added: PageRecord[];
  changed: { id: string; name: string; fields: FieldChange[] }[];
  removed: { id: string; name: string }[];
  /** Edits made on the page since the export that the file did not touch: kept, and said so. */
  keptLocal: { id: string; name: string; fields: FieldChange[] }[];
  conflicts: Conflict[];
  newFields: PageField[];
  leftOut: string[];
  /** Rows whose id appeared more than once in the file: the first is used, the rest are listed here. */
  dupes: string[];
  notes: string[];
  /** What the file says for each record it carries: the new common ancestor once applied. */
  fileValues: Record<string, Record<string, string>>;
}

export function conflictKey(c: { id: string; key: string }): string { return c.id + "\u0000" + c.key; }

export function reconcile(page: PageData, rows: string[][], map: ColumnMap[], notes: string[] = []): Changes {
  const { keys, newFields } = columnKeys(page, map);
  const idCol = map.find((m) => m.target === T_ID)?.col;
  const label = (k: string) => page.fields.find((f) => f.key === k)?.label ?? newFields.find((f) => f.key === k)?.label ?? k;
  const byId = new Map(page.records.map((r) => [r.id, r]));
  const out: Changes = { added: [], changed: [], removed: [], keptLocal: [], conflicts: [], newFields, leftOut: map.filter((m) => m.target === T_SKIP && m.header.trim()).map((m) => m.header.trim()), dupes: [], notes, fileValues: {} };
  const inFile = new Set<string>();
  for (const row of rows) {
    const v = tidy(page, rowValues(map, keys, row));
    if (!Object.values(v).some((x) => x.trim())) continue;
    const id = idCol !== undefined ? (row[idCol] ?? "").trim() : "";
    const rec = id ? byId.get(id) : undefined;
    if (!rec) {
      const flags = uncertainties(page.kind, v);
      out.added.push({ id: newId("r"), v, ...(Object.keys(flags).length ? { flags } : {}) });
      continue;
    }
    if (inFile.has(id)) { out.dupes.push(recordName(page, rec) || id); continue; }
    inFile.add(id);
    out.fileValues[id] = v;
    const changed: FieldChange[] = [];
    const kept: FieldChange[] = [];
    for (const [k, incoming] of Object.entries(v)) {
      const local = rec.v[k] ?? "";
      const base = rec.base ? rec.base[k] ?? "" : local;
      if (incoming === local) continue;
      const localEdited = local !== base;
      const fileEdited = incoming !== base;
      if (fileEdited && !localEdited) changed.push({ key: k, label: label(k), from: local, to: incoming });
      else if (localEdited && !fileEdited) kept.push({ key: k, label: label(k), from: base, to: local });
      else out.conflicts.push({ id, name: recordName(page, rec), key: k, label: label(k), local, incoming });
    }
    if (changed.length) out.changed.push({ id, name: recordName(page, rec), fields: changed });
    if (kept.length) out.keptLocal.push({ id, name: recordName(page, rec), fields: kept });
  }
  // Only a file that carries ids can say a row was removed; a file without them adds, never removes.
  if (idCol !== undefined) {
    for (const r of page.records) {
      if (inFile.has(r.id) || !r.base) continue;
      const edited = Object.keys({ ...r.v, ...r.base }).some((k) => (r.v[k] ?? "") !== (r.base![k] ?? ""));
      if (edited) out.conflicts.push({ id: r.id, name: recordName(page, r), key: "@removed", label: "Removed in the File", local: "Keep", incoming: "Remove" });
      else out.removed.push({ id: r.id, name: recordName(page, r) });
    }
  }
  return out;
}

export function changeCount(c: Changes): number {
  return c.added.length + c.changed.length + c.removed.length + c.conflicts.length + c.newFields.length;
}

/** Applies a reviewed reimport. `choose` answers each conflict ("local" keeps the page, "incoming" takes the file);
 *  an unanswered conflict keeps the page. The page is snapshotted first, and the result is the new base. */
export function applyReconcile(page: PageData, c: Changes, choose: Record<string, "local" | "incoming">, now: number): PageData {
  let next = takeSnapshot(page, "reimport", now);
  const removeIds = new Set(c.removed.map((r) => r.id));
  for (const x of c.conflicts) if (x.key === "@removed" && choose[conflictKey(x)] === "incoming") removeIds.add(x.id);
  const patch = new Map<string, Record<string, string>>();
  for (const ch of c.changed) patch.set(ch.id, Object.fromEntries(ch.fields.map((f) => [f.key, f.to])));
  for (const x of c.conflicts) {
    if (x.key === "@removed" || choose[conflictKey(x)] !== "incoming") continue;
    patch.set(x.id, { ...(patch.get(x.id) ?? {}), [x.key]: x.incoming });
  }
  next = {
    ...next,
    fields: [...next.fields, ...c.newFields],
    records: [
      ...next.records.filter((r) => !removeIds.has(r.id)).map((r) => {
        const p = patch.get(r.id);
        const fileV = c.fileValues[r.id];
        // The file is now what Sheets holds: its values are the ancestor the next reimport compares against, so a
        // local edit the file did not touch still reads as local next time.
        const base = fileV ? { ...(r.base ?? {}), ...fileV } : r.base;
        if (!p) return base ? { ...r, base } : r;
        const flags = r.flags ? { ...r.flags } : undefined;
        if (flags) for (const k of Object.keys(p)) delete flags[k];
        const out: PageRecord = { ...r, v: { ...r.v, ...p }, ...(base ? { base } : {}) };
        if (flags && Object.keys(flags).length) out.flags = flags; else delete out.flags;
        return out;
      }),
      ...c.added.map((r) => ({ ...r, base: { ...r.v } })),
    ],
  };
  return next;
}
