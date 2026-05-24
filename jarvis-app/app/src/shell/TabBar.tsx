import { Home, ListChecks, Calendar, Brain, MoreHorizontal } from "lucide-react";

// Personal template tab bar: Today, Tasks, Schedule, Brain, More.
// Presentational for now; the real nav shell wires routing later.
const TABS = [
  { key: "today", label: "Today", Icon: Home },
  { key: "tasks", label: "Tasks", Icon: ListChecks },
  { key: "schedule", label: "Schedule", Icon: Calendar },
  { key: "brain", label: "Brain", Icon: Brain },
  { key: "more", label: "More", Icon: MoreHorizontal },
] as const;

export default function TabBar({ active = "more" }: { active?: string }) {
  return (
    <div className="tab-bar">
      {TABS.map(({ key, label, Icon }) => (
        <div className={"tab" + (key === active ? " active" : "")} key={key}>
          <Icon className="ic" />
          {label}
        </div>
      ))}
    </div>
  );
}
