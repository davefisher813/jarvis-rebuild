import { DESTINATIONS, MAX_TABS } from "../shell/destinations";
import LargeTitleNav from "../shared/LargeTitleNav";
import TabOrderList from "./TabOrderList";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);

// Pick which pages are bottom tabs. Up to MAX_TABS, at least one. Order follows
// DESTINATIONS; the rest fall into More. (Drag-to-reorder is a later add.)
export default function EditTabsPage({
  tabKeys,
  onToggle,
  onReorder,
  onBack,
}: {
  tabKeys: string[];
  onToggle: (key: string) => void;
  onReorder?: (next: string[]) => void;
  onBack: () => void;
}) {
  const atMax = tabKeys.length >= MAX_TABS;

  return (
    <div className="screen">
      <LargeTitleNav title="Edit Tabs" back="Settings" onBack={onBack} />
      {onReorder && tabKeys.length > 1 && (
        <>
          <div className="grp"><div className="eyebrow">Tab order</div></div>
          <div className="pad-x"><TabOrderList keys={tabKeys} onReorder={onReorder} /></div>
        </>
      )}
      <div className="grp"><div className="eyebrow">In the tab bar</div></div>
      <div className="pad-x"><div className="card">
        {DESTINATIONS.map(({ key, label, Icon }) => {
          const on = tabKeys.includes(key);
          const locked = (on && tabKeys.length === 1) || (!on && atMax);
          return (
            <div className="row" key={key}>
              <div className="sec-ico ico-surface"><Icon className="ic" /></div>
              <div className="row-grow"><div className="conn-name">{label}</div></div>
              <button
                className={"switch" + (on ? "" : " off") + (locked ? " switch-locked" : "")}
                role="switch"
                aria-checked={on}
                aria-label={label}
                onClick={() => { if (!locked) onToggle(key); }}
              />
            </div>
          );
        })}
      </div></div>
    </div>
  );
}
