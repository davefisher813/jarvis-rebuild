// Small formatting for the Hub's facts lines. Times are the person's zone,
// 12-hour (the clock law); days are Today, Yesterday or the short date.

import { shortDate } from "../shared/dateFormat";

export function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return shortDate(iso.slice(0, 10));
}

/** "Today · 9:12 AM". */
export function whenLine(iso: string, now: Date = new Date()): string {
  const day = dayLabel(iso, now);
  const t = timeOf(iso);
  return day && t ? `${day} · ${t}` : day || t;
}

/** One line of facts, dots between, empties dropped. */
export function facts(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
}
