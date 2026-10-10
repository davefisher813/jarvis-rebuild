// Single haptics seam for the whole app. Call sites use the semantic methods
// and never touch the platform API.
//
// THE VOCABULARY (Apple sprint, haptics, 2026-10-10). Five feels, one meaning
// each, so the phone answers the same kind of tap the same way everywhere:
//   selection  choosing: a switch, a row, a menu, an answer that commits nothing
//   confirm    a tap that commits: a capture filed, a task saved, a step taken,
//              a memory confirmed; and the floor of every completion when the
//              richer completion tap below is not chosen
//   success    the completion tap, a choice (Feedback Style > Haptics)
//   warning    something needs attention
//   impact     a timer's beat (gym)
// Tune the feel in NATIVE and WEB_PATTERN below; no call site carries a style.
//
// NATIVE (Capacitor iOS/Android): real Taptic/vibration feedback via
// @capacitor/haptics. WEB (PWA/site): falls back to the Vibration API, which
// works on Android and is silently ignored on iOS Safari. Either way a haptic
// can never throw into a UI handler.
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isQuietToday, readFeedback } from "../encourage/prefs";
import { todayISO } from "../tasks/grouping";

export type HapticKind = "selection" | "confirm" | "success" | "warning" | "impact";

const WEB_PATTERN: Record<HapticKind, number | number[]> = {
  selection: 6,
  confirm: 10,
  success: [10, 40, 16],
  warning: [8, 30, 8],
  impact: 14,
};

const NATIVE: Record<HapticKind, () => Promise<void>> = {
  selection: () => Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd()),
  confirm: () => Haptics.impact({ style: ImpactStyle.Light }),
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

// The completion tap is a choice, off until chosen (Feedback Style, Dave
// 2026-10-04) and silent all day under Quiet Today. The other kinds are the
// controls' own feel (a switch, a row) and are not part of that choice.
const completionAllowed = (): boolean => readFeedback().haptics && !isQuietToday(todayISO());

export const haptics = {
  selection: () => fire("selection"),
  confirm: () => fire("confirm"),
  success: () => { if (completionAllowed()) fire("success"); },
  warning: () => fire("warning"),
  impact: () => fire("impact"),
};
