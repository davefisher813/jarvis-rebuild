// THE GYM'S ONE BEEP (GYM-F-01, 2026-09-05). ConditioningFace grew this for
// its own clock: a sine blip through a gain ramp, scheduled against the
// AudioContext clock so a three-note finish lands on time even when React is
// busy. The rest timer needed the same cue at zero and had none, so the
// oscillator moved here where both can call it. Audio is a courtesy, never
// a crash: every path swallows its own errors and a missing AudioContext
// simply means silence.

export function openAudio(): AudioContext | null {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    return AC ? new AC() : null;
  } catch {
    return null;
  }
}

export function beep(ctx: AudioContext | null, hz = 880, ms = 120, when = 0): void {
  if (!ctx) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = hz;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.start(t); o.stop(t + ms / 1000 + 0.02);
  } catch { /* audio is a courtesy, never a crash */ }
}

/** The face's finish: two low notes and a high one. The rest timer plays the
 *  same phrase at zero so a pocketed phone gets the same cue either way. */
export function beepDone(ctx: AudioContext | null): void {
  beep(ctx, 660, 220, 0); beep(ctx, 660, 220, 0.28); beep(ctx, 990, 420, 0.56);
}
