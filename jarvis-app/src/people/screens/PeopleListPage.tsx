import { useRef } from "react";
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
const UPLOAD = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
);
const PEOPLE = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
);

export default function PeopleListPage({
  group,
  people,
  onOpen,
  onAdd,
  onImportFile,
  onBack,
}: {
  group: PersonGroup;
  people: Person[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onImportFile?: (file: File) => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const importRow = onImportFile && (
    <div className="row ob-addrow" role="button" tabIndex={0} onClick={() => fileRef.current?.click()}>
      <div className="sec-ico ico-blue">{UPLOAD}</div>
      <div className="row-grow">
        <div className="conn-name">Import from File</div>
        <div className="conn-meta">Share contacts from your phone (.vcf) or a spreadsheet (.csv)</div>
      </div>
    </div>
  );

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}>{BACK}</button>
        <div className="nav-title">{GROUP_TITLE[group]}</div>
      </div>

      {onImportFile && (
        <input
          ref={fileRef}
          className="visually-hidden-input"
          type="file"
          accept=".vcf,.csv,text/vcard,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = ""; // allow picking the same file again
          }}
        />
      )}

      {people.length === 0 ? (
        <>
          <div className="empty-state empty-compact">
            <div className="empty-icon">{PEOPLE}</div>
            <div className="empty-title">No one here yet</div>
            <button className="btn btn-primary" onClick={onAdd}>Add Person</button>
          </div>
          {importRow && <div className="pad-x"><div className="card">{importRow}</div></div>}
        </>
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
          {importRow}
        </div></div>
      )}
    </div>
  );
}
