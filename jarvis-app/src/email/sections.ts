// THE MAIL HOME'S FIVE SECTIONS (Email v1 spec 2026-10-08 sections 2.2, 3.1,
// 3.2, 3.3; Dave's ruling 2026-10-12: the five fixed sections, expanded, empty
// ones omitted, with All by Date beside them, remembered per device; not AI
// buckets). One primary section per message, decided here and nowhere else, by
// the spec's resolver in its order:
//
//   1. the person's own Move to Section for this message;
//   2. Conversations: this account's cached thread holds a SENT message from
//      one of Dave's own addresses (own_reply, migration 0067's email_inbox);
//      a contact match alone never qualifies;
//   3. Schedule: calendar MIME structure: the message is text/calendar, its
//      Content-Class is a calendar message, or it carries a text/calendar or
//      .ics part (known once opened, or on arrival for Google Calendar mail
//      by the sync's parts-only probe, api/_email.ts). Never a subject
//      word like "meeting";
//   4. Money: an exact registered sender, account and format template with
//      invoice, receipt or statement semantics (moneyRegistry.ts, list-time
//      from address and subject only, so it holds before the message is
//      opened). An unregistered sender, a currency sign, a filename, or two
//      templates at once (ambiguous) never resolves here;
//   5. Mailing Lists: a List-Unsubscribe or List-ID header;
//   6. Other: everything else, including a row cached before the facts were
//      kept (it has nothing to go on).
//
// Nothing here archives, marks, labels or hides: every loaded row is in exactly
// one section, and All by Date shows the same rows without the grouping.

import type { InboxRow } from "./emailClient";
import { matchMoney } from "./moneyRegistry";

export const SECTION_KEYS = ["conversations", "schedule", "money", "lists", "other"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_NAME: Record<SectionKey, string> = {
  conversations: "Conversations",
  schedule: "Schedule",
  money: "Money",
  lists: "Mailing Lists",
  other: "Other",
};

/**
 * Each heading's colour, a category slot (components.css .cat-fg-*, readable ink in both themes, held by the colour laws).
 * The spec's §15 accents by meaning: purple for people, sky for Schedule, teal for Money; Mailing Lists takes indigo, a
 * slot no other meaning here uses; Other stays the heading grey. Never red: red is a verb.
 */
export const SECTION_SLOT: Record<SectionKey, string | null> = {
  conversations: "purple",
  schedule: "sky",
  money: "teal",
  lists: "indigo",
  other: null,
};

type Facts = Pick<InboxRow, "attachment_metadata" | "mime_type" | "content_class" | "list_id" | "list_unsubscribe" | "own_reply"> & Partial<Pick<InboxRow, "from_address" | "subject">>;

const CALENDAR_MIME = new Set(["text/calendar", "application/ics"]);

/** Calendar MIME structure, never words. */
export function isCalendar(r: Facts): boolean {
  if (r.mime_type && CALENDAR_MIME.has(r.mime_type.toLowerCase())) return true;
  if (r.content_class && /calendarmessage/i.test(r.content_class)) return true;
  return (r.attachment_metadata ?? []).some((a) => CALENDAR_MIME.has((a.mime || "").toLowerCase()) || /\.ics$/i.test(a.filename || ""));
}

/** List-Unsubscribe or List-ID, parsed: a header with something in it. */
export function isMailingList(r: Facts): boolean {
  return !!(r.list_id && r.list_id.trim()) || !!(r.list_unsubscribe && r.list_unsubscribe.trim());
}

/**
 * Money: exactly one registered sender template matches this message's from address and subject (spec 3.2 rule 4,
 * 5.2). A currency sign or a filename, which the spec calls insufficient, is never read.
 */
export function isRegisteredMoney(r: Facts): boolean {
  return matchMoney(r).kind === "match";
}

export type Overrides = Record<string, SectionKey>;

/** The one primary section for a row. */
export function sectionOf(r: Facts & Pick<InboxRow, "id">, overrides: Overrides = {}): SectionKey {
  const o = overrides[r.id];
  if (o && (SECTION_KEYS as readonly string[]).includes(o)) return o;
  if (r.own_reply === true) return "conversations";
  if (isCalendar(r)) return "schedule";
  if (isRegisteredMoney(r)) return "money";
  if (isMailingList(r)) return "lists";
  return "other";
}

export interface Section { key: SectionKey; rows: InboxRow[] }

/** The loaded rows grouped in the fixed order, each keeping the given order (newest first). Empty sections are omitted. */
export function groupSections(rows: readonly InboxRow[], overrides: Overrides = {}): Section[] {
  const by = new Map<SectionKey, InboxRow[]>();
  for (const r of rows) {
    const k = sectionOf(r, overrides);
    const list = by.get(k) ?? [];
    list.push(r);
    by.set(k, list);
  }
  return SECTION_KEYS.filter((k) => by.has(k)).map((k) => ({ key: k, rows: by.get(k)! }));
}

/** "12 Loaded": what is on the phone, never a claim about the whole mailbox (3.1). */
export function loadedWord(n: number): string {
  return `${n} Loaded`;
}

// ---- Same Content (3.3) -------------------------------------------------------

/** The RFC Message-ID as a comparable key: the angle brackets and case of the domain do not make two messages differ, nothing else is normalised. */
function idKey(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  return t.replace(/^<|>$/g, "");
}

/**
 * For each loaded row whose exact Message-ID another CONNECTED account also holds in the loaded rows, the other
 * account addresses. Exact header match only, never subject, sender or time; a row without a cached Message-ID is
 * never matched. A label only: both rows stay, each separately actionable, and this never feeds selection or hiding.
 */
export function sameContent(rows: readonly Pick<InboxRow, "id" | "account" | "rfc_message_id">[]): Record<string, string[]> {
  const by = new Map<string, Pick<InboxRow, "id" | "account">[]>();
  for (const r of rows) {
    const k = idKey(r.rfc_message_id);
    if (!k) continue;
    const list = by.get(k) ?? [];
    list.push(r);
    by.set(k, list);
  }
  const out: Record<string, string[]> = {};
  for (const list of by.values()) {
    for (const r of list) {
      const others = [...new Set(list.filter((x) => x.account !== r.account).map((x) => x.account))];
      if (others.length) out[r.id] = others;
    }
  }
  return out;
}

// ---- what this device remembers ---------------------------------------------------

type Store = Pick<Storage, "getItem" | "setItem">;
export type HomeView = "grouped" | "date";

const viewKey = (userId: string) => `jarvis.email.homeView.v1:${userId}`;
const overridesKey = (userId: string) => `jarvis.email.sectionOverride.v1:${userId}`;

/** Grouped or All by Date, as this device last chose. Grouped is the spec's default. */
export function loadView(userId: string, storage: Store | null = typeof localStorage !== "undefined" ? localStorage : null): HomeView {
  try {
    return storage?.getItem(viewKey(userId)) === "date" ? "date" : "grouped";
  } catch { return "grouped"; }
}

export function saveView(userId: string, view: HomeView, storage: Store | null = typeof localStorage !== "undefined" ? localStorage : null): void {
  try { storage?.setItem(viewKey(userId), view); } catch { /* private mode: the choice lasts the visit */ }
}

/** Move to Section, per message, on this device. */
export function loadOverrides(userId: string, storage: Store | null = typeof localStorage !== "undefined" ? localStorage : null): Overrides {
  try {
    const raw = JSON.parse(storage?.getItem(overridesKey(userId)) || "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Overrides = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v)) out[k] = v as SectionKey;
    return out;
  } catch { return {}; }
}

export function moveToSection(userId: string, id: string, key: SectionKey | null, storage: Store | null = typeof localStorage !== "undefined" ? localStorage : null): Overrides {
  const next = { ...loadOverrides(userId, storage) };
  if (key) next[id] = key; else delete next[id];
  try { storage?.setItem(overridesKey(userId), JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

// ---- the moves, listed (Settings, Email Sections; 2026-10-12) ----------------------

/** What a move remembers about its message so Settings can name it without the inbox loaded: never a body, only the row's
 *  own subject and sender, which are already on this device. */
export interface MoveInfo { subject: string; from: string; at: string }
export interface SectionMove { id: string; key: SectionKey; subject: string | null; from: string | null; at: string | null }

const moveInfoKey = (userId: string) => `jarvis.email.sectionMoveInfo.v1:${userId}`;

function loadMoveInfo(userId: string, storage: Store | null): Record<string, MoveInfo> {
  try {
    const raw = JSON.parse(storage?.getItem(moveInfoKey(userId)) || "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, MoveInfo>) : {};
  } catch { return {}; }
}

/** Move to Section from the Email tab: the override, and the words Settings will name it by. Null puts it back. */
export function recordMove(userId: string, row: Pick<InboxRow, "id" | "subject" | "from_name" | "from_address">, key: SectionKey | null,
  now: Date = new Date(), storage: Store | null = typeof localStorage !== "undefined" ? localStorage : null): Overrides {
  const next = moveToSection(userId, row.id, key, storage);
  const info = { ...loadMoveInfo(userId, storage) };
  if (key) info[row.id] = { subject: row.subject, from: row.from_name.trim() || row.from_address, at: now.toISOString() };
  else delete info[row.id];
  try { storage?.setItem(moveInfoKey(userId), JSON.stringify(info)); } catch { /* private mode */ }
  return next;
}

/** Every move on this device, newest first. A move made before its words were kept has no subject; `known` (the device's
 *  cached inbox rows) names it when it can. */
export function listMoves(userId: string, known: readonly Pick<InboxRow, "id" | "subject" | "from_name" | "from_address">[] = [],
  storage: Store | null = typeof localStorage !== "undefined" ? localStorage : null): SectionMove[] {
  const info = loadMoveInfo(userId, storage);
  const rows = new Map(known.map((r) => [r.id, r]));
  return Object.entries(loadOverrides(userId, storage))
    .map(([id, key]) => {
      const i = info[id];
      const r = rows.get(id);
      return { id, key, subject: i?.subject ?? r?.subject ?? null, from: i?.from ?? (r ? r.from_name.trim() || r.from_address : null), at: i?.at ?? null };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "") || a.id.localeCompare(b.id));
}

/** Put Back: the message goes back to the section its own facts give it. */
export function putBack(userId: string, id: string, storage: Store | null = typeof localStorage !== "undefined" ? localStorage : null): Overrides {
  return recordMove(userId, { id, subject: "", from_name: "", from_address: "" }, null, new Date(), storage);
}
