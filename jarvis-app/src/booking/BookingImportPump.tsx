import { useEffect, useRef } from "react";
import { useSchedule } from "../data/NotesProvider";
import { importBookings } from "./importBookings";

// BOOKINGS INTO THE SCHEDULE (Track 3, 2026-09-19). Renders nothing.
//
// Mounted in AppShell rather than inside a tab, for the same reason the mail
// pumps are: a tab switch unmounts a tab, and the whole point of this is that
// the schedule is right whether or not he happened to open the right screen.
//
// Once per app open. A booking is not a live feed and does not need to be: it
// is a meeting some days out, and the receipt already told the visitor it was
// taken. Running it on every render, or on a timer, would be a request per
// minute for news that arrives twice a week.
//
// It cannot fail loudly. No sign-in, no booking server, a network that is not
// there: each leaves the schedule as it was and clears the latch, so the next
// open tries again.
export default function BookingImportPump() {
  const schedule = useSchedule();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void importBookings(schedule).catch(() => { done.current = false; });
  }, [schedule]);

  return null;
}
