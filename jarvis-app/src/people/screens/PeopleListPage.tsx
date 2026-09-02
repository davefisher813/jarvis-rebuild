import { useRef, useState } from "react";
import type { Person } from "../types";
import { personInitials, avatarClass } from "../types";
import { searchPeople } from "../views";
import { PeopleGlyph } from "../../shared/glyphs";

const CHEV = (
  <div className="chev" />
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const UPLOAD = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
);
const SEARCH = (
  <svg className="ic search-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);
const PEOPLE = (
  <PeopleGlyph />
);

export default function PeopleListPage({
  people,
  pendingReview = [],
  onConfirmFlag,
  onClearFlag,
  onOpen,
  onAdd,
  onImportFile,
  onBack,
}: {
  people: Person[];
  pendingReview?: Person[]; // legacy Adversarial members awaiting consent
  onConfirmFlag?: (id: string) => void;
  onClearFlag?: (id: string) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onImportFile?: (file: File) => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const pendingIds = new Set(pendingReview.map((p) => p.id));
  const shown = searchPeople(people, q).filter((p) => !pendingIds.has(p.id));

  const importRow = onImportFile && (
    <div className="task-row p2 person-row-ruled" role="button" tabIndex={0} onClick={() => fileRef.current?.click()}>
      <div className="task-check-tap gm-slot"><span className="row-glyph cat-fg-blue">{UPLOAD}</span></div>
      <div className="task-title">
        <span className="task-name">Import from File</span>
        <div className="r-k"><span className="r-goal r-cat">.vcf from your phone · .csv with a Name column</span></div>
      </div>
    </div>
  );

  return (
    <div className="screen ruled people-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Contacts</div>
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

      {people.length > 3 && (
        <div className="pad-x list-search">
          <div className="search-bar">
            {SEARCH}
            <input placeholder="Search People" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}

      {/* Consent-first migration: the flag changes how JARVIS writes to a real
          person, so legacy Adversarial members are confirmed, never converted. */}
      {pendingReview.length > 0 && (
        <div className="pad-x"><div className="card list-card-ruled pad">
          <div className="conn-name">From your old list · Still handle with care?</div>
          {pendingReview.map((p) => (
            <div className="offer-row" key={p.id}>
              <div className="av av-32 cat-bg-graphite">{personInitials(p.data.name)}</div>
              <div className="row-grow"><div className="conn-name truncate">{p.data.name}</div></div>
              <button className="btn-sm" onClick={() => onConfirmFlag?.(p.id)}>Yes</button>
              <button className="quiet-action" onClick={() => onClearFlag?.(p.id)}>No, move out</button>
            </div>
          ))}
        </div></div>
      )}

      {people.length === 0 ? (
        <>
          <div className="empty-state empty-compact">
            <div className="empty-icon">{PEOPLE}</div>
            <div className="empty-title">No One Here Yet</div>
            <button className="btn btn-primary" onClick={onAdd}>Add Person</button>
          </div>
          {importRow && <div className="pad-x"><div className="card list-card-ruled">{importRow}</div></div>}
        </>
      ) : (
        <>
        {/* THE PERSON ROW (the area page's, 2026-09-02): the avatar in the
            check column, the name, the label under it in the quiet grey.
            Each row's avatar IS its type, so rows never double up with a
            glyph. */}
        <div className="sh2 sh2-quiet"><span className="t">Your People</span><span className="n">{shown.length}</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          {shown.map((p) => (
            <div className="task-row p2 person-row-ruled" role="button" tabIndex={0} key={p.id} onClick={() => onOpen(p.id)}>
              <div className="task-check-tap"><div className={"av " + avatarClass(p.data.color)}>{personInitials(p.data.name)}</div></div>
              <div className="task-title">
                <span className="task-name">{p.data.name}</span>
                {/* the label, or the honest absence of one; a fact, not a nag */}
                <div className="r-k"><span className="r-goal r-cat">{p.data.relationship || "No label yet"}</span></div>
              </div>
              {CHEV}
            </div>
          ))}
          <button className="row row-act" onClick={onAdd}>Add Person</button>
          {importRow}
        </div></div>
        </>
      )}
    </div>
  );
}
