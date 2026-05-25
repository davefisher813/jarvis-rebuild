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
  calendar: boolean;
  onboarded: boolean;
}

export const EMPTY_PROFILE: ProfileData = {
  name: "",
  template: "personal",
  people: [],
  gmail: false,
  calendar: false,
  onboarded: false,
};
