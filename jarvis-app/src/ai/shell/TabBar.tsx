import { MoreHorizontal } from "lucide-react";
import { destOf } from "./destinations";

// Dynamic tab bar: the chosen destinations plus a fixed More tab. Active is the
// current page key; when the active page is not one of the tabs (it was opened
// from More), More is highlighted.
export default function TabBar({
  tabKeys,
  active,
  onTab,
  badges,
}: {
  tabKeys: string[];
  active: string;
  onTab: (key: string) => void;
  badges?: Record<string, number>;
}) {
  const items = [
    ...tabKeys.map((k) => destOf(k)).filter((d): d is NonNullable<typeof d> => !!d),
    { key: "more", label: "More", Icon: MoreHorizontal },
  ];
  const activeKey = tabKeys.includes(active) ? active : "more";

  return (
    <div className="tab-bar">
      {items.map(({ key, label, Icon }) => (
        <div
          className={"tab" + (key === activeKey ? " active" : "")}
          key={key}
          role="button"
          tabIndex={0}
          onClick={() => onTab(key)}
        >
          <Icon className="ic" />
          {label}
          {badges && badges[key] ? <span className="tab-badge">{badges[key]! > 99 ? "99+" : badges[key]}</span> : null}
        </div>
      ))}
    </div>
  );
}
