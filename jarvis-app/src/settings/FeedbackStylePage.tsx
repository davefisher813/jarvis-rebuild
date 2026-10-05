import { useFeedback } from "../encourage/FeedbackProvider";
import { previewTone } from "../encourage/effects";
import type { Celebration, Encouragement, FeedbackPrefs, MotionPref } from "../encourage/prefs";
import { useSettings } from "../data/NotesProvider";
import { SETTING_FEEDBACK } from "../data/SettingsService";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Volume2 } from "../shared/icons";
import { Head, Card, Menu, Row, Switch, Foot } from "./kit";

// FEEDBACK STYLE (ADHD Reward Design Brief, Dave-approved 2026-10-04).
//
// Good defaults and nothing to set up: Celebration Gentle, Motion follows the
// phone, no sound, no haptics, brief factual words, private. Every control
// here is independent of the others, and none of them can switch off the
// plain sentence that says what just changed, because that sentence is not a
// celebration, it is the state.
//
// THE CATALOG PASS (2026-10-05, Dave "I am sick of this"). A grey line under a
// row name is Title Case like every other sub line, and says something the
// row does not already say: "Plays the tone once" under Hear It and "Off by
// default" under Haptics (the note below says both start off) were dropped.
// Hear It is a tap with nothing to show it, so it wears the capsule. The
// notes under a card are field notes: one sentence, or fragments joined by a
// dot, never two sentences ("Off keeps..." after a full stop).
//
// Persisted per account like Appearance (the provider applies it to this
// session at once, the mirror keeps it offline, the account write makes the
// next phone already right). Quiet Today is the one exception: it is for
// today only, so it lives on this device and ends at midnight.

const CELEBRATION: { value: Celebration; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "gentle", label: "Gentle" },
  { value: "expressive", label: "Expressive" },
];
const MOTION: { value: MotionPref; label: string }[] = [
  { value: "system", label: "Follow System" },
  { value: "reduced", label: "Reduced" },
];
const WORDS: { value: Encouragement; label: string }[] = [
  { value: "factual", label: "Brief Factual" },
  { value: "warm", label: "Warm" },
  { value: "minimal", label: "Minimal" },
];

export default function FeedbackStylePage({ onBack }: { onBack: () => void }) {
  const { prefs, apply, quiet, setQuiet } = useFeedback();
  const settings = useSettings();

  // No failure toast, for the reason AppearancePage gives: offline the
  // change stays in the mirror and goes up on the next pull or set.
  const save = (patch: Partial<FeedbackPrefs>) => {
    const next = apply(patch);
    void settings?.set(SETTING_FEEDBACK, next);
  };

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Feedback Style" back="Settings" onBack={onBack} />

      <Head label="Celebration" />
      <Card>
        <Menu label="Celebration" value={prefs.celebration} options={CELEBRATION}
          onPick={(v) => save({ celebration: v as Celebration })} />
      </Card>
      <Foot>Gentle is a checkmark and one short pulse, and Off keeps only the plain line saying what changed</Foot>

      <Head label="Motion" />
      <Card>
        <Menu label="Motion" value={prefs.motion} options={MOTION}
          onPick={(v) => save({ motion: v as MotionPref })} />
      </Card>
      <Foot>{"Follow System uses your phone\u2019s Reduce Motion, and Reduced removes every pulse"}</Foot>

      <Head label="Sound and Touch" />
      <Card>
        <Switch label="Completion Sound" meta="One Short Quiet Tone" on={prefs.sound}
          onToggle={() => save({ sound: !prefs.sound })} />
        <Row label="Hear It" value={<Volume2 className="ic row-verb-ic" aria-hidden="true" />} onClick={() => { previewTone(); }} />
        <Switch label="Haptics" on={prefs.haptics}
          onToggle={() => save({ haptics: !prefs.haptics })} />
      </Card>
      <Foot>Both start off, and neither is ever the only way you find out something was saved</Foot>

      <Head label="Words" />
      <Card>
        <Menu label="Encouragement" value={prefs.encouragement} options={WORDS}
          onPick={(v) => save({ encouragement: v as Encouragement })} />
      </Card>

      <Head label="Sharing" />
      <Card>
        {/* ONE LINE, NOT THE SAME THING TWICE (2026-10-05): "Private" beside "Nothing About Your Tasks Is Shared" said it
            twice and crowded the subtext. The sentence stays; a row with nothing to tap has no value at the right. */}
        <Row label="Accountability" meta="Nothing About Your Tasks Is Shared" plain />
      </Card>

      <Head label="Today" />
      <Card>
        <Switch label="Quiet Today" meta="No Pulse, Sound or Tap Until Midnight" on={quiet}
          onToggle={() => setQuiet(!quiet)} />
      </Card>
      <Foot>Reminders and your progress stay exactly as they are.</Foot>
      <div className="screen-foot" />
    </div>
  );
}
