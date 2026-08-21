import { Sparkles, Search, Zap } from "lucide-react";

// Quick-capture bar docked above the tab bar on main tab screens. Tapping it
// opens text Quick Capture, where JARVIS parses what you type into tasks,
// events, or notes. Voice (speech) is a native-phase feature; this is text.
//
// Search rides here too (2026-08-09): this bar is the one piece of chrome on
// every tab, and search used to be reachable only from Today's header, which
// meant "go to Today first" as a search step. Same dock, one more tap target.
export default function VoiceBar({ onTap, onSearch, onWhatNow }: { onTap?: () => void; onSearch?: () => void; onWhatNow?: () => void }) {
  return (
    <div className="pad-x voice-dock">
      <button className="voice-bar" onClick={onTap} aria-label="Quick capture">
        <div className="voice-mic"><Sparkles className="ic" /></div>
        <div className="voice-name">JARVIS</div>
        <div className="voice-hint">Tap to capture</div>
      </button>
      {/* WHAT NOW (button round, kept after the research). This bar is the one
          piece of chrome on every tab, which is the entire reason the button
          belongs here: being stuck is not a thing that happens on the Today
          screen, it happens wherever you are. One tap, one thing, no list. */}
      {onWhatNow && (
        <button className="voice-search voice-now" onClick={onWhatNow} aria-label="What should I do now">
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
