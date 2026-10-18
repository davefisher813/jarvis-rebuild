// Small formatting for the Hub's facts lines. Times are the person's zone,
// 12-hour (the clock law); days are Today, Yesterday or the short date.
//
// 2026-10-05 (catalog gate, R6 and the clock law): this file used to export
// `facts(...)`, which joined a line with a middle dot, and every Hub screen
// drew that string inside one .fact or .conn-meta, so a row's facts were one
// grey run with the separator baked in. It is gone: a line is a list of
// facts (HubFacts.tsx) and the stylesheet draws the dot. timeOf also used the
// device locale, which is 24-hour in half the world; the clock law says
// 12-hour with AM/PM, so it is pinned.

import { shortDate } from "../shared/dateFormat";
import { titleCase } from "../shared/casing";
import type { HubOverview } from "./hubClient";
import { clock12 } from "../shared/clock";

export function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return clock12(d);
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return shortDate(iso.slice(0, 10));
}

/** "Today · 9:12 AM". Still read by email/ (AccountsScreen draws it inside a .fact, which bakes a dot into a facts line, R6): those call sites should use whenFacts. Not changed here because email/format.test.ts pins this exact string. */
export function whenLine(iso: string, now: Date = new Date()): string {
  const day = dayLabel(iso, now);
  const t = timeOf(iso);
  return day && t ? `${day} · ${t}` : day || t;
}

/** A moment as two neutral date facts, "Today" then "9:12 AM" (R8: a neutral
 *  date or time on a row is small caps, and the CSS draws the dot between). */
export function whenFacts(iso: string, now: Date = new Date()): Array<{ text: string; tone: "date" }> {
  return [dayLabel(iso, now), timeOf(iso)].filter((t) => t.length > 0).map((text) => ({ text, tone: "date" as const }));
}

/** What the person typed, as the Hub SHOWS it (Dave, 2026-09-26: "His own typed
 *  titles ... are SHOWN in Title Case everywhere. What he typed is stored
 *  unchanged; only the display is re-cased"). The overview is read-only view
 *  data, so the names and titles in it are re-cased once, here, and no write
 *  reads them back: a proposal's payload (which Keep as Note stores) is left
 *  exactly as it came (2026-10-05, the visual-catalog gate, casing rule). */
export function shownOverview(o: HubOverview): HubOverview {
  const t = (s: string | null): string | null => (s ? titleCase(s) : s);
  return {
    ...o,
    connections: o.connections.map((c) => ({ ...c, display_name: titleCase(c.display_name), project_title: t(c.project_title), grants: c.grants.map((g) => ({ ...g, project_title: t(g.project_title) })) })),
    projects: o.projects.map((p) => ({ ...p, title: titleCase(p.title) })),
    decisions: o.decisions.map((d) => ({ ...d, title: titleCase(d.title) })),
    exploration_notes: o.exploration_notes.map((n) => ({ ...n, text: titleCase(n.text) })),
  };
}

/** A string some other layer joined with " · " (a receipt's scope, an actor
 *  line), cut back into the parts it was joined from, so each is its own fact. */
export function dotParts(s: string | null | undefined): string[] {
  return (s ?? "").split("·").map((p) => p.trim()).filter((p) => p.length > 0);
}

// RECEIPTS SPEAK IN WORDS (Dave 2026-10-15, items 4 and 5: a receipt showed a stored field name, "None", raw JSON and "13:30 to
// 14:00"). What a receipt stores is the system's own record; what it SHOWS is read through these, once, at the screen.

const ISO_STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const ISO_DAY = /\b\d{4}-\d{2}-\d{2}\b/g;
const CLOCK_24 = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b(?!\s?[AP]M)/g;

/** A stored line as the person reads it: a timestamp as its day and 12-hour time, a bare day as a short date, a 24-hour clock as
 *  AM or PM. Older receipts were written before the writers spelled it this way, so nothing is trusted to arrive already read. */
export function humanTimes(text: string): string {
  return text
    .replace(ISO_STAMP, (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : `${shortDate(s.slice(0, 10))}, ${clock12(d)}`; })
    .replace(ISO_DAY, (s) => shortDate(s))
    .replace(CLOCK_24, (s) => clock12(s) || s);
}

/** "issuer" or "due_date" as "Issuer" or "Due Date": the stored field name, said as a label. */
export function fieldLabel(field: string): string {
  return titleCase(field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.\-]+/g, " "));
}

/** A stored value in words, or null where there is nothing to say (a receipt never prints "None"). An object is said as its own
 *  "Label: value" parts and a list as its items, never as JSON. */
export function receiptValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() ? humanTimes(v.trim()) : null;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) { const parts = v.map(receiptValue).filter((x): x is string => x !== null); return parts.length ? parts.join(", ") : null; }
  if (typeof v === "object") {
    const parts = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => { const w = receiptValue(x); return w === null ? null : `${fieldLabel(k)}: ${w}`; })
      .filter((x): x is string => x !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}
