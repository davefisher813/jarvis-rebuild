import { useEffect, useRef } from "react";
import { useGoogle } from "./GoogleSession";
import { useSchedule } from "../../data/NotesProvider";
import { importCalendar } from "./sync";

// Runs the calendar import, and its self-healing duplicate sweep, on EVERY
// Google connect, wherever the connect happened. Before this, only the
// Connections page button imported: connecting through the Email tab skipped
// the sweep entirely, so a "fixed" duplicate bug looked unfixed on Dave's
// phone. Once per token; a failure clears the latch so the next connect
// retries. Renders nothing.
export default function GoogleAutoImport() {
  const g = useGoogle();
  const schedule = useSchedule();
  const done = useRef(false);

  useEffect(() => {
    if (!g.hasToken) {
      done.current = false;
      return;
    }
    const list = g.apis("cal");
    if (list.length === 0 || done.current) return;
    done.current = true;
    // Every calendar-enabled account imports; the sweep dedupes by gcalId and
    // by identical slot, which also collapses the invited-on-both-accounts
    // case (same Google event id in both calendars) to one JARVIS event.
    (async () => {
      for (const { api } of list) {
        await importCalendar(api, schedule).catch(() => { done.current = false; });
      }
    })();
  }, [g, schedule]);

  return null;
}
