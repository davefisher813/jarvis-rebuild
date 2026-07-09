// Single haptics seam for the whole app. Call sites use the semantic methods
// and never touch the platform API.
//
// TODAY (web/PWA): uses the Vibration API, which works on Android and is
// silently ignored on iOS Safari, so it is harmless everywhere.
//
// AT CAPACITOR WRAP TIME: install @capacitor/haptics and replace the body of
// fire() with native calls (one place, every call site lights up).

export type HapticKind = "selection" | "success" | "warning" | "impact";

const WEB_PATTERN: Record<HapticKind, number | number[]> = {
  selection: 6,
  success: [10, 40, 16],
  warning: [8, 30, 8],
  impact: 14,
};

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function fire(kind: HapticKind): void {
  if (canVibrate()) {
    try { navigator.vibrate(WEB_PATTERN[kind]); } catch { /* never throw into UI */ }
  }
}

export const haptics = {
  selection: () => fire("selection"),
  success: () => fire("success"),
  warning: () => fire("warning"),
  impact: () => fire("impact"),
};
