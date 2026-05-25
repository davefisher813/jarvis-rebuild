import { Tag, CalendarDays, ListChecks, ListTodo } from "lucide-react";
import { catColor } from "../../shared/categories";

// Matches locked frame #50 "Connections". Content, labels, and icons are
// unchanged from the lock; only the tile colors are varied (the lock had all
// four green, which hid the color system). Each tile now reflects a distinct
// category so the system reads.
export default function Connections({
  category = "health",
  categoryLabel = "Health",
  onBack,
  onCreateTasks,
}: {
  category?: string;
  categoryLabel?: string;
  onBack?: () => void;
  onCreateTasks?: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Note</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Connections</div>

      <div className="grp">
        <div className="eyebrow">Linked To</div>
      </div>
      <div className="pad-x">
        <div className="card">
          <div className="row">
            <div className={"proj-icon cat-bg-" + catColor(category)}><Tag className="ic" /></div>
            <div className="conn-name">Category</div>
            <span className="conn-meta">{categoryLabel}</span>
            <div className="chev"></div>
          </div>
          <div className="row">
            <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
            <div className="conn-name">Event</div>
            <span className="conn-meta">Long Run Sunday</span>
            <div className="chev"></div>
          </div>
          <div className="row">
            <div className="proj-icon cat-bg-red"><ListChecks className="ic" /></div>
            <div className="conn-name">Task</div>
            <span className="conn-meta">Add</span>
            <div className="chev"></div>
          </div>
        </div>
      </div>

      <div className="grp">
        <div className="eyebrow">Actions</div>
      </div>
      <div className="pad-x">
        <div className="card">
          <div className="row" onClick={onCreateTasks}>
            <div className="proj-icon cat-bg-yellow"><ListTodo className="ic" /></div>
            <div className="conn-name">Create Tasks from Checklist</div>
            <span className="conn-meta">3 items</span>
            <div className="chev"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
