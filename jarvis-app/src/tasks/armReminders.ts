import type { TaskItem } from "./TasksService";
import type { Category } from "../categories/types";
import type { ProfileData } from "../profile/types";
import { effectiveKind } from "../categories/kinds";
import { ensureTaskReminders, type ReminderNotifyOptions, type TaskReminderInput } from "../shared/notifications";
import { DEFAULT_QUIET_FROM, DEFAULT_QUIET_TO } from "./reminders";

// ONE WAY TO ARM TASK REMINDERS (2026-10-04).
//
// AppShell armed them with the person's Reminder Settings (Hide Sensitive
// Details, Quiet Hours) and TodayFlow armed them with neither, into the SAME
// id block. ensureTaskReminders cancels the block and rebuilds it from its own
// arguments, so the last caller won, and Today re-fires on every reload: the
// two switches changed nothing whenever Today was mounted. Both now build
// their arguments here, and saving the settings re-arms through here too, so
// a flip reaches the phone now instead of at the next foreground.
export function taskReminderArming(
  items: ReadonlyArray<Pick<TaskItem, "id" | "data">>,
  cats: ReadonlyArray<Pick<Category, "id" | "data">>,
  notify: ProfileData["notify"] | undefined,
): { inputs: TaskReminderInput[]; opts: ReminderNotifyOptions } {
  const health = new Set(cats.filter((c) => effectiveKind(c.data) === "health").map((c) => c.id));
  const inputs = items
    .filter((t) => !!t.data.reminder)
    .map((t) => ({
      id: t.id,
      text: t.data.text,
      reminder: t.data.reminder!,
      sensitive: !!notify?.privateAlerts && !!t.data.category && health.has(t.data.category),
    }));
  const opts: ReminderNotifyOptions = notify?.quietHours
    ? { quietFrom: notify.quietFrom ?? DEFAULT_QUIET_FROM, quietTo: notify.quietTo ?? DEFAULT_QUIET_TO }
    : {};
  return { inputs, opts };
}

export interface ReminderArmSources {
  tasks: { listTasks(): Promise<TaskItem[]> };
  profile: { get(): Promise<ProfileData | null> };
  categories: { list(): Promise<Category[]> };
}

let armSeq = 0;

/** Reads the tasks, the settings and the areas fresh every time, so a caller
 * holding an old copy of any of them (Today's list on first mount is empty)
 * can never arm with it. The newest call wins: if another began while this
 * one was reading, this one stands down and that one arms, the same rule the
 * scheduler's own queue keeps (serializeLatest), applied before the queue
 * because the reads here can finish out of order. */
export async function armTaskReminders(src: ReminderArmSources, today: string): Promise<void> {
  const mine = ++armSeq;
  try {
    const [all, prof, cats] = await Promise.all([src.tasks.listTasks(), src.profile.get(), src.categories.list()]);
    if (mine !== armSeq) return;
    const { inputs, opts } = taskReminderArming(all, cats, prof?.notify);
    await ensureTaskReminders(inputs, today, Date.now(), opts);
  } catch { /* the next foreground tries again; nothing was lost */ }
}
