// UP-PLAT-09 (2026-09-06): TEXT SIZE, THE TWO HALVES.
//
// The manual half is a menu in Settings, Appearance, and it works everywhere.
// The automatic half is the phone's own Larger Text setting, and on iOS the
// only supported way into it from a WKWebView is @capacitor/text-zoom's
// TextZoom.getPreferred() (https://capacitorjs.com/docs/apis/text-zoom).
//
// THAT PLUGIN IS NOT INSTALLED, and cannot be added from this worktree: the
// app's node_modules is a symlink into the main checkout, which this branch
// must not write to. So this is the seam, honest about what it can answer:
// null means "the system has not told us anything", which is exactly true
// today, and the manual choice stands alone. Wiring it later is one dynamic
// import inside readSystemTextScale and a line in DAVE_STEPS.md, with no
// other file touched, because everything downstream already reads a number.

import { Capacitor } from "@capacitor/core";

// Past 1.4 the tab bar starts losing its labels and 44pt controls start
// eating the row they sit in. Refusing to go further is a better answer than
// a broken screen, and it matches the record's own clamp.
export const MIN_TYPE_SCALE = 1;
export const MAX_TYPE_SCALE = 1.4;

export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return MIN_TYPE_SCALE;
  return Math.min(MAX_TYPE_SCALE, Math.max(MIN_TYPE_SCALE, n));
}

/**
 * The phone's own text size as a multiplier, or null when nothing can say.
 * Native only, and null on the web by design: a browser has its own zoom and
 * the app has no business second-guessing it.
 */
export async function readSystemTextScale(): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null;
  // No plugin, no reading. Deliberately not a guess: a wrong scale applied
  // silently at boot is worse than the shipped one.
  return null;
}
