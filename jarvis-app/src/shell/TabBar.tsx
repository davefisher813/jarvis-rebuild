import { MoreHorizontal } from "../shared/icons";
import { destOf, tabLabelOf } from "./destinations";

// Dynamic tab bar: the chosen destinations plus a fixed More tab. Active is the
// current page key; when the active page is not one of the tabs (it was opened
// from More), More is highlighted.
//
// NO BADGES, BY LAW (L1, widened app-wide 2026-08-25). The Tasks tab used to
// wear a red pill counting overdue + due-today. That is the single
// most-studied anxiety mechanic there is: it exploits the need for closure,
// it only ever counts up, and it turns "you have tasks" into "you are
// behind" from a surface you cannot act on.
//
// The count is not lost. Tasks has an Overdue filter carrying its own count
// and its own "Nothing overdue" empty state, one tap away, on the screen
// where something can actually be done about it. A number belongs where the
// action is.
//
// The `badges` prop is GONE rather than merely unused, because a dead
// mechanism is a resurrected one. Putting a count back means putting the
// plumbing back, which is a decision somebody has to make on purpose.
export default function TabBar({
  tabKeys,
  active,
  onTab,
}: {
  tabKeys: string[];
  active: string;
  onTab: (key: string) => void;
}) {
  const items = [
    ...tabKeys.map((k) => destOf(k)).filter((d): d is NonNullable<typeof d> => !!d),
    { key: "more", label: "More", Icon: MoreHorizontal },
  ];
  const activeKey = tabKeys.includes(active) ? active : "more";

  return (
    <div className="tab-bar">
      {items.map((d) => {
        const { key, Icon } = d;
        return (
        <div
          className={"tab" + (key === activeKey ? " active" : "")}
          key={key}
          role="button"
          tabIndex={0}
          onClick={() => onTab(key)}
        >
          <Icon className="ic" />
          {/* The short word, where there is one. See destinations.tsx. */}
          {tabLabelOf(d)}
        </div>
        );
      })}
    </div>
  );
}
