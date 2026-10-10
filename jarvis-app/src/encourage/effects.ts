import { haptics } from "../shared/haptics";
import { todayISO } from "../tasks/grouping";
import { effectiveFeedback, isQuietToday, readFeedback, systemPrefersReducedMotion } from "./prefs";

// THE SENSORY CHANNELS, one at a time and only when asked for.
//
// The pulse is CSS (components.css, keyed on html[data-celebrate]) so it
// costs no script and removes itself under reduced motion. What is here is
// the two channels CSS cannot do: the tone and the phone's tap. Both are off
// until chosen, both are silenced by Quiet Today, and neither is ever the
// only confirmation of anything: the sentence on screen is.

/** What is switched on at this instant, read fresh each time so a setting
 *  changed a second ago is already honored. */
export function currentEffective() {
  return effectiveFeedback(readFeedback(), {
    systemReduced: systemPrefersReducedMotion(),
    quiet: isQuietToday(todayISO()),
  });
}

let audio: AudioContext | null = null;
let lastTone = 0;
const TONE_GAP_MS = 600;

/** One short quiet tone. Never repeated inside TONE_GAP_MS, so completing a
 *  whole list in one go makes one sound, not a chime per row. */
export function playTone(now: number = Date.now()): boolean {
  if (now - lastTone < TONE_GAP_MS) return false;
  try {
    const Ctor = typeof window === "undefined" ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return false;
    audio = audio ?? new Ctor();
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.2);
    lastTone = now;
    return true;
  } catch {
    return false;
  }
}

// WHICH CELEBRATION (Dave 2026-10-05, the craft playbook: "completion
// celebrations that vary"). The reward is always certain and only its FORM
// changes (shared/completion.ts, finding 4), so the same one does not play
// every time. CELEBRATION_FORMS is how many there are; each is under a
// second, each is a different SHAPE of the same acknowledgment, and none of
// them is the only confirmation of anything. The forms take turns in a fixed
// order, so nothing here is chance (laws/feedback: nothing is random) and the
// one that just played never plays twice in a row. The form is carried on the
// document root as data-cv so the stylesheet (Gentle) and the Burst
// (Expressive) read one choice, and it collapses to nothing under Reduced
// Motion because the stylesheet and the Burst already do.
export const CELEBRATION_FORMS = 3;
let turn = -1;

/** The next form in the rotation. Never the one that just played. */
export function nextCelebrationForm(): number {
  turn = (turn + 1) % CELEBRATION_FORMS;
  return turn;
}

/** The form on the page right now (0 before the first completion). */
export function currentCelebrationForm(): number {
  if (typeof document === "undefined") return 0;
  const n = Number(document.documentElement.dataset.cv);
  return Number.isInteger(n) && n >= 0 && n < CELEBRATION_FORMS ? n : 0;
}

/** Choose the form for the completion that is happening now and publish it.
 *  Called by playCompletion, which the bus calls once per real completion. */
export function chooseCelebrationForm(): number {
  const form = nextCelebrationForm();
  if (typeof document !== "undefined") document.documentElement.dataset.cv = String(form);
  return form;
}

/** The channels for one completion the person just made: the form of the
 *  celebration, then the tone and the tap, each only if chosen and not
 *  quieted. Call it once per real change of state, never from a render or a
 *  sync. */
export function playCompletion(): void {
  chooseCelebrationForm();
  const eff = currentEffective();
  if (eff.sound) playTone();
  // The completion tap is a choice (Feedback Style > Haptics); when it is not
  // chosen, or Quiet Today holds it, the completion still answers with the
  // same light confirm any committing tap gets, so finishing a task never
  // feels like nothing (Apple sprint, haptics, 2026-10-10).
  if (eff.haptic) haptics.success();
  else haptics.confirm();
}

/** The Hear It row in settings: plays the tone even while the switch is off,
 *  because previewing is how someone decides, and still respects Quiet Today
 *  being a decision about today only (a preview is an explicit tap). */
export function previewTone(): boolean {
  lastTone = 0;
  return playTone();
}
