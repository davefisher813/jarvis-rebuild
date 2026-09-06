// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTaskEstimate, DEFAULT_TASK_MINUTES } from "./useTaskEstimate";
import type { TaskItem } from "../tasks/TasksService";

// LIFE-F-23 (2026-09-05): with no committed durations behind it, the estimate
// must be the flat 30 the callers used to hard-code, so a person whose history
// has not spoken yet gets exactly the ranking they had before.
describe("useTaskEstimate", () => {
  const task = (category: string): TaskItem => ({ id: "t", data: { text: "x", category, done: false } });

  it("falls back to the flat default when nothing has been learned", async () => {
    const { result } = renderHook(() => useTaskEstimate());
    await waitFor(() => expect(result.current(task("work"))).toBe(DEFAULT_TASK_MINUTES));
    expect(result.current(task(""))).toBe(DEFAULT_TASK_MINUTES);
  });

  // UP-CORE-02 (2026-09-05): the length he set on the task itself is the most
  // specific evidence there is, so it outranks anything learned by category.
  it("prefers the length set on the task over the category default", async () => {
    const { result } = renderHook(() => useTaskEstimate());
    const own: TaskItem = { id: "t", data: { text: "Call the dentist", category: "work", done: false, estimateMin: 10 } };
    await waitFor(() => expect(result.current(own)).toBe(10));
  });
});
