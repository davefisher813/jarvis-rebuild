import type { Person } from "../../people/types";

/** Pure logic for the contact triage screen (Workstream D). Everything here
 *  is localStorage- or data-shaped; the writes themselves go through the
 *  existing PeopleService so triage never touches person rows directly. */

const CURSOR_KEY = "jarvis.brain.triage.cursor.v1";

/** Title Case labels for the fixed triage role chips (BRAIN_ROLES in the
 *  shared contract). A value outside the set falls back to itself. */
export function brainRoleLabel(role: string): string {
  switch (role) {
    case "family": return "Family";
    case "friend": return "Friend";
    case "work": return "Work";
    case "bridge": return "Bridge";
    case "vendor": return "Vendor";
    case "other": return "Other";
    default: return role;
  }
}

/** Where a person row came from, in the app's words. */
export function personSourceLabel(source?: string): string {
  switch (source) {
    case "email": return "Email";
    case "calendar": return "Calendar";
    case "event": return "Event";
    case "import": return "Import";
    case "manual": return "Added by You";
    default: return "Import";
  }
}

/** The triage source for a row: its recorded source, or, for a row that
 *  predates triage, "import" when it carries an import's source id and
 *  "manual" when it does not. */
export function triageSource(p: Person): "email" | "calendar" | "event" | "import" | "manual" {
  const s = (p.data as { source?: string }).source;
  if (s === "email" || s === "calendar" || s === "event" || s === "import" || s === "manual") return s;
  return p.data.sourceUid ? "import" : "manual";
}

/** The brain-role strings on a row: the entries the per-area editor ignores. */
export function brainRolesOf(p: Person): string[] {
  const roles = (p.data as { roles?: unknown }).roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
}

/** A row is unsorted only when something says so: triage marked it
 *  unsorted (an import, a Who Is This? left open), or it predates triage
 *  and came in from an import (it carries the import's source id). Anyone
 *  added by hand counts as sorted (Dave 2026-09-28): he already said who
 *  they are by adding them. No migration backfills this; it is read here. */
export function isUnsorted(p: Person): boolean {
  const state = (p.data as { triageState?: string }).triageState;
  if (state === "sorted") return false;
  if (state === "unsorted" || state === "needsInfo") return true;
  return !!p.data.sourceUid || (p.data as { source?: string }).source === "import";
}

export function unsortedPeople(people: Person[]): Person[] {
  return people.filter(isUnsorted);
}

function guarded(key: "get" | "set" | "remove", value?: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    if (key === "get") return localStorage.getItem(CURSOR_KEY);
    if (value === undefined) localStorage.removeItem(CURSOR_KEY);
    else localStorage.setItem(CURSOR_KEY, value);
    return null;
  } catch {
    return null;
  }
}

/** Where the triage card left off: the id of the next card to show. */
export function readTriageCursor(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(CURSOR_KEY);
  } catch {
    return null;
  }
}

export function writeTriageCursor(id: string | null): void {
  guarded(id === null ? "remove" : "set", id ?? undefined);
}

/** "Mar 15", or "Mar 15, 2024" when the year is not this one. The decision
 *  row's date in the list's subline. */
export function formatFiledDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? `${months[d.getMonth()]} ${d.getDate()}` : `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
