import type { TemplateKey } from "../categories/defaults";

// One per-user profile record, written by onboarding and read across the app
// (greeting, avatar, which template's categories to seed, setup status).
export const ENTITY_PROFILE = "profile";

export interface ProfileData {
  name: string;
  template: TemplateKey;
  people: string[];
  briefTime?: string;
  tabs?: string[];
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
  priority?: string;
  onboarded: boolean;
  // Money v1: payday anchoring (Personal template only; Business cash flow is
  // lumpy and Student mostly has no paycheck, so the line simply doesn't
  // render there). amount = one paycheck; next = an upcoming payday date the
  // math advances from by freq.
  payday?: { amount: number; next: string; freq: "weekly" | "biweekly" | "monthly" };
}

export const EMPTY_PROFILE: ProfileData = {
  name: "",
  template: "personal",
  people: [],
  gmail: false,
  calendar: false,
  onboarded: false,
};
