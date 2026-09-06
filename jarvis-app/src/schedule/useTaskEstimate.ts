import { useCallback, useEffect, useState } from "react";
import { supabase } from "../auth/supabaseClient";
import type { WindowClient } from "../brain/window";
import { learnedDurations, readCommittedDurationsWindowed } from "./learnedDurations";
import type { TaskItem } from "../tasks/TasksService";

// HOW LONG THIS ONE PROBABLY TAKES (LIFE-F-23, 2026-09-05).
//
// "The smallest real thing" (tasks/overwhelmed.ts) sorts by estimated length
// and breaks ties by oldest due. Both callers fed it `() => 30`, a constant,
// so every task tied and the sort collapsed to oldest-due: What Now and Just
// This One always picked the most overdue thing on the list, which is usually
// the heaviest, the exact opposite of the law they were built on.
//
// There is already one honest length signal in the app: the per-category
// medians Plan My Day's stepper prefills from and Bigger Picture sizes
// projects with (learnedDurations, three samples inside thirty days or
// silence). A task in a category he consistently books 15 minutes for is
// genuinely smaller than one in a category he books 90 for.
//
// No evidence, no claim: a category with too few samples falls back to the
// flat 30 that was here before, which leaves the ranking exactly as it was
// for anyone whose history has not spoken yet.
export const DEFAULT_TASK_MINUTES = 30;

// The learned medians alone, for the surfaces that need the number BEFORE
// they have a task: the Length row's "usually 30m in this area" line.
export function useCategoryEstimates(): Record<string, number> {
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  useEffect(() => {
    let on = true;
    readCommittedDurationsWindowed(supabase as unknown as WindowClient | null, Date.now())
      .then((samples) => { if (on) setByCategory(learnedDurations(samples, Date.now())); })
      // A missing signal is not an error the person needs to hear about: the
      // pick still happens, on the flat default.
      .catch(() => undefined);
    return () => { on = false; };
  }, []);
  return byCategory;
}

export function useTaskEstimate(): (t: TaskItem) => number {
  const byCategory = useCategoryEstimates();
  return useCallback(
    // UP-CORE-02 (2026-09-05): his number for THIS task first. A category
    // median is evidence about a kind of work; a length he typed on the task
    // is evidence about the work, and the more specific one wins.
    (t: TaskItem) => t.data.estimateMin ?? byCategory[t.data.category ?? ""] ?? DEFAULT_TASK_MINUTES,
    [byCategory],
  );
}
