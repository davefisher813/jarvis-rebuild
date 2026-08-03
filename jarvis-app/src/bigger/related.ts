import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import type { TaskItem } from "../tasks/TasksService";

// Session 6.6: the connection layer for Bigger Picture, built under the
// accuracy principle. Three jobs, all derived:
// 1. nextActionOf: a project's single next open task (a project with no next
//    action is stalled by definition).
// 2. relatedProjectsForGoal: unlinked projects whose titles share a
//    DISTINCTIVE word with the goal. Deliberately narrow: the matcher only
//    speaks when the user's own naming makes the link obvious ("Bridge"), and
//    stays silent otherwise. A weak guess here is worse than nothing; its real
//    hit rate is measured through suggestion.accepted/dismissed (kind "link")
//    in the durable log, and if the data says it reaches, it dies.
// 3. Permanent dismissal memory per goal-project pair. An assistant that
//    re-nags gets deleted; a dismissed pair NEVER comes back.

// Words that connect nothing. Short words are dropped by the length gate.
const STOPWORDS = new Set([
  "with", "from", "into", "over", "that", "this", "them", "then", "than",
  "have", "will", "your", "mine", "ours", "their", "about", "every", "each",
  "more", "less", "very", "some", "plan", "plans", "project", "goal", "goals",
  "task", "tasks", "week", "month", "year", "daily", "start", "starting",
  "make", "making", "keep", "get", "getting", "work", "working",
]);

export function distinctiveTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
  );
}

/**
 * Unlinked projects that share at least one distinctive word with the goal,
 * strongest overlap first. Callers show at most ONE (screen calm).
 */
export function relatedProjectsForGoal(goal: Goal, projects: Project[]): Project[] {
  const goalTokens = distinctiveTokens(goal.data.title);
  if (goalTokens.size === 0) return [];
  return projects
    .filter((p) => !p.data.goalId)
    .map((p) => {
      let overlap = 0;
      for (const t of distinctiveTokens(p.data.title)) if (goalTokens.has(t)) overlap++;
      return { p, overlap };
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .map((x) => x.p);
}

/**
 * The project's next open task: earliest due date first, undated after dated,
 * ties in list order. Null when there is nothing open (which is what makes
 * "no next action" an honest synonym for stuck).
 */
export function nextActionOf(tasks: TaskItem[], projectId: string): TaskItem | null {
  const open = tasks.filter((t) => t.data.projectId === projectId && !t.data.done);
  if (open.length === 0) return null;
  return open.slice().sort((a, b) => (a.data.due ?? "9999-99-99").localeCompare(b.data.due ?? "9999-99-99"))[0]!;
}

// ---- permanent dismissal memory (per goal-project pair) ----

const DISMISS_KEY = "jarvis.link.dismissed.v1";

export interface DismissStorage {
  read(): string | null;
  write(value: string): void;
}

export const localDismissStorage: DismissStorage = {
  read: () => {
    try {
      return localStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  },
  write: (value) => {
    try {
      localStorage.setItem(DISMISS_KEY, value);
    } catch {
      /* best-effort */
    }
  },
};

function readDismissed(storage: DismissStorage): string[] {
  const raw = storage.read();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function isLinkDismissed(goalId: string, projectId: string, storage: DismissStorage = localDismissStorage): boolean {
  return readDismissed(storage).includes(goalId + ":" + projectId);
}

export function dismissLink(goalId: string, projectId: string, storage: DismissStorage = localDismissStorage): void {
  const all = readDismissed(storage);
  const key = goalId + ":" + projectId;
  if (!all.includes(key)) {
    all.push(key);
    storage.write(JSON.stringify(all.slice(-200)));
  }
}
