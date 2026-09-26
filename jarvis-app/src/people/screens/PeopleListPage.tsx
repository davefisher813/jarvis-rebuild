import { useRef, useState } from "react";
import EntityStar from "../../shared/EntityStar";
import type { Person } from "../types";
import { personInitials, avatarClass } from "../types";
import { searchPeople } from "../views";
import { PeopleGlyph } from "../../shared/glyphs";
import { pressable } from "../../shared/pressable";
import { capAfterNumber } from "../../shared/casing";

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
  repairs = [],
  onRepair,
  onSkipRepair,
  duplicateNotes = 0,
  onClearDuplicateNotes,
  onBack,
}: {
  people: Person[];
  pendingReview?: Person[]; // legacy Adversarial members awaiting consent
  onConfirmFlag?: (id: string) => void;
  onClearFlag?: (id: string) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onImportFile?: (file: File) => void;
  // A NUMBER THAT ENDED UP IN THE NOTES (People handoff, 2026-09-16). The
  // import that put it there is fixed; these are the contacts already in the
  // app carrying one. Reviewable, one at a time, because a run of digits in a
  // note can be an order number or a door code and only the person who wrote
  // it knows which.
  repairs?: { id: string; name: string; findings: { kind: "phone" | "email"; value: string; context: string }[] }[];
  onRepair?: (personId: string, finding: { kind: "phone" | "email"; value: string; context: string }) => void;
  onSkipRepair?: (personId: string, value: string) => void;
  /** How many contacts have their own number written in their notes as well,
   *  which the old import did on its own line and nothing could undo. */
  duplicateNotes?: number;
  onClearDuplicateNotes?: () => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const pendingIds = new Set(pendingReview.map((p) => p.id));
  const shown = searchPeople(people, q).filter((p) => !pendingIds.has(p.id));

  const importRow = onImportFile && (
    <div {...pressable(() => fileRef.current?.click())} className="task-row p2 person-row-ruled">
      <div className="task-check-tap gm-slot"><span className="row-glyph cat-fg-blue">{UPLOAD}</span></div>
      <div className="task-title">
        <span className="task-name">Import from File</span>
        {/* MEASURED, NOT GUESSED (2026-09-20, 390x844): the old line asked
            329px of the 292 this row leaves under its title and shipped
            "...with a Name col", which cut the one word that says what the
            csv must contain. "From your phone" was where to find a .vcf;
            the Name column is the thing that makes an import work, so the
            decoration goes and the requirement stays. 220 of 292 now. */}
        <div className="r-k"><span className="r-goal r-cat">.vcf or .csv with a Name column</span></div>
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
            // Row tap (Dave 2026-09-15, "I want all rows clickable"): the row
            // opens the person; Yes and No keep their own taps.
            <div {...pressable(() => onOpen(p.id))} className="offer-row" key={p.id}>
              <div className="av av-32 cat-bg-graphite">{personInitials(p.data.name)}</div>
              <div className="row-grow"><div className="conn-name truncate">{p.data.name}</div></div>
              <button className="btn-sm" onClick={(ev) => { ev.stopPropagation(); onConfirmFlag?.(p.id); }}>Yes</button>
              <button className="quiet-action" onClick={(ev) => { ev.stopPropagation(); onClearFlag?.(p.id); }}>No, move out</button>
            </div>
          ))}
        </div></div>
      )}

      {/* THE SAME NUMBER, WRITTEN TWICE. Not a review, because there is
          nothing to judge: the line repeats a field the contact already has,
          word for word. One tap, one Undo. */}
      {duplicateNotes > 0 && onClearDuplicateNotes && (
        <div className="pad-x"><div className="card list-card-ruled">
          {/* row-tap: clearing edits everyone's notes at once, so it waits for
              the button rather than answering a stray tap on the words. There
              is nothing else here to open. */}
          <div className="row">
            <div className="row-grow">
              <div className="conn-name">
                {capAfterNumber(duplicateNotes === 1
                  ? "One contact has their own number in their notes as well"
                  : `${duplicateNotes} contacts have their own number in their notes as well`)}
              </div>
              <div className="bp-sub">Left there by an old import</div>
            </div>
            <button className="pill-act" onClick={onClearDuplicateNotes}>Clear Them</button>
          </div>
        </div></div>
      )}

      {repairs.length > 0 && (onRepair || onSkipRepair) && (
        <div className="pad-x"><div className="card list-card-ruled pad">
          {/* Says the count as a fact, not as a chore with a badge on it. */}
          <div className="conn-name">
            {capAfterNumber(repairs.length === 1
              ? "One contact has contact details sitting in their notes"
              : `${repairs.length} contacts have contact details sitting in their notes`)}
          </div>
          {repairs.map((c) => c.findings.map((f) => (
            // Row tap: the row opens the contact, so "is this really their
            // number?" can be checked against the rest of their card before
            // answering. The two verbs keep their own taps.
            <div {...pressable(() => onOpen(c.id))} className="offer-row" key={c.id + f.value}>
              <div className="av av-32 cat-bg-graphite">{personInitials(c.name)}</div>
              <div className="row-grow">
                <div className="conn-name truncate">{c.name}</div>
                {/* The value, then the line it was found on, so the answer to
                    "is this a phone number?" is on screen rather than assumed.
                    The value steps up to white (.facts b, a number with no
                    state) so the line under it is the row's one grey (§AK).
                    Its own line, so it is never the part an ellipsis cuts
                    beside the row's two buttons. */}
                <div className="facts"><span className="fact"><b>{f.value}</b></span></div>
                <div className="bp-sub truncate">{f.context}</div>
              </div>
              <button className="btn-sm" onClick={(ev) => { ev.stopPropagation(); onRepair?.(c.id, f); }}>
                {f.kind === "phone" ? "It's a number" : "It's an address"}
              </button>
              <button className="quiet-action" onClick={(ev) => { ev.stopPropagation(); onSkipRepair?.(c.id, f.value); }}>Not One</button>
            </div>
          )))}
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
            <div {...pressable(() => onOpen(p.id))} className="task-row p2 person-row-ruled" key={p.id}>
              {/* C-50 (Astra, 2026-09-12): the Remember star leads the row. */}
              <EntityStar entityType="person" entityId={p.id} title={p.data.name} />
              <div className="task-check-tap"><div className={"av " + avatarClass(p.data.color)}>{personInitials(p.data.name)}</div></div>
              <div className="task-title">
                <span className="task-name">{p.data.name}</span>
                {/* the label, or the honest absence of one; a fact, not a nag */}
                {/* C-59 (Astra, 2026-09-12): no label is an empty second
                    line, not a nag. */}
                <div className="r-k">{p.data.relationship && <span className="r-goal r-cat">{p.data.relationship}</span>}</div>
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
