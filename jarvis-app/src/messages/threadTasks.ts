import type { TaskItem } from "../tasks/TasksService";

// ---------------------------------------------------------------------------
// PICK 26 (Dave 2026-08-22): EMAIL-BORN TASKS INHERIT THE PROJECT.
//
// A task made from an email notice landed with a due date and nothing else:
// no area, no project, no way back to the thread that produced it. The whole
// point of the Email band on Today is that he never has to open the inbox to
// deal with what the inbox produced, and a task with no lineage sends him
// back there to remember what it was about.
//
// Inheritance here is DERIVED, never guessed. There is no title matching and
// no category heuristic: the app has one honest signal, which is that a task
// from this same thread already exists and somebody already filed it. The
// first task from a thread inherits nothing, which is correct, because there
// is nothing to inherit yet. Every task after it joins its sibling.
//
// This is why the thread id is stored: it is what makes the second task
// smarter than the first, and it is what will let a task say "from Nadia's
// thread" later without another migration.
// ---------------------------------------------------------------------------

export interface Inherited {
  projectId?: string;
  category?: string;
}

/**
 * What a new task from this thread should inherit from its siblings. The
 * NEWEST filed sibling wins: if he moved the thread's work to a different
 * project last week, that is the current answer.
 */
export function inheritFromThread(tasks: TaskItem[], threadId: string): Inherited {
  if (!threadId) return {};
  const siblings = tasks.filter((t) => t.data.fromThread === threadId);
  if (siblings.length === 0) return {};
  const filed = [...siblings].reverse().find((t) => !!t.data.projectId);
  if (filed) {
    return {
      projectId: filed.data.projectId,
      ...(filed.data.category ? { category: filed.data.category } : {}),
    };
  }
  // No project on any sibling, but a category is still lineage worth keeping.
  const catted = [...siblings].reverse().find((t) => !!t.data.category);
  return catted?.data.category ? { category: catted.data.category } : {};
}
