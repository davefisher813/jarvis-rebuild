import { useState } from "react";
import type { TookItMark } from "../timelines";

// TOOK IT (Part 4). One tap, three seconds, offline. Timestamped by the tap
// itself, never by a schedule: there is no "expected dose" concept anywhere
// near this screen, so there is nothing for it to render as a miss count.
// The timeline below shows only what happened, in order, forever.
export default function TookItScreen({ timeline, onLog, onBack }: {
  timeline: TookItMark[];
  onLog: () => void;
  onBack: () => void;
}) {
  const [justTapped, setJustTapped] = useState(false);
  const tap = () => { onLog(); setJustTapped(true); };
  const recent = [...timeline].reverse().slice(0, 14);

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Took It</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">One Tap</div>
        <div className="bp-sub">Marks the moment. Only a timeline of what happened, never a tally of anything left undone.</div>
      </div></div>

      <div className="pad-x">
        {justTapped ? (
          <div className="card pad">
            <div className="conn-name">Logged</div>
            <button className="btn btn-secondary btn-block" onClick={onBack}>Done</button>
          </div>
        ) : (
          <button className="btn btn-primary btn-block btn-lg" onClick={tap}>Took It</button>
        )}
      </div>

      {recent.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">The Timeline</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {recent.map((m, i) => (
              <div className="row" key={i}><div className="row-grow"><div className="conn-name">{new Date(m.at).toLocaleString()}</div></div></div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
