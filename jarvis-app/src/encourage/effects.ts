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

/** The channels for one completion the person just made: the tone and the
 *  tap, each only if chosen and not quieted. Call it once per real change of
 *  state, never from a render or a sync. */
export function playCompletion(): void {
  const eff = currentEffective();
  if (eff.sound) playTone();
  if (eff.haptic) haptics.success();
}

/** The Hear It row in settings: plays the tone even while the switch is off,
 *  because previewing is how someone decides, and still respects Quiet Today
 *  being a decision about today only (a preview is an explicit tap). */
export function previewTone(): boolean {
  lastTone = 0;
  return playTone();
}
