import { Mic } from "lucide-react";

// JARVIS voice capture bar, docked above the tab bar on main tab screens
// (approved app-wide). Canonical .voice-bar. The voice feature itself lands
// later (Milestone C); for now this is the affordance, inert on tap.
export default function VoiceBar({ onTap }: { onTap?: () => void }) {
  return (
    <div className="pad-x voice-dock">
      <button className="voice-bar" onClick={onTap} aria-label="Talk to JARVIS">
        <div className="voice-mic">
          <Mic className="ic" />
        </div>
        <div className="voice-name">JARVIS</div>
        <div className="voice-hint">Tap to capture</div>
      </button>
    </div>
  );
}
