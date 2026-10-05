// UP-PLAT-09 (2026-09-06): TEXT SIZE, THE TWO HALVES.
//
// The manual half is a menu in Settings, Appearance, and it works everywhere.
// The automatic half is the phone's own Larger Text setting, and on iOS the
// only supported way into it from a WKWebView is @capacitor/text-zoom's
// TextZoom.getPreferred() (https://capacitorjs.com/docs/apis/text-zoom).
//
// 2026-10-05: THE PLUGIN IS INSTALLED NOW. It answers the body font size the
// person chose under Settings > Display > Text Size, divided by the 17pt base
// (1 is the default size, 1.3 a notch or two up). It is bound BY NAME like
// every other native seam here (registerPlugin, as shared/badge.ts does), so
// this module still compiles and tests on a checkout with no native layer,
// and an answer that is not a real number is "the system has not told us
// anything": null, and the manual choice stands alone. Everything downstream
// already reads a number and clamps it (clampScale).

import { Capacitor, registerPlugin } from "@capacitor/core";

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
export async function readSystemTextScale(
  deps: { getPreferred?: () => Promise<{ value: number }> } = {},
): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const getPreferred = deps.getPreferred
      ?? (() => registerPlugin<{ getPreferred(): Promise<{ value: number }> }>("TextZoom").getPreferred());
    const { value } = await getPreferred();
    // Not a guess: anything but a finite positive number is no answer, and a
    // wrong scale applied silently at boot is worse than the shipped one.
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
