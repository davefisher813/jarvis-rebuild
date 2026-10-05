import type { ThirdPracticeOffer } from "../thirdPractice";
import { pressable } from "../../shared/pressable";
import { weekdayShortDate } from "../../shared/dateFormat";
import RowShell from "../../brain/RowShell";

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
        <div className="pad-x"><div className="card list-card-ruled shell-rows">
          {offers.map((o, i) => (
            // CLEAN ROWS (Dave 2026-10-05, locked): the offer IS the row. Its tap takes the offer, Protect a Gap (as it
            // always did) and so does its swipe-left; the capsule that repeated it is gone.
            <RowShell key={i} verb={{ label: "Protect a Gap", run: () => onProtectGap(o) }}>
              <div className="row" {...pressable(() => onProtectGap(o))}>
                <div className="row-grow">
                  <div className="conn-name">{weekdayShortDate(o.fact.date)}</div>
                  {/* The teams are one list, so one grey run joined by commas:
                      a dot baked into the string is a separator only CSS may
                      draw (§AM F3). */}
                  <div className="bp-sub">{o.fact.orgs.join(", ")}</div>
                </div>
                <div className="chev" />
              </div>
            </RowShell>
          ))}
        </div></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
