import type { Person, PersonGroup } from "../types";
import { GROUP_TITLE, personInitials, avatarClass } from "../types";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);
const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const PEOPLE = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
);

export default function PeopleListPage({
  group,
  people,
  onOpen,
  onAdd,
  onBack,
}: {
  group: PersonGroup;
  people: Person[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">{GROUP_TITLE[group]}</div>
      </div>

      {people.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{PEOPLE}</div>
          <div className="empty-title">No one here yet</div>
          <button className="btn btn-primary" onClick={onAdd}>Add Person</button>
        </div>
      ) : (
        <div className="pad-x"><div className="card">
          {people.map((p) => (
            <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => onOpen(p.id)}>
              <div className={"av av-40 " + avatarClass(p.data.color)}>{personInitials(p.data.name)}</div>
              <div className="row-grow"><div className="conn-name">{p.data.name}</div></div>
              {CHEV}
            </div>
          ))}
          <div className="row ob-addrow" role="button" tabIndex={0} onClick={onAdd}>
            <div className="sec-ico ico-accent">{PLUS}</div>
            <div className="row-grow"><div className="conn-name">Add Person</div></div>
          </div>
        </div></div>
      )}
    </div>
  );
}
