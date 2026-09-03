import type { RestDayOffer } from "../twoDaysOff";

// TWO DAYS OFF (Part 2). Offers to place a real rest day when the coming
// week has none. A real calendar block, never advice with nothing behind it.
export default function TwoDaysOffScreen({ offer, onPlaceRestDay, onBack }: {
  offer: RestDayOffer;
  onPlaceRestDay: (date: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Two Days Off</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">{offer.restDaysNow} Rest Day{offer.restDaysNow === 1 ? "" : "s"} This Week</div>
        <div className="bp-sub">NATA's own figure is two a week.</div>
      </div></div>

      {offer.needed && offer.suggestedDate && (
        <div className="pad-x"><div className="card pad">
          <div className="conn-name">{offer.suggestedDate} Is Still Open</div>
          <button className="btn btn-primary btn-block" onClick={() => onPlaceRestDay(offer.suggestedDate!)}>Place a Rest Block There</button>
        </div></div>
      )}

      {!offer.needed && (
        <div className="empty-state">
          <div className="empty-title">Already Two Days Off</div>
          <div className="empty-sub">Nothing to place this week</div>
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
