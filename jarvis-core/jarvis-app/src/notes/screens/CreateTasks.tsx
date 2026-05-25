// Matches locked frame #51 "Create Tasks". Stays green by design: the tasks
import { catColor } from "../../shared/categories";
// inherit the note's Health category, so the checkboxes are cat-bd-green. The
// urgency labels add intent color (warn / muted). No icons on this screen.

interface CreateTaskItem {
  text: string;
  due: string;
  urgency: "warn" | "muted";
}

export default function CreateTasks({
  category = "health",
  categoryLabel = "Health",
  source = "This Week",
  items = [
    { text: "Tuesday tempo, 6 mi", due: "TODAY", urgency: "warn" },
    { text: "Thursday intervals, 8x800", due: "THU", urgency: "muted" },
    { text: "Sunday long run, 18 mi", due: "SUN", urgency: "muted" },
  ],
  onCreate,
  onBack,
}: {
  category?: string;
  categoryLabel?: string;
  source?: string;
  items?: CreateTaskItem[];
  onCreate?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Connections</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Create Tasks</div>

      <div className="detail-head">
        <div className="t-meta">
          These checklist items become {categoryLabel} Tasks. Completed items are skipped.
        </div>
      </div>

      <div className="grp">
        <div className="eyebrow">{"From \u201c" + source + "\u201d"}</div>
      </div>
      <div className="pad-x">
        <div className="card">
          {items.map((it, i) => (
            <div className="task-row" key={i}>
              <div className={"task-check cat-bd-" + catColor(category)}></div>
              <div className="task-title">{it.text}</div>
              <span className={"urgency urgency-" + it.urgency}>{it.due}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grp"></div>
      <div className="pad-x">
        <button className="btn btn-primary btn-block" onClick={onCreate}>
          Create {items.length} Tasks
        </button>
      </div>
      <div className="grp"></div>
      <div className="pad-x">
        <button className="btn btn-tertiary btn-block" onClick={onBack}>Cancel</button>
      </div>
    </div>
  );
}
