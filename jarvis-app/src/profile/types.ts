import type { TemplateKey } from "../categories/defaults";

// One per-user profile record, written by onboarding and read across the app
// (greeting, avatar, which template's categories to seed, setup status).
export const ENTITY_PROFILE = "profile";

// (Audit 2026-08-10: two write-only fields removed. `people` duplicated names
// that onboarding materializes as real person entities; `priority` duplicated
// an answer that becomes a real task. Old records may still carry both in
// JSONB, harmlessly.)
export interface ProfileData {
  name: string;
  template: TemplateKey;
  briefTime?: string;
  tabs?: string[];
  // The chosen day cap (monthly report's one change, 2026-08-25): Plan My
  // Day seeds at most this many picks. His explicit word outranks the
  // evidence-derived offer; absent means no chosen cap.
  planCap?: number;
  gmail: boolean;
  connections?: Record<string, boolean>;
  // Multi-account Google (2026-08-04): the persisted account list. Tokens are
  // never stored; only who to re-auth and which features each account powers.
  googleAccounts?: { email: string; mail: boolean; cal: boolean }[];
  notify?: { overdue: boolean; events: boolean; goals: boolean; checkins?: boolean };
  // Open tracking on outgoing mail (2026-08-09). Default ON preserves what
  // the app always did; the point of the field is that it is now a VISIBLE
  // choice with an off switch and a privacy-policy line, not a silent one.
  trackOpens?: boolean;
  // ADHD check-ins: per-day answers keyed by ISO date. one = the pinned ONE
  // thing (task id), mood = evening answer, skip = question ids dismissed for
  // the day (never re-asked; the feature must not nag).
  checkin?: Record<string, { one?: string; mood?: string; skip?: string[] }>;
  calendar: boolean;
  onboarded: boolean;
  // Money v1: payday anchoring (Personal template only; Business cash flow is
  // lumpy and Student mostly has no paycheck, so the line simply doesn't
  // render there). amount = one paycheck; next = an upcoming payday date the
  // math advances from by freq.
  payday?: { amount: number; next: string; freq: "weekly" | "biweekly" | "monthly" };
  // AI Control (addendum items 18-22): master level + per-feature pins.
  // Absent means Draft Only (the default; also where onboarding Skip lands).
  // Stored on the profile so it syncs; mirrored into the levelStore singleton
  // and enforced server-side by the proxy, which reads THIS record.
  ai?: import("../ai/aiGate").AIControlState;
  // THE GREAT UNFILING (2026-08-30). Law 11 fixed note creation so a new note
  // is born unfiled, but every note written before that fix still carries the
  // category the bug picked for it -- catList[0], which for Dave is Family --
  // so his library stayed one uniform colour. This flag marks the one-time
  // cleanup as done. It rides the PROFILE rather than localStorage on purpose:
  // the cleanup is a change to synced data, so the record of having run it has
  // to sync too, or a second device would happily unfile everything again
  // after he had refiled it by hand.
  notesUnfiled?: boolean;
}

export const EMPTY_PROFILE: ProfileData = {
  name: "",
  template: "personal",
  gmail: false,
  calendar: false,
  onboarded: false,
};
