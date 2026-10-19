import { createRoot } from "react-dom/client";
import YourDay from "../today/YourDay";
import { RowChipWordsContext } from "../schedule/screens/rowChip";
import { setCategoryRegistry } from "../shared/categories";
import type { EventItem } from "../schedule/types";
import "../styles/jarvis-design-system.css";
import "../styles/uniformity.css";
import "../styles/components.css";
import "../styles/ruled.css";

// The Whole Day bench (dev only; run by laws/wholeDayRender.test.ts in a real browser). It renders the REAL Today day card (YourDay, the TV guide
// and every row kind it holds) through the real stylesheets, with a day that carries an area on every kind of row, because layout is the one thing
// jsdom cannot see: the area chip joined a grid on 2026-10-18 and squeezed every held task's title into a one-letter strip (Dave 2026-10-19,
// "The schedule is broke"), and no test saw it because no test had a layout engine. Same shape as bench-health.html and bench-email.html.

setCategoryRegistry([
  { id: "c-work", name: "Work", color: "blue" },
  { id: "c-health", name: "Health", color: "green" },
]);

const TODAY = new Date().toISOString().slice(0, 10);
const ev = (id: string, title: string, start: string, end: string, category: string): EventItem => ({ id, data: { title, date: TODAY, start, end, category } });
const task = (taskId: string, text: string, start: string, end: string, category: string) => ({ taskId, text, category, start, end });

const events = [ev("e1", "Gym", "07:00", "08:00", "c-health"), ev("e2", "Standup With The Whole Studio Team", "13:00", "13:30", "c-work")];
const locked = [{ s: 9 * 60, e: 12 * 60, label: "Deep Work", kind: "focus", mode: "holds", id: "blk-deep" }];
// Three held inside Deep Work (a long title and a project beside the chip, a title with no area) and one loose proposed row after it.
const blocks = [
  task("t1", "Create Gameplay Loop Prototype For The Launch Build", "09:00", "09:45", "c-work"),
  task("t2", "Review Pull Request", "10:00", "10:30", "c-work"),
  task("t3", "Stretch", "11:00", "11:15", ""),
  task("t4", "Write Up The Weekly Notes", "14:00", "14:30", "c-work"),
];
const noop = () => {};
const words = { event: () => null, task: (id: string) => (id === "t1" ? "Gamepad Studio Launch Plan" : null) };

createRoot(document.getElementById("root")!).render(
  <div className="screen ruled">
    <RowChipWordsContext.Provider value={words}>
      <YourDay
        events={events}
        locked={locked}
        now="08:30"
        nowLabel="8:30"
        onSeeAll={noop}
        proposed={{ blocks, openId: null, onToggle: noop, onDuration: noop, onDrop: noop, onOpen: noop }}
      />
    </RowChipWordsContext.Provider>
  </div>,
);
