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

export function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
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
