// CONTEXT TRIGGERS (the reminders rebuild push D, 2026-09-15, brief
// section 6). A reminder can ask to be shown when something happens in the
// app: when an area is opened, or after a task is completed. It is a
// prompt, never a gate: it offers its action and Continue Anyway, it can be
// snoozed for a day, and it keeps a cooldown so the same prompt is not
// shown twice in an hour. Nothing here watches another app.

import type { TaskItem } from "./TasksService";
import type { ContextTriggerConfig } from "../notes/types";
import { isDone } from "./reminders";

export interface PromptContext {
  /** The area (category id) just opened. */
  areaId?: string;
  /** The task just completed. */
  completedTaskId?: string;
}

export const COOLDOWNS: { minutes: number; label: string }[] = [
  { minutes: 60, label: "1 Hour" },
  { minutes: 240, label: "4 Hours" },
  { minutes: 1440, label: "1 Day" },
];
export const DEFAULT_COOLDOWN_MIN = 240;
const DAY_MS = 24 * 60 * 60_000;

function matches(ct: ContextTriggerConfig, ctx: PromptContext): boolean {
  if (!ct.targetId) return false;
  if (ct.kind === "onOpenArea") return ctx.areaId === ct.targetId;
  if (ct.kind === "afterCompleteTask") return ctx.completedTaskId === ct.targetId;
  return false;
}

function cooledDown(ct: ContextTriggerConfig, nowMs: number): boolean {
  if (!ct.lastShownAt) return true;
  const shown = Date.parse(ct.lastShownAt);
  if (!Number.isFinite(shown)) return true;
  return nowMs - shown >= Math.max(1, ct.cooldownMinutes) * 60_000;
}

// The reminders whose prompt is due for what just happened.
export function promptsDue(items: TaskItem[], ctx: PromptContext, today: string, nowMs: number): TaskItem[] {
  return items.filter((it) => {
    const r = it.data.reminder;
    if (!r || it.data.done || r.paused || !r.contextTrigger) return false;
    if (isDone(r, today)) return false;
    return matches(r.contextTrigger, ctx) && cooledDown(r.contextTrigger, nowMs);
  });
}

// Continue Anyway: shown now, back after the cooldown.
export function shownNow(ct: ContextTriggerConfig, nowMs: number): ContextTriggerConfig {
  return { ...ct, lastShownAt: new Date(nowMs).toISOString() };
}

// Snooze This Prompt: not before tomorrow, whatever the cooldown.
export function snoozedForADay(ct: ContextTriggerConfig, nowMs: number): ContextTriggerConfig {
  const cooldownMs = Math.max(1, ct.cooldownMinutes) * 60_000;
  return { ...ct, lastShownAt: new Date(nowMs + DAY_MS - cooldownMs).toISOString() };
}

export function describeTrigger(ct: ContextTriggerConfig | undefined, areaName?: string): string {
  if (!ct) return "Never";
  if (ct.kind === "onOpenArea") return areaName ? `When I Open ${areaName}` : "When I Open the Area";
  return "After I Complete the Task";
}
