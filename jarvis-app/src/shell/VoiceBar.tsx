import { useEffect, useState } from "react";
import { Mic, Search, Zap } from "../shared/icons";
import { barLinesFor, captureCount, ROTATE_FOR } from "../capture/examples";

// THE SPEECH BOX'S FRONT DOOR (2026-10-31, the Oct 28 research: "a slim capture bar docked at the bottom of every screen, right
// above the tab bar. One text field, one big mic button.").
//
// Two doors in one pill: the words open the capture sheet for typing, and the red mic at the trailing end opens it already
// recording. The words are an example of what to say, re-ordered by the screen he is on and rotating every four seconds for
// his first twenty captures; after that, or with Reduce Motion on, the screen's one example stands still. Nothing here saves:
// the sheet's own button is the only way anything is filed (voice never saves on its own).
//
// Search and What Now ride beside it (2026-08-09, the button round): this bar is the one piece of chrome on every tab.
const ROTATE_MS = 4000;

function reducedMotion(): boolean {
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export default function VoiceBar({ onTap, onMic, onSearch, onWhatNow, screen = "today" }: {
  onTap?: () => void;
  /** Opens the capture sheet already recording. Absent, the bar has no mic (a build that cannot record says so in the sheet). */
  onMic?: () => void;
  onSearch?: () => void;
  onWhatNow?: () => void;
  /** The screen he is standing on, so its kind of thing is the first example. */
  screen?: string;
}) {
  const lines = barLinesFor(screen);
  const [rotate] = useState(() => captureCount() < ROTATE_FOR && !reducedMotion());
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [screen]);
  useEffect(() => {
    if (!rotate || lines.length < 2) return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setI((n) => (n + 1) % lines.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [rotate, lines.length]);
  const hint = lines[i % lines.length] ?? "Add Anything";
  return (
    <div className="pad-x voice-dock">
      <div className="voice-bar">
        <button type="button" className="voice-field" onClick={onTap} aria-label="Quick capture">
          <span className="voice-hint" aria-hidden="true">{hint}</span>
        </button>
        {onMic && (
          <button type="button" className="voice-mic" onClick={onMic} aria-label="Voice capture">
            <Mic className="ic" />
          </button>
        )}
      </div>
      {/* WHAT NOW (button round, kept after the research). Being stuck happens wherever you are. */}
      {onWhatNow && (
        <button className="voice-search" onClick={onWhatNow} aria-label="What should I do now">
          <Zap className="ic" />
        </button>
      )}
      {onSearch && (
        <button className="voice-search" onClick={onSearch} aria-label="Search everything">
          <Search className="ic" />
        </button>
      )}
    </div>
  );
}
