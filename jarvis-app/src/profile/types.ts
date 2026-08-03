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
  notify?: { overdue: boolean; events: boolean; goals: boolean };
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
