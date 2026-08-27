// THE BAG, WATER WITH YOU IS A ROW INSIDE IT (catalog Part 3). A
// pre-departure checklist bound to a calendar event. Pure logic: default
// item set, and reading the checklist's latest logged state back out of an
// append-only entry list (each tap logs the FULL state, per HealthService's
// logBagCheck, so "latest wins" is how a screen reads current status --
// the same idiom AteBefore already uses for "what was the last answer").

import type { BagCheckEntry, BagItemState } from "./types";

export interface BagItemDef {
  key: string;
  label: string;
}

// Water With You is a ROW inside The Bag, never its own feature (catalog
// Part 3): object-level ("is the bottle in the bag"), no volume, no ounces.
export const BAG_ITEMS: BagItemDef[] = [
  { key: "water", label: "Water Bottle" },
  { key: "snack", label: "Snack" },
  { key: "gear", label: "Gear" },
  { key: "mouthguard", label: "Mouthguard" },
  { key: "inhaler", label: "Inhaler" },
  { key: "form", label: "The Form" },
];

export function defaultBagItems(): BagItemState[] {
  return BAG_ITEMS.map((d) => ({ key: d.key, checked: false }));
}

/** The most recently logged checklist state for one calendar event, or null
 *  if nothing has been logged against it yet. */
export function latestBagCheck(entries: BagCheckEntry[], eventId: string): BagCheckEntry | null {
  const forEvent = entries.filter((e) => e.data.eventId === eventId);
  if (forEvent.length === 0) return null;
  return forEvent.reduce((a, b) => (b.data.at > a.data.at ? b : a));
}

export function toggleItem(items: BagItemState[], key: string): BagItemState[] {
  return items.map((i) => (i.key === key ? { ...i, checked: !i.checked } : i));
}

export function checkAll(items: BagItemState[]): BagItemState[] {
  return items.map((i) => ({ ...i, checked: true }));
}

export function allChecked(items: BagItemState[]): boolean {
  return items.length > 0 && items.every((i) => i.checked);
}
