import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalProfile } from "../data/NotesProvider";
import { attemptWrite } from "../shared/guard";
import { readEmailSections, type EmailSection } from "./emailSections";

// THE USER'S EMAIL SECTIONS, read from and written to the profile (2026-09-29).
//
// One field on the profile, `emailSections`, through ProfileService's field
// patch: a save carries only this field, never the whole profile, so it cannot
// overwrite anything another screen or device owns, and offline it queues like
// every other profile write (`pending()` says so). It is not mirrored into the
// legacy `mail` object and there is no localStorage copy.
//
// Reading and writing make no AI call and no Gmail call.
//
// `commit` is the only writer. It resolves true when the write landed and only
// THEN moves what the screen shows, so a failed save leaves the list, and
// whatever the person was typing, exactly as they were (attemptWrite has
// already told them). The Email tab remounts on every visit, so it re-reads
// here and sees a change made in Settings.

export function useEmailSections(): {
  sections: EmailSection[];
  loaded: boolean;
  available: boolean;
  /** The list as last saved or read, for a caller inside an async handler. */
  current: () => EmailSection[];
  commit: (next: EmailSection[]) => Promise<boolean>;
  pending: () => boolean;
} {
  const profile = useOptionalProfile();
  const [sections, setSections] = useState<EmailSection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<EmailSection[]>([]);

  useEffect(() => {
    let on = true;
    if (!profile) { setLoaded(true); return; }
    void profile.get()
      .then((p) => readEmailSections(p?.emailSections))
      .catch(() => [] as EmailSection[])
      .then((list) => {
        if (!on) return;
        latest.current = list;
        setSections(list);
        setLoaded(true);
      });
    return () => { on = false; };
  }, [profile]);

  const commit = useCallback(async (next: EmailSection[]): Promise<boolean> => {
    if (!profile) return false;
    const ok = await attemptWrite(() => profile.save({ emailSections: next }));
    if (ok) { latest.current = next; setSections(next); }
    return ok;
  }, [profile]);

  return {
    sections,
    loaded,
    available: !!profile,
    current: () => latest.current,
    commit,
    pending: () => profile?.pending() ?? false,
  };
}
