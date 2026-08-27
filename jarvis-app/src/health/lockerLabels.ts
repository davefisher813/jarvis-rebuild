import type { LockerDocKind } from "./types";

// Kept in its own file so the reason for "Baseline Test" (rather than the
// catalog's own phrase for what it is a baseline OF) sits next to the one
// place it is written: src/laws/healthPrivacy.test.ts bans that diagnosis
// word anywhere in this module, by design (rail 4, no named diagnosis
// ever). Storing paperwork FOR a thing is not diagnosing the athlete, but
// the check is a blunt text scan, and the safer, still-accurate label is a
// one-line cost against a real safety rail, so it stays generic here.
export const LOCKER_DOC_LABEL: Record<LockerDocKind, string> = {
  physical: "Physical",
  insurance: "Insurance Card",
  baseline: "Baseline Test",
  exception: "Medical Exception Paperwork",
  waiver: "Waiver",
};
