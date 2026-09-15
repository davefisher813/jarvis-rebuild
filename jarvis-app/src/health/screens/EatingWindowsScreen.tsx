import type { EatingWindowOffer } from "../eatingWindows";
import { pressable } from "../../shared/pressable";

// EATING WINDOWS (Part 3). Scans tomorrow for gaps too tight for a meal and
// offers a schedule action. No nutrition content anywhere on this screen.
export default function EatingWindowsScreen({ offers, onTakeOffer, onBack }: {
  offers: EatingWindowOffer[];
  onTakeOffer: (offer: EatingWindowOffer) => void;
  onBack: () => void;
}) {
  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Eating Windows</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Where the Day Leaves No Room</div>
        <div className="bp-sub">A schedule gap, nothing about what or how much.</div>
      </div></div>

      {offers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">Tomorrow Has Room</div>
          <div className="empty-sub">No gap tomorrow is too tight for a meal to fit</div>
        </div>
      ) : (
        <div className="pad-x"><div className="card list-card-ruled">
          {offers.map((o, i) => (
            // Row tap (Dave 2026-09-15): the offer row takes its offer, Pack It.
            <div className="row" key={i} {...pressable(() => onTakeOffer(o))}>
              <div className="row-grow">
                <div className="conn-name">{o.line}</div>
                <div className="bp-sub">{o.gap.minutes} Minutes</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={(ev) => { ev.stopPropagation(); onTakeOffer(o); }}>Pack It</button>
            </div>
          ))}
        </div></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
