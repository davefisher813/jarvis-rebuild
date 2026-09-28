import type { Person } from "../../people/types";

/** Pure logic for the contact triage screen (Workstream D). Everything here
 *  is localStorage- or data-shaped; the writes themselves go through the
 *  existing PeopleService so triage never touches person rows directly. */

const CURSOR_KEY = "jarvis.brain.triage.cursor.v1";
const SETUP_KEY = "jarvis.brain.setup.v1";

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

/** The triage source for a row: its recorded source, or "import" when the
 *  row predates triage (the migration backfilled triageState only). */
export function triageSource(p: Person): "email" | "calendar" | "event" | "import" | "manual" {
  const s = (p.data as { source?: string }).source;
  return s === "email" || s === "calendar" || s === "event" || s === "import" || s === "manual" ? s : "import";
}

/** The brain-role strings on a row: the entries the per-area editor ignores. */
export function brainRolesOf(p: Person): string[] {
  const roles = (p.data as { roles?: unknown }).roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
}

/** A row is unsorted when triage never finished it: anything but "sorted",
 *  which is also what the migration backfilled, so old rows surface. */
export function isUnsorted(p: Person): boolean {
  return (p.data as { triageState?: string }).triageState !== "sorted";
}

export function unsortedPeople(people: Person[]): Person[] {
  return people.filter(isUnsorted);
}

/** Two rows are the same person when their normalized names match, or when
 *  a non-empty email matches exactly (case-insensitive). */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function emailOf(p: Person): string {
  const e = (p.data as { email?: unknown }).email;
  return typeof e === "string" ? e.trim().toLowerCase() : "";
}

export function duplicatesOf(p: Person, people: Person[]): Person[] {
  const name = normalizeName(p.data.name);
  const email = emailOf(p);
  return people.filter((q) => {
    if (q.id === p.id) return false;
    if (email && emailOf(q) === email) return true;
    const qn = normalizeName(q.data.name);
    return name.length > 1 && qn === name;
  });
}

/** Merge: the loser's notes join the survivor's (both kept, newest first is
 *  not assumed; concatenation in place), the loser row is deleted by the
 *  caller. */
export function mergedNotes(survivor: Person, loser: Person): string | undefined {
  const a = (survivor.data as { notes?: unknown }).notes;
  const b = (loser.data as { notes?: unknown }).notes;
  const sa = typeof a === "string" ? a.trim() : "";
  const sb = typeof b === "string" ? b.trim() : "";
  if (sa && sb) return `${sa}\n\n${sb}`;
  return sa || sb || undefined;
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

/** The "Set up your brain" card: dismissed once, hidden forever. */
export function setupCardDismissed(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(SETUP_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissSetupCard(): void {
  try {
    localStorage.setItem(SETUP_KEY, "1");
  } catch { /* a private-mode write that fails just means the card returns */ }
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
