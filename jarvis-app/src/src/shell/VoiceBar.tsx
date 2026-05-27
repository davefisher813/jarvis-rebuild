import { Sparkles } from "lucide-react";

// Quick-capture bar docked above the tab bar on main tab screens. Tapping it
// opens text Quick Capture, where JARVIS parses what you type into tasks,
// events, or notes. Voice (speech) is a native-phase feature; this is text.
export default function VoiceBar({ onTap }: { onTap?: () => void }) {
  return (
    <div className="pad-x voice-dock">
      <button className="voice-bar" onClick={onTap} aria-label="Quick capture">
        <div className="voice-mic"><Sparkles className="ic" /></div>
        <div className="voice-name">JARVIS</div>
        <div className="voice-hint">Tap to capture</div>
      </button>
    </div>
  );
}
