import { DESTINATIONS, MAX_TABS } from "../shell/destinations";
import LargeTitleNav from "../shared/LargeTitleNav";
import TabOrderList from "./TabOrderList";
import { Head, Card, Switch, Foot } from "../settings/kit";
import { showToast } from "../shared/toast";
import { lineCase } from "../shared/casing";

// The tab bar has a cap (MAX_TABS) and a floor of one. A switch that hits
// either used to lock with no word (audit 2026-09-29: "Notes, Notifications,
// Money and Chat cannot be turned on"): the cap was working, nothing said so.
export const TAB_CAP_MESSAGE = `The tab bar holds ${MAX_TABS}, so turn another off first`;
export const TAB_FLOOR_MESSAGE = "The tab bar needs at least one tab";

export default function EditTabsPage({
  tabKeys,
  onToggle,
  onReorder,
  onBack,
}: {
  tabKeys: string[];
  onToggle: (key: string) => void;
  onReorder?: (next: string[]) => void | Promise<boolean | void>;
  onBack: () => void;
}) {
  const atMax = tabKeys.length >= MAX_TABS;
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Edit Tabs" back="Settings" onBack={onBack} />
      {onReorder && tabKeys.length > 1 && (
        <>
          <Head label="Tab Order" />
          <div className="pad-x"><TabOrderList keys={tabKeys} onReorder={onReorder} /></div>
        </>
      )}
      <Head label="In the Tab Bar" count={lineCase(`${tabKeys.length} of ${MAX_TABS} tabs`)} />
      <Card>
        {DESTINATIONS.map(({ key, label, Icon }) => {
          const on = tabKeys.includes(key);
          const locked = (on && tabKeys.length === 1) || (!on && atMax);
          // The same tile the Tab Order rows above wear, so a tab is the same mark in both lists (2026-10-05).
          return <Switch key={key} label={label} on={on} locked={locked} onToggle={() => onToggle(key)}
            lead={<div className="sec-ico ico-surface" aria-hidden="true"><Icon className="ic" /></div>}
            onLocked={() => showToast({ message: on ? TAB_FLOOR_MESSAGE : TAB_CAP_MESSAGE })} />;
        })}
      </Card>
      {atMax && <Foot>{TAB_CAP_MESSAGE}</Foot>}
      <div className="screen-foot" />
    </div>
  );
}
