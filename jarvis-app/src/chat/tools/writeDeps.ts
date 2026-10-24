// THE WRITES A CARD MAY MAKE, AND THE ONLY PLACE THE TOOL LAYER TOUCHES A SERVICE'S WRITE (chat box order, 2026-10-24).
//
// execute.ts is handed this and nothing else: ten small functions over the task and decision services, each the very call the rest of the
// app makes for the same act (a finished task rolls or completes through completeTask, a date moves through setDue, an Undo puts back what a
// tick changes through restoreCompletion). Nothing here is reachable from the model: the file is imported by the hook, the hook hands it to
// the approval path, and the approval path calls it only after a tap has been accepted (laws/chatTools.test.ts holds each step of that).

import type { TasksService } from "../../tasks/TasksService";
import type { DecisionService } from "../../decisions/DecisionService";
import type { WriteDeps } from "./execute";

export function makeWriteDeps(s: { tasks: TasksService; decisions: DecisionService }): WriteDeps {
  return {
    task: (id) => s.tasks.task(id),
    createTask: (text, o) => s.tasks.createTask(text, { ...(o.due ? { due: o.due } : {}), ...(o.priority ? { priority: o.priority } : {}), ...(o.personId ? { personId: o.personId } : {}) }),
    deleteTask: (id) => s.tasks.deleteTask(id),
    setDue: (id, due) => s.tasks.setDue(id, due),
    completeTask: async (id) => ({ ok: (await s.tasks.completeTask(id)).ok }),
    restoreCompletion: (id, before) => s.tasks.restoreCompletion(id, before),
    editText: (id, text) => s.tasks.editText(id, text),
    setPriority: (id, priority) => s.tasks.setPriority(id, priority),
    createDecision: ({ decision, why, ruledOut }) => s.decisions.create({
      decision,
      ...(why ? { why } : {}),
      ...(ruledOut ? { ruledOut: [ruledOut] } : {}),
      source: { kind: "chat", at: new Date().toISOString() },
    }),
    removeDecision: (id) => s.decisions.remove(id),
  };
}
