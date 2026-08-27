// THE SHARE LINE (Part 7). Consent infrastructure. Ships before anything
// else in this module, because everything else depends on it: no health
// screen renders a parent-facing view without first asking this file who is
// allowed to see what.
//
// Pure domain logic, no Store. HealthService persists ConsentGrant[]; every
// function here operates on the array it hands back, so the rules are
// testable without a database and reusable from a future parent-side screen
// without dragging the Store along.

import type { ConsentGrant, HealthCategoryId, KidRoomCategoryId } from "./types";

export const HEALTH_CATEGORIES: HealthCategoryId[] = ["sleep", "load", "fuel", "medication", "body", "logistics"];

// THE KID'S ROOM. Never rendered as a toggle, never accepted by setGrant
// below (the parameter type is HealthCategoryId, which this is not), and
// hard-excluded in sharedView regardless of what a grants array claims.
export const KID_ROOM_CATEGORIES: KidRoomCategoryId[] = ["mind", "cycle", "notes"];

export const HEALTH_CATEGORY_LABEL: Record<HealthCategoryId, string> = {
  sleep: "Sleep",
  load: "Training Load",
  fuel: "Fuel",
  medication: "Medication",
  body: "Body Signals",
  logistics: "Rides, Times, and Forms",
};

export const HEALTH_CATEGORY_DESC: Record<HealthCategoryId, string> = {
  sleep: "Lights Out, the time each night ends",
  load: "Call It, how hard a session felt",
  fuel: "Ate Before, whether food happened around practice",
  medication: "Took It, timestamps only, never a count",
  body: "Point At It, where something is felt",
  logistics: "Rides, forms, and medication refill logistics only, never the medication itself",
};

export const KID_ROOM_LABEL: Record<KidRoomCategoryId, string> = {
  mind: "Mood and Mind",
  cycle: "Cycle",
  notes: "Private Notes",
};

// Off by default for everything except pure logistics, per Part 7. Logistics
// carries no body data (rides, times, forms, medication refill logistics,
// never medication content), so there is nothing there for the athlete to
// protect by leaving it off.
export const DEFAULT_GRANTED: Record<HealthCategoryId, boolean> = {
  sleep: false,
  load: false,
  fuel: false,
  medication: false,
  body: false,
  logistics: true,
};

export function defaultGrants(now: number): ConsentGrant[] {
  return HEALTH_CATEGORIES.map((category) => ({ category, granted: DEFAULT_GRANTED[category], updatedAt: now }));
}

export function isKidRoomId(id: string): id is KidRoomCategoryId {
  return (KID_ROOM_CATEGORIES as string[]).includes(id);
}

function grantOf(grants: ConsentGrant[], category: HealthCategoryId): boolean {
  return grants.find((g) => g.category === category)?.granted ?? DEFAULT_GRANTED[category];
}

// Revocable at any time, one tap, no negotiation screen. Category is typed
// as HealthCategoryId, so a Kid's Room id is a compile error here, not a
// runtime check someone could skip.
export function updateGrant(grants: ConsentGrant[], category: HealthCategoryId, granted: boolean, now: number): ConsentGrant[] {
  const rest = grants.filter((g) => g.category !== category);
  return [...rest, { category, granted, updatedAt: now }].sort(
    (a, b) => HEALTH_CATEGORIES.indexOf(a.category) - HEALTH_CATEGORIES.indexOf(b.category),
  );
}

// THE WHOLE POINT. Filters a list of logged entries down to what a parent
// (or, on the athlete's own "What They See" screen, the athlete looking at
// that exact same filter) is allowed to see. Two independent gates, and the
// second one cannot be turned off by any grant:
//
//   1. The category must carry an explicit `granted: true` entry.
//   2. The category must NOT be a Kid's Room id. This check runs regardless
//      of what is in `grants` -- even a corrupted or hand-edited grants
//      array claiming a Kid's Room category is "granted" cannot make it
//      appear here, because Kid's Room ids are checked by isKidRoomId(),
//      never by looking them up in the grants list at all.
//
// Generic over any item shaped like { data: { category: string } }, which is
// exactly the shape of every logger entry in types.ts (LightsOutEntry,
// AteBeforeEntry, ...), so this one function is what a real parent-facing
// screen will call too, not a stand-in for it.
export function sharedView<T extends { data: { category: string } }>(items: T[], grants: ConsentGrant[]): T[] {
  const granted = new Set(grants.filter((g) => g.granted).map((g) => g.category));
  return items.filter((item) => {
    const cat = item.data.category;
    if (isKidRoomId(cat)) return false; // the floor. Not negotiable by any grant.
    return granted.has(cat as HealthCategoryId);
  });
}

// Which categories are currently shared, for rendering a summary line on
// "What They See" ("Sharing: Fuel, Medication" or "Nothing is shared yet").
export function sharedCategoryLabels(grants: ConsentGrant[]): string[] {
  return HEALTH_CATEGORIES.filter((c) => grantOf(grants, c) && c !== "logistics").map((c) => HEALTH_CATEGORY_LABEL[c]);
}
