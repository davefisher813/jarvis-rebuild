import type { MailNotice } from "./home";

// READ ME THE INBOX (N12, Dave 2026-08-20).
//
// For the car, the gym, anywhere reading is not happening. Thirty seconds of
// speech that leaves him knowing what is waiting, without a screen.
//
// Laws:
//   - It says the SAME things the cards say. A spoken summary that disagrees
//     with the visible one is worse than no spoken summary.
//   - It never reads an email body aloud. Gists and senders only: a private
//     message read out in a car with other people in it is a real harm, and
//     nothing here is worth that.
//   - Speech, not prose: no dot separators, no counts he has to hold in his
//     head, no "item three of five".

export function speakable(notices: MailNotice[], sentence: string): string {
  if (notices.length === 0) return "Nothing in your inbox needs you.";
  const lines = notices.map((n) => {
    switch (n.kind) {
      case "deadline": return `${n.title} is due today. ${n.sub.replace(/·/g, ",")}.`;
      case "reply": return `${n.title} is waiting on an answer. ${n.sub}.`;
      case "promised": return `You said you would ${lower(n.title)}.`;
      case "nudge": return `${n.title.replace(/ Hasn't Replied$/, "")} still hasn't replied.`;
      default: return n.title;
    }
  });
  const head = sentence ? sentence.replace(/·/g, ",") + ". " : "";
  return (head + lines.join(" ")).replace(/\s+/g, " ").trim();
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// The browser's own voice. Absent on some platforms, which is a real answer:
// the button is not shown rather than shown and dead (the Button Law).
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// E-22 (Push D, 2026-09-12): PAUSE AND NEXT. The whole summary was one
// utterance, so the only control was Stop, and a pause meant starting the
// thirty seconds over. SpeechSynthesis has pause()/resume(), but the resume
// position is unreliable across engines (Safari drops the tail, Chrome
// stalls after a pause of more than a few seconds), so this player does
// not trust it: it speaks one SENTENCE per utterance and keeps the sentence
// index itself. Pause cancels and remembers the index; Play from paused
// speaks that sentence again from its start; Next cancels and speaks the
// following one. Each sentence is one notice's line, so the laws above are
// untouched: it still says what the cards say, and never a body.
//
// EMAIL-F-25 (2026-09-05): "Read It to Me pill stays on Stop after the
// speech ends." `onEnd` fires once when the LAST sentence finishes, is
// cancelled by Stop, or errors, so the control follows the voice instead of
// the tap. A Pause is not an end: the row shows Play again and the index
// waits.

export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

interface Player { sentences: string[]; at: number; onEnd?: () => void }
let player: Player | null = null;
let gen = 0;

function speakAt(pl: Player): boolean {
  const text = pl.sentences[pl.at];
  if (text === undefined) { const end = pl.onEnd; player = null; end?.(); return false; }
  const myGen = ++gen;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    let fired = false;
    const fire = () => {
      if (fired || myGen !== gen || player !== pl) return; // paused, skipped, or stopped: not an end
      fired = true;
      pl.at += 1;
      speakAt(pl);
    };
    u.onend = fire;
    u.onerror = fire;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    player = null;
    return false;
  }
}

/** Speak `text` from the top. Returns whether anything is speaking. */
export function speak(text: string, onEnd?: () => void): boolean {
  if (!canSpeak() || !text.trim()) return false;
  const sentences = sentencesOf(text);
  if (sentences.length === 0) return false;
  player = { sentences, at: 0, ...(onEnd ? { onEnd } : {}) };
  return speakAt(player);
}

/** Cancel the voice, keep the place. The row goes back to Play. */
export function pauseSpeaking(): void {
  gen += 1; // orphan the in-flight utterance's end handler
  try { window.speechSynthesis?.cancel(); } catch { /* not available */ }
}

/** Play from where Pause left off. False when there is nothing paused. */
export function resumeSpeaking(): boolean {
  if (!player || !canSpeak()) return false;
  return speakAt(player);
}

/** Skip to the next sentence. False when that was the last one (onEnd has
 *  fired) or nothing is playing. */
export function nextSentence(): boolean {
  if (!player || !canSpeak()) return false;
  gen += 1;
  try { window.speechSynthesis.cancel(); } catch { /* not available */ }
  player.at += 1;
  return speakAt(player);
}

export function stopSpeaking(): void {
  gen += 1;
  const pl = player;
  player = null;
  try { window.speechSynthesis?.cancel(); } catch { /* not available */ }
  // Stop is an end: the control follows the voice (EMAIL-F-25).
  pl?.onEnd?.();
}
