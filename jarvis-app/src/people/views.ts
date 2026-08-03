import type { Person } from "./types";

// The person views (person pass, 2026-08-03). Inner Circle and Adversarial
// stopped being folders and became views over per-person facts, because the
// exclusive-bucket model could not express a person who is close AND
// difficult. Pure functions; the flow applies them.

export type PeopleView = "contacts" | "inner_circle" | "adversarial";

/**
 * Inner Circle = everyone marked casual. Legacy members (group inner_circle,
 * register never set) are included SILENTLY: marking someone casual mirrors
 * exactly what putting them in Inner Circle meant, so this is faithful, not a
 * behavior change.
 */
export function isInnerCircle(p: Person): boolean {
  if (p.data.register === "casual") return true;
  return p.data.register === undefined && p.data.group === "inner_circle";
}

/**
 * Adversarial = everyone explicitly flagged, PLUS legacy group members
 * pending review. Legacy members are NOT flagged automatically: the flag now
 * drives a register lock (how the app writes to them), and changing that
 * silently for people filed loosely long ago needs a consent moment.
 */
export function isAdversarial(p: Person): boolean {
  return p.data.flagged === true || needsAdversarialReview(p);
}

/** Legacy adversarial-group member whose flag was never confirmed or cleared. */
export function needsAdversarialReview(p: Person): boolean {
  return p.data.flagged === undefined && p.data.group === "adversarial";
}

export function inView(view: PeopleView, p: Person): boolean {
  if (view === "inner_circle") return isInnerCircle(p);
  if (view === "adversarial") return isAdversarial(p);
  return true; // contacts = everyone
}

/** Case-insensitive people search over name and label. */
export function searchPeople(people: Person[], q: string): Person[] {
  const t = q.trim().toLowerCase();
  if (!t) return people;
  return people.filter(
    (p) =>
      p.data.name.toLowerCase().includes(t) ||
      (p.data.relationship ?? "").toLowerCase().includes(t),
  );
}

// Contact identity has been hiding in free-text notes since the vCard import
// folded EMAIL/TEL into note lines. Lift an email out when exactly ONE
// email-shaped token exists; ambiguity means we extract nothing (accuracy:
// the wrong email on a person is worse than none).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function extractEmailFromNotes(notes: string | undefined): string | null {
  if (!notes) return null;
  const found = [...new Set(notes.match(EMAIL_RE) ?? [])];
  return found.length === 1 ? found[0]! : null;
}

// The universal label chips (v1). Kind-aware sets arrive when category kinds
// exist; free text always available underneath.
export const LABEL_CHIPS = ["Family", "Friend", "Partner", "Coworker", "Client", "Boss", "Coach"] as const;
