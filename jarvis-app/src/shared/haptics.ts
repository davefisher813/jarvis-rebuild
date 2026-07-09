// Single haptics seam for the whole app. Call sites use the semantic methods
// and never touch the platform API.
//
// NATIVE (Capacitor iOS/Android): real Taptic/vibration feedback via
// @capacitor/haptics. WEB (PWA/site): falls back to the Vibration API, which
// works on Android and is silently ignored on iOS Safari. Either way a haptic
// can never throw into a UI handler.
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export type HapticKind = "selection" | "success" | "warning" | "impact";

const WEB_PATTERN: Record<HapticKind, number | number[]> = {
  selection: 6,
  success: [10, 40, 16],
  warning: [8, 30, 8],
  impact: 14,
};

const NATIVE: Record<HapticKind, () => Promise<void>> = {
  selection: () => Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd()),
  success: () => Haptics.notification({ type: NotificationType.Success }),
  warning: () => Haptics.notification({ type: NotificationType.Warning }),
  impact: () => Haptics.impact({ style: ImpactStyle.Medium }),
};

function fire(kind: HapticKind): void {
  if (Capacitor.isNativePlatform()) {
    NATIVE[kind]().catch(() => { /* never throw into UI */ });
    return;
  }
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try { navigator.vibrate(WEB_PATTERN[kind]); } catch { /* ignore */ }
  }
}

export const haptics = {
  selection: () => fire("selection"),
  success: () => fire("success"),
  warning: () => fire("warning"),
  impact: () => fire("impact"),
};
