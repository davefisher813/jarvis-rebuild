import type { HandoffItem } from "../handoff";

// THE HANDOFF (Part 7, rank #2 overall). The parent's product: rides,
// times, forms, fees, medication refill logistics, gear, the physical's
// expiry. NO BODY DATA AT ALL -- this screen only ever renders lines that
// handoff.ts already filtered down to logistics.
//
// Real cross-account routing (a genuine parent identity) is not built yet
// (see the module's own auth note); this screen renders under the
// athlete's own ownerId, as What They See already does for the Share Line.
export default function HandoffScreen({ items, onOpenSeasonFeed, onOpenLocker, onBack }: {
  items: HandoffItem[];
  onOpenSeasonFeed: () => void;
  onOpenLocker: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Handoff</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Logistics Only</div>
        <div className="bp-sub">Rides, forms, fees, refills. No body data crosses here, ever.</div>
      </div></div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">Nothing Needs You Right Now</div>
          <div className="empty-sub">A ride, a fee, a form, or a refill shows up here the moment it does</div>
        </div>
      ) : (
        <div className="pad-x"><div className="card list-card-ruled">
          {items.map((item, i) => (
            <div className="row" key={i}><div className="row-grow"><div className="conn-name">{item.line}</div></div></div>
          ))}
        </div></div>
      )}

      <div className="pad-x sheet-actions">
        <button className="btn btn-secondary btn-block" onClick={onOpenLocker}>Open The Locker</button>
        <button className="btn btn-secondary btn-block" onClick={onOpenSeasonFeed}>Add A Team Schedule</button>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
