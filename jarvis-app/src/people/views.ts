import type { Person } from "./types";

// Person-fact helpers. The Inner Circle / Adversarial LISTS were removed on
// 2026-08-03: a list only earns a surface when a feature acts on membership,
// and none did (they were shelves). The FACTS stayed: register drives how
// JARVIS writes to a person, flagged locks the register to guarded prose.
// People is one list with search; the facts live in each person's sheet.

/**
 * Legacy adversarial-group member whose flag was never confirmed or cleared.
 * The flag now changes how the app writes to a real person, so nobody filed
 * loosely long ago gets flagged silently: the list shows a consent card until
 * the user answers.
 */
export function needsAdversarialReview(p: Person): boolean {
  return p.data.flagged === undefined && p.data.group === "adversarial";
}

/**
 * Case-insensitive people search over every name this person goes by and
 * every role they hold.
 *
 * People handoff (2026-09-16): "Search names, aliases, roles". Searching
 * "Mom" had to find Linda Fisher, and searching "secretary" had to find
 * whoever that is -- which is most of the reason a person carries an alias
 * and a per-area role at all.
 */
export function searchPeople(people: Person[], q: string): Person[] {
  const t = q.trim().toLowerCase();
  if (!t) return people;
  const has = (v: string | undefined) => !!v && v.toLowerCase().includes(t);
  return people.filter(
    (p) =>
      has(p.data.name) ||
      has(p.data.relationship) ||
      (p.data.aliases ?? []).some(has) ||
      (p.data.roles ?? []).some((r) => has(r.role)) ||
      has(p.data.org) ||
      has(p.data.title),
  );
}

// Contact identity has been hiding in free-text notes since the vCard import
// folded EMAIL/TEL there. Lift an email out when exactly ONE email-shaped
// token exists; ambiguity means we extract nothing (accuracy: the wrong email
// on a person is worse than none).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function extractEmailFromNotes(notes: string | undefined): string | null {
  if (!notes) return null;
  const found = [...new Set(notes.match(EMAIL_RE) ?? [])];
  return found.length === 1 ? found[0]! : null;
}

// The universal label chips (v1). Kind-aware sets arrive when category kinds
// exist; free text always available underneath.
export const LABEL_CHIPS = ["Family", "Friend", "Partner", "Coworker", "Client", "Boss", "Coach"] as const;
