import { useState } from "react";
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
  // REORDER IS A MODE, NOT A PERMANENT GRIP (Dave 2026-10-05, locked: "no grip dots or always-visible hints"; the round 2 review: a grip on
  // every row, always). The head's capsule turns the grips on and, as Done, off again; the list is a plain list the rest of the time.
  const [reordering, setReordering] = useState(false);
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Edit Tabs" back="Settings" onBack={onBack} />
      {onReorder && tabKeys.length > 1 && (
        <>
          <Head label="Tab Order" action={{ label: reordering ? "Done" : "Reorder", onClick: () => setReordering(!reordering) }} />
          <div className="pad-x"><TabOrderList keys={tabKeys} onReorder={onReorder} handles={reordering} /></div>
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
