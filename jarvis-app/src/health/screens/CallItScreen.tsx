import { useState } from "react";
import type { CallItPoint } from "../timelines";

const BLOCKS = Array.from({ length: 10 }, (_, i) => i + 1);

// CALL IT (Part 2). End-of-session exertion: one tap on a 0-10 scale
// rendered as ten fat blocks, no text to read. Session-RPE, and per the
// catalog it "must never aggregate into a readiness verdict": this screen
// and its history feed nothing but a plain list of past sessions.
//
// Health's inherited color ban applies here same as everywhere else in the
// module (CATEGORY_KINDS: "anything red"), so the blocks ramp on --blue's
// own opacity rather than a red-to-green gradient.
export default function CallItScreen({ durationMin, history, onLog, onBack }: {
  durationMin?: number; // auto-filled from the calendar event, when there is one
  history: CallItPoint[];
  onLog: (rpe: number) => void;
  onBack: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [logged, setLogged] = useState(false);

  const submit = (n: number) => {
    setPicked(n);
    onLog(n);
    setLogged(true);
  };

  const recent = [...history].reverse().slice(0, 10);

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Call It</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">How Hard Was That</div>
        <div className="bp-sub">{durationMin ? capMinutes(durationMin) + " · Tap a block, easiest on the left" : "Tap a block, easiest on the left"}</div>
      </div></div>

      <div className="pad-x">
        {logged ? (
          <div className="card pad">
            <div className="conn-name">Logged {picked} Of 10</div>
            <button className="btn btn-secondary btn-block" onClick={onBack}>Done</button>
          </div>
        ) : (
          <div className="rpe-blocks">
            {BLOCKS.map((n) => (
              <button
                key={n}
                type="button"
                className="rpe-block"
                style={{ "--i": n } as React.CSSProperties}
                aria-label={"Effort " + n + " of 10"}
                onClick={() => submit(n)}
              />
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Recent Sessions</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {recent.map((p, i) => (
              <div className="row" key={i}>
                <div className="row-grow"><div className="conn-name">{new Date(p.at).toLocaleDateString()}</div></div>
                <span className="pill">{p.rpe}/10</span>
              </div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}

function capMinutes(n: number): string {
  return n + " Minutes";
}
