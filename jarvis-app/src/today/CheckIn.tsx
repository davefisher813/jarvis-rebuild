import { useCallback, useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import { todayISO } from "../schedule/calendar";
import { haptics } from "../shared/haptics";
import type { ProfileData } from "../profile/types";
import NoticeCard from "./NoticeCard";
import { SunGlyph } from "../shared/glyphs";

// The evening check-in: ONE question, every answer a single tap, dismissing is
// guilt-free and gone for the day. The morning "one thing" and "still on for"
// questions were removed 2026-07-30 (Dave: no repetition on Today): Up Next
// answers "what's my one thing," and overdue triage lives on the Tasks page.
// The mood answer stays because nothing else collects it: it sizes tomorrow's
// plan (daySizing) and feeds pattern awareness.
//
// THE CARD SHOWS ITS WORK (Dave 2026-08-29: "does how did today feel actually
// provide value?"). It did -- an Underwater answer caps tomorrow at four
// blocks with extra slack, and fourteen days of answers feed the pattern
// observations -- but none of that was visible, so the card read as a mood
// diary with no reader. Two fixes, both honest: the card itself says what the
// answer is FOR ("Shapes tomorrow's plan"), and the confirmation states the
// actual consequence of the answer given. Underwater is the only answer that
// changes tomorrow's shape, so it is the only one that claims to.

const SPARK = (
  <SunGlyph />
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

  // THE NOTICE LAW (catalog R). One card, one glyph, one control on the
  // visible line, same as everything else in the app. It was the last
  // surviving user of the retired icon-tile section head (sec-ico +
  // sec-title), which is exactly the "why is this sectioned off differently"
  // Dave has rejected every time it has appeared.
  //
  // It no longer lives in the Heads Up stream (Dave, 2026-08-21). It renders
  // at the FOOT of Today, because it is the end-of-day question and Heads Up
  // is the list of things to act on now.
  //
  // The three moods are ANSWERS, not competing actions, so they ride the
  // card's foot rather than fighting the dismiss for the visible line.
  return (
    <NoticeCard
      icon={SPARK}
      tone="cat-fg-blue"
      title="How Did Today Feel?"
      sub="Shapes tomorrow's plan"
      onDismiss={async () => { await saveDay({ addSkip: "mood" }); haptics.selection(); setShow(false); }}
      foot={
        <div className="row check-moods">
          {/* Plain text, no emoji (Dave 2026-09-02: "This is an eye sore on
              the homepage"). This was the only emoji anywhere in the app --
              everywhere else a tri-state answer is a plain-text chip (the
              gym's "All Clean" / "Last One Was a Grind" / "Missed One"
              being the closest sibling), so these three match that instead
              of standing out as their own thing. */}
          {[["fire", "Flow"], ["meh", "Meh"], ["under", "Underwater"]].map(([v, label]) => (
            <div className="chip" role="button" tabIndex={0} key={v} onClick={async () => {
              await saveDay({ mood: v });
              haptics.selection();
              // The consequence, not a pleasantry. Only "under" resizes
              // tomorrow (daySizing), so only "under" says it will.
              setAffirm(v === "under" ? "Noted · Tomorrow runs lighter on purpose" : "Noted · Helps me plan tomorrow");
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
