import type { Overlap } from "./dayEdit";

// KEEP BOTH (N5 completion, hotfix 2026-08-21). A clash the user has looked
// at and deliberately kept is a decision, not an emergency; the badge
// continuing to shout after "Keep Both" would be alarm with no meaning. The
// acknowledgement keys on both events' ids AND start times, so the moment
// either event moves the pair is a new question and the badge may return.
//
// localStorage, device-local by design: this is UI quieting, not data. Lost
// storage costs one repeated badge, never a lost event.

const KEY = "jarvis.overlap.kept.v1";
const CAP = 200;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function overlapKey(o: Overlap, date: string): string {
  return `${date}|${o.a.id}@${o.a.data.start}|${o.b.id}@${o.b.data.start}`;
}

function readKept(): string[] {
  const s = storage();
  if (!s) return [];
  try {
    const v = JSON.parse(s.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function isKept(o: Overlap, date: string): boolean {
  return readKept().includes(overlapKey(o, date));
}

export function keepBoth(o: Overlap, date: string): void {
  const s = storage();
  if (!s) return;
  const next = [...readKept().filter((k) => k !== overlapKey(o, date)), overlapKey(o, date)].slice(-CAP);
  try { s.setItem(KEY, JSON.stringify(next)); } catch { /* one repeated badge */ }
}
