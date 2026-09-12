import type { TaskItem } from "../tasks/TasksService";

// ONE TASK PER THREAD, EVER (E-30, Email Build Master 2026-09-12, Push H).
//
// commitments.ts has said it since August, for the catcher, and the safety
// net keeps its own netted list. The MANUAL paths never checked: the Sweep's
// task card, the ledger's Add Task, the thread's attachment offer, and the
// waiting row's Add Task each wrote a fresh task with no look at the ones
// already there, so a thread he handled from two screens produced two
// tasks that said the same thing. Every one of those paths asks here first;
// if a task is already open for the thread, the UI offers Open Task instead
// of making a second one.
//
// Derived, never guessed: a task belongs to a thread when it carries the
// thread id, either as fromThread or as an email source ref. No title
// matching. Done tasks do not count: a promise kept last month is not a
// reason to refuse a new one.

export function existingTaskFor(threadId: string, tasks: readonly TaskItem[]): TaskItem | null {
  if (!threadId) return null;
  for (const t of tasks) {
    if (t.data.done) continue;
    if (t.data.fromThread === threadId) return t;
    const s = t.data.source;
    if (s && s.type === "email" && s.ref === threadId) return t;
  }
  return null;
}

/** The title to name in "Already a task · …". */
export function taskTitleOf(t: TaskItem): string {
  const d = t.data as { text?: string; title?: string };
  return (d.text ?? d.title ?? "").trim() || "that one";
}

/** Convenience for the write paths: list, then ask. Any listing failure
 *  reads as "none found" so a flaky store never blocks a save. */
export async function findTaskForThread(
  tasks: { listTasks: () => Promise<TaskItem[]> },
  threadId: string,
): Promise<TaskItem | null> {
  const all = await tasks.listTasks().catch(() => [] as TaskItem[]);
  return existingTaskFor(threadId, all);
}
