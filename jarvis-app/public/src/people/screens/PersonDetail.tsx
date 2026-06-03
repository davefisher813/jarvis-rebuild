import type { Person } from "../types";
import { personInitials, avatarClass } from "../types";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);
const EDIT = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" /></svg>
);

function KV({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="row">
      <div className="row-grow"><div className="conn-name">{label}</div></div>
      <span className="kv-val">{value}</span>
    </div>
  );
}

export default function PersonDetail({
  person,
  onEdit,
  onBack,
}: {
  person: Person;
  onEdit: () => void;
  onBack: () => void;
}) {
  const { name, relationship, birthday, notes, color } = person.data;
  const hasAttrs = relationship || birthday;
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <button className="nav-action" aria-label="Edit" onClick={onEdit}>{EDIT}</button>
      </div>
      <div className="person-hero">
        <div className={"av av-72 " + avatarClass(color)}>{personInitials(name)}</div>
        <div className="person-name">{name}</div>
      </div>
      {hasAttrs && (
        <div className="pad-x"><div className="card">
          <KV label="Relationship" value={relationship} />
          <KV label="Birthday" value={birthday} />
        </div></div>
      )}
      {notes && (
        <>
          <div className="grp"><div className="eyebrow">Notes</div></div>
          <div className="pad-x"><div className="card"><div className="note-body">{notes}</div></div></div>
        </>
      )}
    </div>
  );
}
