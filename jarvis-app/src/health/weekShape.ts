// WEEK SHAPE (catalog Part 2). The week's sport commitments as a flat,
// honest picture: sessions, hours, which days had none. No ratio, no
// target, no trend line framed as decline -- this file returns one row per
// day of the week and nothing that compares one week to another.

import type { SportSession } from "./loadCandidates";

export interface WeekDayShape {
  date: string;
  sessions: number;
  hours: number; // rounded to one decimal
}

export interface WeekShape {
  days: WeekDayShape[]; // exactly 7, one per date in weekDates
  totalSessions: number;
  totalHours: number;
  daysWithNone: number;
}

/** `weekDates` is the caller's own list of the 7 local-ISO dates for the
 *  week being shown (Sunday-first or Monday-first, whichever the calendar
 *  surface already uses) -- this file does not invent a week boundary. */
export function weekShape(sessions: SportSession[], weekDates: string[]): WeekShape {
  const days: WeekDayShape[] = weekDates.map((date) => {
    const forDay = sessions.filter((s) => s.date === date);
    const minutes = forDay.reduce((sum, s) => sum + (s.durationMin ?? 0), 0);
    return { date, sessions: forDay.length, hours: Math.round((minutes / 60) * 10) / 10 };
  });
  const totalSessions = days.reduce((sum, d) => sum + d.sessions, 0);
  const totalHours = Math.round(days.reduce((sum, d) => sum + d.hours, 0) * 10) / 10;
  const daysWithNone = days.filter((d) => d.sessions === 0).length;
  return { days, totalSessions, totalHours, daysWithNone };
}
