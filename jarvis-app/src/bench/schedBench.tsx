import { createRoot } from "react-dom/client";
import SchedulePage from "../schedule/screens/SchedulePage";
import { setCategoryRegistry } from "../shared/categories";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import type { WeekRow } from "../schedule/weekRows";
import "../styles/jarvis-design-system.css";
import "../styles/uniformity.css";
import "../styles/components.css";
import "../styles/ruled.css";

setCategoryRegistry([
  { id: "orgB", name: "Ridgeley", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "health", name: "Health", color: "green" },
  { id: "money", name: "Money", color: "yellow" },
]);
const q = new URLSearchParams(location.search);
const mode = (q.get("mode") ?? "month") as "day" | "week" | "month";
document.documentElement.dataset.theme = q.get("theme") ?? "dark";
const ev = (id: string, title: string, start: string, end: string, category = "orgB"): EventItem => ({ id, data: { title, date: "2026-10-05", start, end, category } });
const tk = (i: number, text: string): TaskItem => ({ id: "t" + i, data: { text, done: false, category: "elite" } }) as unknown as TaskItem;
const week: WeekRow[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
  date: "2026-10-0" + (5 + i > 9 ? 9 : 5 + i), day: 5 + i, dow: i, windowS: 420, windowE: 1320,
  blocks: [{ s: 540, e: 600, category: "orgB", title: "A" }, { s: 720, e: 780, category: "elite", title: "B" }],
  count: 4, openMin: i === 6 ? 53 : 300 + i * 20, longest: { s: 840, e: 960 },
}));
week.forEach((w, i) => { w.date = "2026-10-" + String(5 + i).padStart(2, "0"); });
createRoot(document.getElementById("root")!).render(
  <div className="app-shell"><div className="app-scroll">
    <SchedulePage
      year={2026} month={9} selected={q.get("sel") ?? "2026-10-04"} todayDate="2026-10-05" mode={mode}
      dots={{ 4: ["orgB"], 5: ["orgB", "elite"], 12: ["health"], 20: ["money", "elite", "orgB"] }}
      dayEvents={[ev("a", "interview with reynolds", "09:00", "10:00"), ev("b", "send all proposals", "13:00", "14:00", "elite")]}
      weekCells={week.map((w) => ({ date: w.date, day: w.day, colors: [] }))} weekRows={week}
      now="11:20" onPickSlot={() => {}} onCopyDay={() => {}} onPlanDay={() => {}} onNew={() => {}} onMode={() => {}} onSelect={() => {}}
      anytimeItems={[tk(1, "get new car insurance"), tk(2, "check on health insurance receipts"), tk(3, "get EIN number")]}
      onToggleTask={() => {}} onScheduleTask={() => {}} onOpenTask={() => {}}
      locked={[]} windowStartMin={420} windowEndMin={1320}
    />
  </div></div>,
);
