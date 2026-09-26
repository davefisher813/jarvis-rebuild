import type { ThirdPracticeOffer } from "../thirdPractice";
import { pressable } from "../../shared/pressable";
import { weekdayShortDate } from "../../shared/dateFormat";

// THE THIRD PRACTICE (Part 2, rank #1). One day, more than one sport
// commitment across different orgs. Stated once, as a fact, with an offer.
// Never a warning, never red, never a recurring nag.
export default function ThirdPracticeScreen({ offers, onProtectGap, onBack }: {
  offers: ThirdPracticeOffer[];
  onProtectGap: (offer: ThirdPracticeOffer) => void;
  onBack: () => void;
}) {
  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Third Practice</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Days with More Than One Team</div>
        <div className="bp-sub">Stated once, no color, no repeat nag.</div>
      </div></div>

      {offers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Day Carries Two Teams Right Now</div>
          <div className="empty-sub">A day that does shows up here, once</div>
        </div>
      ) : (
        <div className="pad-x"><div className="card list-card-ruled">
          {offers.map((o, i) => (
            // Row tap (Dave 2026-09-15): the offer row takes its offer, Protect a Gap.
            <div className="row" key={i} {...pressable(() => onProtectGap(o))}>
              <div className="row-grow">
                <div className="conn-name">{weekdayShortDate(o.fact.date)}</div>
                {/* The teams are one list, so one grey run joined by commas:
                    a dot baked into the string is a separator only CSS may
                    draw (§AM F3). */}
                <div className="bp-sub">{o.fact.orgs.join(", ")}</div>
              </div>
              {/* The offer is the row's capsule (§AL). Its red label means
                  "tap" (§AM), not a warning; the fact itself stays uncoloured. */}
              <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); onProtectGap(o); }}>Protect a Gap</button>
            </div>
          ))}
        </div></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
