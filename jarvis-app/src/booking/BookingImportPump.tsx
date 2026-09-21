import { useEffect, useRef } from "react";
import { useSchedule } from "../data/NotesProvider";
import { importBookings } from "./importBookings";
import { pushCommitted } from "./pushCommitted";
import { cancelledToast } from "./bookedEvents";
import { showToast } from "../shared/toast";

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
//
// IT DOES SPEAK WHEN AN HOUR WENT (2026-09-19). A visitor can now cancel from
// the link in their own email, and an event quietly vanishing from a schedule is
// worse than no booking system: he plans around an hour he thinks is taken and
// never learns it is free, or worse, notices the gap and does not know why. So a
// removal says so. Arrivals stay silent, because a booking is a thing somebody
// else did on purpose and the hour showing up IS the news.
//
// IT ALSO GOES THE OTHER WAY (2026-09-19). The same open hands Track 3 the hours
// he has already spoken for, so the link stops offering an hour he is in. That
// direction is silent whatever happens: it is housekeeping he never asked for,
// and a toast about it would be a toast on every app open.
export default function BookingImportPump() {
  const schedule = useSchedule();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void importBookings(schedule)
      .then(({ removed }) => {
        const message = cancelledToast(removed);
        if (message) showToast({ message });
        // After the import, so a booking that just arrived is already an event
        // and is not pushed back as an hour of his own.
        return pushCommitted(schedule);
      })
      .catch(() => { done.current = false; });
  }, [schedule]);

  return null;
}
