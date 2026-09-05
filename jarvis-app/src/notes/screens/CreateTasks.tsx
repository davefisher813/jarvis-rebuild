// Matches locked frame #51 "Create Tasks". Stays green by design: the tasks
import { useState } from "react";
import { catColor } from "../../shared/categories";
import { Head, Card } from "../../settings/kit";
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
  // HMN-F-14 (2026-09-05): B12's latch, the one sheet that never got it.
  // tasksFromChecklist is idempotent only once the first run has written
  // its taskIds back, so two taps on "Create 3 Tasks" before that landed
  // made six tasks and six connections. The first tap latches, the label
  // says so, and with nothing to create the button is off.
  const [saving, setSaving] = useState(false);
  const create = () => {
    if (saving || items.length === 0) return;
    setSaving(true);
    onCreate?.();
  };
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Connections</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Create Tasks</div>

      <div className="detail-head">
        <div className="t-meta">
          Checklist items become {categoryLabel} Tasks · Completed ones skipped
        </div>
      </div>

      <Head label={"From \u201c" + source + "\u201d"} />
      <Card>
        {items.map((it, i) => (
          <div className="task-row" key={i}>
            <div className={"task-check cat-bd-" + catColor(category)}></div>
            <div className="task-title">{it.text}</div>
            <span className={"urgency urgency-" + it.urgency}>{it.due}</span>
          </div>
        ))}
      </Card>

      <div className="grp"></div>
      <div className="pad-x">
        <button className="btn btn-primary btn-block" onClick={create} disabled={saving || items.length === 0}>
          {saving ? "Creating" : "Create " + items.length + (items.length === 1 ? " Task" : " Tasks")}
        </button>
      </div>
      <div className="grp"></div>
      <div className="pad-x">
        <button className="btn btn-tertiary btn-block" onClick={onBack}>Cancel</button>
      </div>
    </div>
  );
}
