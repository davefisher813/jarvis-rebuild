import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TaskItem } from "../tasks/TasksService";

// App icon badge (2026-08-09): the icon answers "does JARVIS need me" from
// the home screen, instead of making the user open the app to find out. The
// count is open tasks due today or before, the same number Today's ring
// cares about. Bills are in that set by construction (a bill is a task).
//
// Web Badging API: works on installed PWAs (iOS 16.4+); a clean no-op
// everywhere else, same philosophy as haptics and notifications.
//
// SHARED-F-12 (2026-09-05): and it was ONLY the Badging API, which WebKit
// enables for Home Screen web apps and not for the WKWebView Capacitor
// ships. So on the one platform this rebuild targets, the whole feature was
// the "clean no-op" the note above describes, and the design intent never
// happened once. Native gets the real thing now, the same shape haptics.ts
// and notifications.ts already use: branch on Capacitor.isNativePlatform(),
// keep the web path for the PWA.

export function badgeCount(tasks: TaskItem[], today: string): number {
  return tasks.filter((t) => !t.data.done && !!t.data.due && (t.data.due as string) <= today).length;
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (n: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

// The native side is @capawesome/capacitor-badge (a dependency as of this
// commit; the pod arrives with `npx cap sync ios`). It is bound BY NAME
// rather than imported, which is exactly what that package's own entry point
// does with registerPlugin("Badge"): binding by name keeps this module
// compiling and testable on a checkout whose node_modules predate the
// dependency, and a call before the pod exists rejects into the catch below
// like any other missing bridge. It rides the notification permission the
// app already asks for; nothing new is prompted for.
interface BadgePlugin {
  set(options: { count: number }): Promise<void>;
  clear(): Promise<void>;
}
const Badge = registerPlugin<BadgePlugin>("Badge");

export async function setAppBadge(n: number): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      // Zero clears rather than drawing a "0", which is the one number a
      // badge must never show: it would say JARVIS needs you to look at
      // nothing.
      if (n > 0) await Badge.set({ count: n });
      else await Badge.clear();
      return;
    }
    const nav = navigator as BadgeNavigator;
    if (n > 0 && nav.setAppBadge) await nav.setAppBadge(n);
    else if (n === 0 && nav.clearAppBadge) await nav.clearAppBadge();
  } catch {
    /* a badge is a bonus, never a crash */
  }
}
