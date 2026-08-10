import type { TaskItem } from "../tasks/TasksService";

// App icon badge (2026-08-09): the icon answers "does JARVIS need me" from
// the home screen, instead of making the user open the app to find out. The
// count is open tasks due today or before, the same number Today's ring
// cares about. Bills are in that set by construction (a bill is a task).
//
// Web Badging API: works on installed PWAs (iOS 16.4+); a clean no-op
// everywhere else, same philosophy as haptics and notifications.

export function badgeCount(tasks: TaskItem[], today: string): number {
  return tasks.filter((t) => !t.data.done && !!t.data.due && (t.data.due as string) <= today).length;
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (n: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export async function setAppBadge(n: number): Promise<void> {
  try {
    const nav = navigator as BadgeNavigator;
    if (n > 0 && nav.setAppBadge) await nav.setAppBadge(n);
    else if (n === 0 && nav.clearAppBadge) await nav.clearAppBadge();
  } catch {
    /* a badge is a bonus, never a crash */
  }
}
