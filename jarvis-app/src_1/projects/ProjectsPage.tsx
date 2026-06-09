import type { Project } from "./types";
import SkeletonRows from "../shared/SkeletonRows";
import { PROJECT_META } from "./types";
import { catColor, catName } from "../shared/categories";

const CHEV = <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const BAG = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>;

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

export default function ProjectsPage({ projects, onAdd, onOpen, loading }: {
  projects: Project[]; loading?: boolean; onAdd: () => void; onOpen: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="screen">
        <div className="nav-bar"><div className="nav-large">Projects</div></div>
        <SkeletonRows />
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="screen">
        <div className="nav-bar"><div className="nav-large">Projects</div></div>
        <div className="empty-state"><div className="empty-icon">{BAG}</div><div className="empty-title">No projects yet</div>
          <button className="btn btn-primary" onClick={onAdd}>Add a Project</button></div>
      </div>
    );
  }
  return (
    <div className="screen">
      <div className="nav-bar"><div className="nav-large">Projects</div></div>
      <div className="pad-x"><div className="card">
        {projects.map((p) => {
          const m = PROJECT_META[p.data.status];
          const tag = p.data.category ? catName(p.data.category) : "";
          return (
            <div className="proj-row" role="button" tabIndex={0} key={p.id} onClick={() => onOpen(p.id)}>
              <div className={"proj-icon cat-bg-" + catColor(p.data.category ?? "")}>{initialOf(tag || p.data.title)}</div>
              <div className="proj-meta">{tag && <div className="proj-tag">{tag}</div>}<div className="proj-title">{p.data.title}</div></div>
              <span className={"lm-qual lm-" + m.cls}>{m.label}</span>
              {CHEV}
            </div>
          );
        })}
        <div className="proj-row ob-addrow" role="button" tabIndex={0} onClick={onAdd}>
          <div className="sec-ico ico-accent">{PLUS}</div>
          <div className="row-grow"><div className="conn-name">Add Project</div></div>
        </div>
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
