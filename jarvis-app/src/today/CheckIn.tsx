import { useCallback, useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import { todayISO } from "../schedule/calendar";
import { haptics } from "../shared/haptics";
import type { ProfileData } from "../profile/types";
import NoticeCard from "./NoticeCard";

// The evening check-in: ONE question, every answer a single tap, dismissing is
// guilt-free and gone for the day. The morning "one thing" and "still on for"
// questions were removed 2026-07-30 (Dave: no repetition on Today): Up Next
// answers "what's my one thing," and overdue triage lives on the Tasks page.
// The mood answer stays because nothing else collects it: it sizes tomorrow's
// plan (daySizing) and feeds pattern awareness.

const SPARK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>
);

export default function CheckIn({ onChanged }: { onChanged?: () => void }) {
  const profileSvc = useProfile();
  const [show, setShow] = useState(false);
  const [affirm, setAffirm] = useState<string | null>(null);
  const today = todayISO();

  const load = useCallback(async () => {
    const prof = await profileSvc.get();
    const day = prof?.checkin?.[today] ?? {};
    const skip = day.skip ?? [];
    const hour = new Date().getHours();
    setShow(hour >= 18 && !day.mood && !skip.includes("mood"));
  }, [profileSvc, today]);

  useEffect(() => { void load(); }, [load]);

  const saveDay = async (patch: { mood?: string; addSkip?: string }) => {
    const prof = await profileSvc.get();
    const all = { ...(prof?.checkin ?? {}) };
    const day = { ...(all[today] ?? {}) };
    if (patch.mood) day.mood = patch.mood;
    if (patch.addSkip) day.skip = [...(day.skip ?? []), patch.addSkip];
    // keep only the last 14 days so the profile record stays small
    all[today] = day;
    const keep = Object.keys(all).sort().slice(-14);
    const trimmed: NonNullable<ProfileData["checkin"]> = {};
    for (const k of keep) trimmed[k] = all[k]!;
    await profileSvc.save({ checkin: trimmed });
  };

  if (affirm) {
    return (
      <div className="pad-x"><div className="card"><div className="row">
        <div className="conn-name">{affirm}</div>
      </div></div></div>
    );
  }
  if (!show) return null;

  // THE NOTICE LAW (catalog R). This lives in the Heads Up stream, so it is
  // built like everything else in it: one card, one glyph, one control on the
  // visible line. It was the last surviving user of the retired icon-tile
  // section head (sec-ico + sec-title), which meant the one card in the
  // stream that was not a card. That is exactly the "why is this sectioned
  // off differently" Dave has rejected every time it has appeared.
  //
  // The three moods are ANSWERS, not competing actions, so they ride the
  // card's foot rather than fighting the dismiss for the visible line.
  return (
    <NoticeCard
      icon={SPARK}
      tone="cat-fg-blue"
      title="How Did Today Feel?"
      onDismiss={async () => { await saveDay({ addSkip: "mood" }); haptics.selection(); setShow(false); }}
      foot={
        <div className="row check-moods">
          {[["fire", "🔥 Flow"], ["meh", "😐 Meh"], ["under", "🌊 Underwater"]].map(([v, label]) => (
            <div className="chip" role="button" tabIndex={0} key={v} onClick={async () => {
              await saveDay({ mood: v });
              haptics.selection();
              setAffirm("Noted · helps me plan");
              setShow(false);
              onChanged?.();
              window.setTimeout(() => setAffirm(null), 3500);
            }}>{label}</div>
          ))}
        </div>
      }
    />
  );
}
