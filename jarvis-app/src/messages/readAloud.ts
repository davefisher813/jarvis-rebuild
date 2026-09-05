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

// EMAIL-F-25 (2026-09-05): "Read It to Me pill stays on Stop after the speech
// ends." This returned true and never said another word, so the pill sat on
// Stop after the voice had finished: tapping it cancelled nothing and flipped
// to Play, and it took a second tap to hear anything. `onEnd` fires when the
// utterance finishes, is cancelled, or errors, which are the three ways the
// speaking stops, so the control can follow the voice instead of the tap.
export function speak(text: string, onEnd?: () => void): boolean {
  if (!canSpeak() || !text.trim()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    if (onEnd) {
      let done = false;
      const fire = () => { if (done) return; done = true; onEnd(); };
      u.onend = fire;
      u.onerror = fire;
    }
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  try { window.speechSynthesis?.cancel(); } catch { /* not available */ }
}
