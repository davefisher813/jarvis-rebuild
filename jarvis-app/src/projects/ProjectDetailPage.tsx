import { PROJECT_META, type Project } from "./types";
import { catColor, catName } from "../shared/categories";

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

export default function ProjectDetailPage({ project, onBack, onEdit }: { project: Project; onBack: () => void; onEdit: () => void }) {
  const m = PROJECT_META[project.data.status];
  const hasCat = !!project.data.category;
  const tag = hasCat ? catName(project.data.category!) : "";
  return (
    <div className="screen">
      <div className="nav-bar"><button className="nav-back" aria-label="Back" onClick={onBack}></button><div className="nav-title">Project</div><button className="nav-action-text" onClick={onEdit}>Edit</button></div>
      <div className="pad-x"><div className="card proj-detail-hero">
        <div className={"proj-icon cat-bg-" + (hasCat ? catColor(project.data.category!) : "graphite")}>{initialOf(tag || project.data.title)}</div>
        <div className="proj-detail-title">{project.data.title}</div>
        <span className={"lm-qual lm-" + m.cls}>{m.label}</span>
      </div></div>
      <div className="grp"><div className="eyebrow">Details</div></div>
      <div className="pad-x"><div className="card">
        <div className="row"><div className="row-grow"><div className="conn-name">Status</div></div><span className={"lm-qual lm-" + m.cls}>{m.label}</span></div>
        <div className="row"><div className="row-grow"><div className="conn-name">Area</div></div>
          {hasCat ? <span className="proj-detail-cat"><span className={"cat-dot cat-bg-" + catColor(project.data.category!)} />{tag}</span> : <span className="row-value">None</span>}</div>
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
