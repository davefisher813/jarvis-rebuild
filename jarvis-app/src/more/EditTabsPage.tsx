import { DESTINATIONS, MAX_TABS } from "../shell/destinations";
import LargeTitleNav from "../shared/LargeTitleNav";
import TabOrderList from "./TabOrderList";
import { Head, Card, Switch } from "../settings/kit";

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
    <div className="screen ruled">
      <LargeTitleNav title="Edit Tabs" back="Settings" onBack={onBack} />
      {onReorder && tabKeys.length > 1 && (
        <>
          <Head label="Tab Order" />
          <div className="pad-x"><TabOrderList keys={tabKeys} onReorder={onReorder} /></div>
        </>
      )}
      <Head label="In the Tab Bar" count={tabKeys.length} />
      <Card>
        {DESTINATIONS.map(({ key, label }) => {
          const on = tabKeys.includes(key);
          const locked = (on && tabKeys.length === 1) || (!on && atMax);
          return <Switch key={key} label={label} on={on} locked={locked} onToggle={() => onToggle(key)} />;
        })}
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
