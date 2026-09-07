import { useEffect, useRef } from "react";
import { useOptionalPeople, useOptionalStrands } from "../data/NotesProvider";
import { supabase } from "../auth/supabaseClient";
import { readWindow, type WindowClient } from "./window";
import { brainMoments } from "./moments";
import { peopleForDerivation } from "./peopleFacts";
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
  // THE PASS DECIDES WITH EVERY INPUT, OR IT DOES NOT DECIDE (2026-09-06).
  //
  // This pass ran brainMoments(rows, list) with no people argument, so
  // derivePeopleRhythm and deriveGoneQuiet were handed the empty default
  // (moments.ts:72) in the one pass that writes the day's keys. TodaySuggestions
  // assembles the list and passes it, but readChosen (nightly.ts:123) only maps
  // keys already stored for today, so that never helped: the two people facts
  // were reachable only on a day the pass found nothing at all. A pass that
  // decides with half its inputs and then records that decision locks the other
  // half out until tomorrow.
  const people = useOptionalPeople();
  const ranFor = useRef("");

  useEffect(() => armFocusCompletion(), []);

  useEffect(() => {
    // Both services come from the same provider (NotesProvider.tsx:147 wraps
    // :161), so in the shipped tree this can only be both or neither. The guard
    // is written on both anyway, because the rule it states is the one the bug
    // broke: this component decides the day with everything it needs, or it
    // waits. A harness that mounts it with a partial provider gets a pass that
    // stays silent rather than one that quietly answers for the day.
    if (!strands || !people) return;
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
        const [rows, list, folk] = await Promise.all([
          readWindow(supabase as unknown as WindowClient | null, Date.now()),
          strands.list(),
          // The one place that assembles the list (peopleFacts.ts:17): local
          // caches only, never a fetch, and an empty list on any failure.
          // Same three reads TodaySuggestions.tsx:110 already makes here.
          peopleForDerivation(people),
        ]);
        if (!live) return;
        consolidate(brainMoments(rows, list, folk), today);
      } catch {
        // A failed window read means no decision today, which is exactly
        // what consolidate refuses to write anyway: an empty set is not an
        // answer, and recording one would silence a real proposal for a day.
        ranFor.current = "";
      }
    })();
    return () => { live = false; };
  }, [strands, people, dayKey]);

  return null;
}
