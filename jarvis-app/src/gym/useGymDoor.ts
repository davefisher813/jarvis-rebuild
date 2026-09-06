// UP-ATH-02 (2026-09-06): THE TRAINING DOOR, ON EVERY SURFACE THAT HAS THE
// BLOCK.
//
// D4-C's door ("your existing gym block becomes the door: it names the day's
// lift, taps straight into the session") shipped on the Schedule tab and
// nowhere else, as forty lines living inside ScheduleFlow. Today shows the
// same calendar, renders the same DayRow, and had no door at all: a gym
// block on Today was a plain event row, and the only way into a session from
// that page was Resume on one already running. So the page the athlete is
// actually on at six in the evening was the one page that could not start.
//
// The lazy read is part of the seam on purpose. The gym is only loaded when
// a door event is really on the calendar, and re-read when the overlay
// closes, because a finished session stamps the block and moves history.

import { useCallback, useEffect, useState } from "react";
import type { EventItem } from "../schedule/types";
import type { GymDoorView } from "../schedule/screens/DayRow";
import type { Program, Workout } from "./types";
import { doorInfoFor } from "./door";
import { readGymSettings, rackFrom } from "./settings";
import { readActiveProgramId } from "./GymFlow";
import { useOptionalGym } from "../data/NotesProvider";

export interface OpenedDoor { eventId: string; budgetMin?: number }

export interface GymDoorSeam {
  /** The door facts for one event row, or null when it is not a gym block
   *  (or there is no gym service above this component). */
  doorFor: (e: EventItem) => GymDoorView | null;
  /** Non-null while the athlete is inside the session this door opened. */
  opened: OpenedDoor | null;
  close: () => void;
}

/**
 * `dateIso` is the day being rendered: Schedule's selected date, Today's
 * today. Start is offered only on the real today, because a door on Thursday
 * that offers to start Thursday's lift on Tuesday is an invitation to log a
 * session onto the wrong day.
 */
export function useGymDoor(events: EventItem[], dateIso: string, todayIso: string): GymDoorSeam {
  const gymSvc = useOptionalGym();
  const [opened, setOpened] = useState<OpenedDoor | null>(null);
  const [gymData, setGymData] = useState<{ programs: Program[]; workouts: Workout[] } | null>(null);

  const anyDoor = events.some((e) => e.data.gym);
  useEffect(() => {
    if (!anyDoor || !gymSvc || opened) return;
    let on = true;
    void (async () => {
      const [programs, workouts] = await Promise.all([gymSvc.listPrograms(), gymSvc.listWorkouts()]);
      if (on) setGymData({ programs, workouts });
    })();
    return () => { on = false; };
  }, [anyDoor, gymSvc, opened]);

  const doorFor = useCallback((e: EventItem): GymDoorView | null => {
    if (!e.data.gym || !gymSvc) return null;
    const trainedMin = e.data.trained?.[dateIso];
    if (trainedMin != null) return { trainedMin };
    const info = gymData
      ? doorInfoFor(gymData.programs, readActiveProgramId(), gymData.workouts, rackFrom(readGymSettings()), dateIso)
      : null;
    const startable = dateIso === todayIso;
    const budgetMin = e.data.end
      ? Math.max(0, (Number(e.data.end.slice(0, 2)) * 60 + Number(e.data.end.slice(3)))
        - (Number(e.data.start.slice(0, 2)) * 60 + Number(e.data.start.slice(3))))
      : 0;
    return {
      ...(info ? { dayName: info.day.name, meta: info.meta } : {}),
      ...(startable ? { onStart: () => setOpened({ eventId: e.id, ...(budgetMin > 0 ? { budgetMin } : {}) }) } : {}),
    };
  }, [gymSvc, gymData, dateIso, todayIso]);

  return { doorFor, opened, close: () => setOpened(null) };
}
