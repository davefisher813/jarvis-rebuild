import { useState } from "react";
import { musicFor, rememberMusic, forgetMusic, labelForUrl, MUSIC_PRESETS, type MusicContext } from "./music";
import { haptics } from "../shared/haptics";

// Music, Tier 1 (addendum item 5, approved preview 2026-08-15). One chip in
// a context. No memory: tapping opens the picker (self-introducing), the
// pick opens the player AND becomes the memory. With memory: one tap
// straight to the remembered link; the picker stays reachable to change or
// forget (self-deleting). Never auto-starts anything: every open is a tap.
export default function MusicChip({ context }: { context: MusicContext }) {
  const [open, setOpen] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const remembered = musicFor(context);

  const go = (url: string) => {
    window.open(url, "_blank", "noopener");
  };

  const pick = (label: string, url: string) => {
    haptics.selection();
    rememberMusic(context, { label, url });
    setOpen(false);
    setPasting(false);
    go(url);
  };

  if (!open) {
    return (
      <div className="chip-row">
        <div
          className="chip"
          role="button"
          tabIndex={0}
          onClick={() => {
            if (remembered) { haptics.selection(); go(remembered.url); }
            else setOpen(true);
          }}
        >
          {remembered ? remembered.label : "Music"}
        </div>
        {remembered && (
          <div className="chip" role="button" tabIndex={0} aria-label="Change music" onClick={() => setOpen(true)}>Change</div>
        )}
      </div>
    );
  }

  return (
    <div className="chip-row chip-picker-open">
      {MUSIC_PRESETS.map((p) => (
        <div key={p.label} className="chip" role="button" tabIndex={0} onClick={() => pick(p.label, p.url)}>{p.label}</div>
      ))}
      {!pasting && (
        <div className="chip" role="button" tabIndex={0} onClick={() => setPasting(true)}>Paste a Link</div>
      )}
      {pasting && (
        <input
          className="input music-paste"
          placeholder="Playlist link"
          value={pasted}
          autoFocus
          onChange={(e) => setPasted(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pasted.trim()) pick(labelForUrl(pasted.trim()), pasted.trim());
            if (e.key === "Escape") setPasting(false);
          }}
        />
      )}
      {remembered && (
        <div className="chip" role="button" tabIndex={0} onClick={() => { forgetMusic(context); setOpen(false); }}>Forget</div>
      )}
      <div className="chip" role="button" tabIndex={0} onClick={() => { setOpen(false); setPasting(false); }}>Cancel</div>
    </div>
  );
}
