import { createPortal } from "react-dom";
import { SAY_GROUPS } from "./examples";

// WHAT CAN I SAY? (the speech box, 2026-10-31; the research, section 3, item 4: "a sheet grouped by the types, each with
// examples, including the two failure-avoiders"). It never fades. Tapping an example puts it in the box to say or change; it
// saves nothing.
export default function SaySheet({ onPick, onClose }: { onPick: (example: string) => void; onClose: () => void }) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card xs" role="dialog" aria-label="What Can I Say" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="opt-bar">
          <div className="opt-title">What Can I Say?</div>
          <button type="button" className="opt-done" onClick={onClose}>Done</button>
        </div>
        <div className="sheet-list">
          {SAY_GROUPS.map((g) => (
            <div key={g.kind}>
              <div className="sh2 sh2-quiet"><span className="t">{g.title}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {g.examples.map((ex, i) => (
                  <button key={ex} type="button" className="row say-row" onClick={() => onPick(ex)}>
                    <div className="row-grow">
                      <div className="conn-name">{ex}</div>
                      {/* The how-to rides the first example only: said once per kind, never repeated down the list. */}
                      {i === 0 && <div className="conn-meta">{g.tip}</div>}
                    </div>
                  </button>
                ))}
              </div></div>
            </div>
          ))}
        </div>
        <div className="xs-foot" />
      </div>
    </div>,
    document.body,
  );
}
