import { BAG_ITEMS, allChecked } from "../bag";
import type { BagItemState } from "../types";

// THE BAG, WATER WITH YOU IS A ROW INSIDE IT (Part 3). A pre-departure
// checklist bound to one calendar event. One tap per item or one tap for
// all. Water With You is object-level: is the bottle in the bag, never a
// volume or an ounces target.
export default function TheBagScreen({
  eventTitle, items, onToggle, onCheckAll, onBack,
}: {
  eventTitle: string;
  items: BagItemState[];
  onToggle: (key: string) => void;
  onCheckAll: () => void;
  onBack: () => void;
}) {
  const done = allChecked(items);
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Bag</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q truncate">{eventTitle}</div>
        <div className="bp-sub">One tap per item, or one tap for all.</div>
      </div></div>

      <div className="pad-x"><div className="card list-card-ruled">
        {BAG_ITEMS.map((def) => {
          const state = items.find((i) => i.key === def.key);
          const checked = state?.checked ?? false;
          return (
            <div className="row" role="button" tabIndex={0} key={def.key} onClick={() => onToggle(def.key)}>
              <div className={"cb" + (checked ? " on" : "")} aria-hidden="true" />
              <div className="row-grow"><div className="conn-name">{def.label}</div></div>
            </div>
          );
        })}
      </div></div>

      <div className="pad-x">
        <button className="btn btn-primary btn-block" disabled={done} onClick={onCheckAll}>Check Everything</button>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
