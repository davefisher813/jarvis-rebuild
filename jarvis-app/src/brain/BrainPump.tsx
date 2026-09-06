import { useEffect, useRef } from "react";
import { useOptionalStrands } from "../data/NotesProvider";
import { supabase } from "../auth/supabaseClient";
import { readWindow, type WindowClient } from "./window";
import { brainMoments } from "./moments";
import { consolidate, readConsolidation } from "./nightly";
import { todayISO } from "../ai/useAIContext";
import { armFocusCompletion } from "../events/focus";

// THE DAY IS REVIEWED AT THE DAY BOUNDARY (UP-MIND-05, Brain build order 2).
//
// The once-a-day consolidation ran from inside TodaySuggestions
// (TodaySuggestions.tsx:113), which meant it ran only if that screen
// rendered. A user who lived in Tasks, or was away for a weekend, had a
// Brain that never reviewed the day at all: the set was decided by whichever
// render happened first, or never.
//
// Mounted in AppShell alongside MailSnapshotPump, the same "outlives every
// screen" spot, and keyed on the local day, so the set is decided when the
// day turns over rather than when a particular tab is opened. Renders
// nothing and proposes nothing: consolidate only chooses which of the
// candidates the same detectors already produced are today's, and the accept
// tap is still the only path into the genome.
//
// It also arms the focus-completion listener, for the same reason: a bus
// subscription that lives inside a screen only hears the completions that
// happen while that screen is mounted.
export default function BrainPump({ dayKey }: { dayKey: string }) {
  const strands = useOptionalStrands();
  const ranFor = useRef("");

  useEffect(() => armFocusCompletion(), []);

  useEffect(() => {
    if (!strands) return;
    const today = todayISO();
    // Already decided, by an earlier mount or by a screen that beat us to
    // it. Nothing to spend a window read on.
    if (ranFor.current === today || readConsolidation()?.day === today) {
      ranFor.current = today;
      return;
    }
    ranFor.current = today;
    let live = true;
    void (async () => {
      try {
        const [rows, list] = await Promise.all([
          readWindow(supabase as unknown as WindowClient | null, Date.now()),
          strands.list(),
        ]);
        if (!live) return;
        consolidate(brainMoments(rows, list), today);
      } catch {
        // A failed window read means no decision today, which is exactly
        // what consolidate refuses to write anyway: an empty set is not an
        // answer, and recording one would silence a real proposal for a day.
        ranFor.current = "";
      }
    })();
    return () => { live = false; };
  }, [strands, dayKey]);

  return null;
}
