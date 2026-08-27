import type { NightBeforeOffer } from "../nightBefore";

const fmt = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// THE NIGHT BEFORE (Part 1, top 5). Reads tomorrow's first fixed commitment
// and offers a real bedtime the evening before. Never states a shortfall:
// this screen renders exactly one offer, never a number of hours lost.
export default function NightBeforeScreen({ offer, onAddWindDown, onBack }: {
  offer: NightBeforeOffer | null;
  onAddWindDown: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Night Before</div>
      </div>

      {offer ? (
        <>
          <div className="pad-x"><div className="card pad">
            <div className="p3-q">Wind Down At {fmt(offer.windDownAt)}</div>
            <div className="bp-sub">{offer.commitmentTitle} at {fmt(offer.commitmentAt)} tomorrow.</div>
          </div></div>
          <div className="pad-x"><button className="btn btn-primary btn-block" onClick={onAddWindDown}>Add Wind Down</button></div>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-title">Nothing Fixed Tomorrow Yet</div>
          <div className="empty-sub">Once tomorrow has a real start time, a wind-down offer shows up here</div>
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
