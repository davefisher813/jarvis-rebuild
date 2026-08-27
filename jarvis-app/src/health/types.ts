// HEALTH: Student-athlete health track (catalog: claude/HEALTH_CATALOG.md).
//
// PART 0, the one design law this whole module obeys: LOG EVENTS, NOT STATES.
// Every entity below is a record of something that happened in the world
// (a tap, a timestamp, a location), never an inference about how the athlete
// is doing. There is no "how are you feeling" field anywhere in here.
//
// PART 9, the safety rails, made structural rather than a promise:
//   1. No composite score of a person. Nothing in this file, or anywhere
//      under src/health, may declare a field like readiness/recovery/
//      wellness/healthScore. src/laws/healthPrivacy.test.ts scans the whole
//      module for that vocabulary so a "just this once" field cannot land.
//   2. No count of failures. The logged shapes below carry timestamps, never
//      a target or an expected count to fall short of, so "N missed" is not
//      just discouraged, it has nothing to compute itself FROM.
//   3. No calorie, macro, weight, or body-composition field, schema-level.
//      Ate Before is a boolean tied to a calendar event; there is no amount,
//      no quality, no number anywhere near food.
//   4. No named diagnosis. Point At It stores a location, nothing else.
//
// ENTITY NAMING mirrors gym/types.ts and categories/types.ts: one ENTITY_*
// const per Store-backed shape, a *Data interface for what lives in the
// item, and a wrapper interface pairing it with an id.

export const ENTITY_HEALTH_CONSENT = "health_consent";
export const ENTITY_LIGHTS_OUT = "health_lights_out";
export const ENTITY_ATE_BEFORE = "health_ate_before";
export const ENTITY_TOOK_IT = "health_took_it";
export const ENTITY_CALL_IT = "health_call_it";
export const ENTITY_POINT_AT_IT = "health_point_at_it";

// The categories the Share Line lists and the athlete controls. "logistics"
// is the one category defaulted ON (Part 7: "off by default for everything
// except logistics"): rides, times, forms, and medication REFILL logistics
// carry no body data at all, so there is nothing for the athlete to protect.
export type HealthCategoryId = "sleep" | "load" | "fuel" | "medication" | "body" | "logistics";

// THE KID'S ROOM (Part 7). A category id that can NEVER be shared, regardless
// of settings, plan tier, or parent request. Deliberately a DIFFERENT type
// from HealthCategoryId, not a value inside it: a function that only accepts
// HealthCategoryId cannot be handed a Kid's Room id by the type checker, so
// the hard rule holds at compile time and not only at runtime. Nothing in
// this module logs against these categories today (mood/cycle/private notes
// are catalog items marked "Build later"), but the ids exist now so the
// Share Line can name the floor before there is anything to protect.
export type KidRoomCategoryId = "mind" | "cycle" | "notes";

// One grant per category, owned by the athlete. Revocable at any time; each
// change is a new timestamp, never a silent overwrite, so "what did I share
// and when" is always answerable from this alone.
export interface ConsentGrant {
  category: HealthCategoryId;
  granted: boolean;
  updatedAt: number; // epoch ms of the last change (grant or revoke)
}

export interface ConsentGrantsData {
  grants: ConsentGrant[];
}
export interface ConsentGrants {
  id: string;
  data: ConsentGrantsData;
}

// ---- The five one-tap loggers ----
//
// Every one of these carries its own `category` field so the exact same
// filtering function that decides what a parent may see (shareLine.ts,
// sharedView) can run directly over a list of logged entries with no second
// lookup table to keep in sync.

/** Lights Out (Part 1). One tap, one timestamp, marks the night's end.
 *  Nothing is scored: there is no duration field here on purpose, because a
 *  duration invites a target, and a target is how this becomes a ring. */
export interface LightsOutData {
  category: "sleep";
  at: number; // epoch ms of the tap
}
export interface LightsOutEntry {
  id: string;
  data: LightsOutData;
}

/** Ate Before (Part 3). Attached to a calendar practice/game. One tap,
 *  yes or no. No food, no amount, no quality judgment: `ate` is the only
 *  content field, deliberately a boolean and nothing richer. */
export interface AteBeforeData {
  category: "fuel";
  eventId?: string; // the calendar event this answers, when there is one
  eventTitle?: string;
  date: string; // local ISO day the practice/game fell on
  ate: boolean;
  at: number;
}
export interface AteBeforeEntry {
  id: string;
  data: AteBeforeData;
}

/** Took It (Part 4). One tap, offline, timestamped by the tap itself, never
 *  by the schedule. There is no `scheduledAt` or `expected` field: with no
 *  expectation stored, "you missed N doses" has nothing to be computed from,
 *  which is the schema doing the safety rail's work instead of a promise. */
export interface TookItData {
  category: "medication";
  at: number;
}
export interface TookItEntry {
  id: string;
  data: TookItData;
}

/** Call It (Part 2). End-of-session exertion, one tap on a 0-10 scale.
 *  This is session-RPE: `rpe` feeds Week Shape and nothing else, per the
 *  catalog ("must never aggregate into a readiness verdict"). No derived
 *  field, no rolling average, lives anywhere near this shape. */
export interface CallItData {
  category: "load";
  eventId?: string; // the practice/game this session was, when there is one
  durationMin?: number; // auto-filled from the calendar event when present
  rpe: number; // 0-10, integer
  at: number;
}
export interface CallItEntry {
  id: string;
  data: CallItData;
}

/** Point At It (Part 6). A body-map tap: location only. No severity scale,
 *  no diagnosis, no condition name, ever, anywhere in this shape. x/y are
 *  normalized 0-1 coordinates within the body map's drawing area. */
export interface PointAtItData {
  category: "body";
  x: number;
  y: number;
  side: "front" | "back";
  at: number;
}
export interface PointAtItEntry {
  id: string;
  data: PointAtItData;
}
