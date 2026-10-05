import { useRef, useState } from "react";
import EntityStar from "../../shared/EntityStar";
import type { Person } from "../types";
import { personInitials, softAvatarClass } from "../types";
import { searchPeople } from "../views";
import { PeopleGlyph, SweepGlyph } from "../../shared/glyphs";
import PageHeader from "../../shared/PageHeader";
import HeadMore from "../../shared/HeadMore";
import { pressable } from "../../shared/pressable";
import { lineCase } from "../../shared/casing";
import { BRAIN_ROLES } from "../../ai/brainMemory";
import { brainRoleLabel, brainRolesOf, isUnsorted } from "../../brain/manual/triage";

const CHEV = (
  <div className="chev" />
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
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
  onOpenTriage,
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
  /** Brain Manual v1 triage entry. Present only when Contacts opens from the
   *  Brain tab; the "Continue Sorting" row shows while unsorted remain. */
  onOpenTriage?: () => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const pendingIds = new Set(pendingReview.map((p) => p.id));
  // Only the triage roles anyone actually holds become chips: the filter
  // answers "who are my coaches", never "which roles exist in theory".
  const rolesPresent = BRAIN_ROLES.filter((r) => people.some((p) => brainRolesOf(p).includes(r)));
  const unsorted = people.filter(isUnsorted).length;
  const shown = searchPeople(people, q)
    .filter((p) => !pendingIds.has(p.id))
    .filter((p) => !roleFilter || brainRolesOf(p).includes(roleFilter));

  return (
    <div className="screen ruled people-ruled">
      {/* ONE TITLE STYLE ACROSS BRAIN (Dave 2026-10-05, the review: Contacts centred its title in the bar while Decisions and
          The Long Story set a large left one). */}
      <PageHeader title="Contacts" back="Brain" onBack={onBack} />

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

      {rolesPresent.length > 0 && (
        <div className="pad-x"><div className="chip-row chip-wrap-row">
          {rolesPresent.map((r) => (
            <button key={r} type="button" className={"chip" + (roleFilter === r ? " active" : "")}
              aria-pressed={roleFilter === r}
              onClick={() => setRoleFilter((f) => (f === r ? null : r))}>{brainRoleLabel(r)}</button>
          ))}
        </div></div>
      )}

      {/* Consent-first migration: the flag changes how JARVIS writes to a real
          person, so legacy Adversarial members are confirmed, never converted. */}
      {pendingReview.length > 0 && (
        <div className="pad-x"><div className="card list-card-ruled pad">
          <div className="conn-name">From Your Old List · Still Handle with Care?</div>
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
                {lineCase(duplicateNotes === 1
                  ? "One contact has their own number in their notes as well"
                  : `${duplicateNotes} contacts have their own number in their notes as well`)}
              </div>
              <div className="bp-sub">Left There by an Old Import</div>
            </div>
            <button className="pill-act" onClick={onClearDuplicateNotes}>Clear Them</button>
          </div>
        </div></div>
      )}

      {repairs.length > 0 && (onRepair || onSkipRepair) && (
        <div className="pad-x"><div className="card list-card-ruled pad">
          {/* Says the count as a fact, not as a chore with a badge on it. */}
          <div className="conn-name">
            {lineCase(repairs.length === 1
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

      {/* THE HEAD ALWAYS STANDS, WITH ITS ONE CAPSULE AND ITS OVERFLOW (Dave 2026-10-05, locked: a section's actions live in its
          head). Add Person is the capsule; Import from File used to be a row inside the people list, drawn like a person, and is
          behind the head's one round overflow button now (decision D1). */}
      <div className="sh2 sh2-quiet">
        <span className="t">Your People</span>{people.length > 0 && <span className="n">{shown.length}</span>}
        <button className="see-all pill-action" onClick={onAdd}>Add Person</button>
        {onImportFile && <HeadMore label="More" actions={[{ label: "Import from File", onPick: () => fileRef.current?.click() }]} />}
      </div>
      {people.length === 0 ? (
        <div className="empty-state empty-compact">
          <div className="empty-icon cat-fg-teal">{PEOPLE}</div>
          <div className="empty-title">No One Here Yet</div>
          <div className="empty-sub">Add Someone, or Bring In Your Contacts From a File</div>
          {/* An empty state always carries its action (law L7); the head's capsule is the same door. */}
          <button className="btn btn-primary" onClick={onAdd}>Add Your First Person</button>
        </div>
      ) : (
        <>
        {/* THE PERSON ROW (the area page's, 2026-09-02): the avatar in the
            check column, the name, the label under it in the quiet grey.
            Each row's avatar IS its type, so rows never double up with a
            glyph. */}
        <div className="pad-x"><div className="card list-card-ruled">
          {/* Brain Manual v1 triage: the way back in while anyone is still
              unsorted. It sits above the names because it is the job, not a
              name; it leaves the moment the queue is empty. */}
          {unsorted > 0 && onOpenTriage && (
            <div {...pressable(onOpenTriage)} className="task-row p2 person-row-ruled">
              <div className="task-check-tap gm-slot"><span className="row-glyph"><SweepGlyph /></span></div>
              <div className="task-title">
                <span className="task-name">Continue Sorting</span>
                <div className="r-k"><span className="r-goal r-cat">{lineCase(`${unsorted} Left to Sort`)}</span></div>
              </div>
              {CHEV}
            </div>
          )}
          {shown.map((p) => (
            <div {...pressable(() => onOpen(p.id))} className="task-row p2 person-row-ruled" key={p.id}>
              {/* The avatar leads and stands alone at the row's leading edge (Dave 2026-10-05, the review: the star sat tight
                  against it, two competing leading items). */}
              <div className="task-check-tap"><div className={"av " + softAvatarClass(p.data.color)}><span>{personInitials(p.data.name)}</span></div></div>
              <div className="task-title">
                <span className="task-name">{p.data.name}</span>
                {/* the label, the triage roles, or the honest absence of both;
                    one fact in the subline (C-59: no label is an empty second
                    line, not a nag) */}
                <div className="r-k">{p.data.relationship
                  ? <span className="r-goal r-cat">{lineCase(p.data.relationship)}</span>
                  : brainRolesOf(p).length > 0
                    // ONE RUN, SO A COMMA LIST (2026-10-05, the catalog hard
                    // gate): the roles were joined with a middle dot typed into
                    // the string, a separator CSS draws between facts and never
                    // a character in the words (R6). They are one grey run.
                    ? <span className="r-goal r-cat">{brainRolesOf(p).map(brainRoleLabel).join(", ")}</span>
                    : null}</div>
              </div>
              {/* C-50 (Astra, 2026-09-12): the Remember star, at the trailing edge before the chevron, with a 44px reach. */}
              <EntityStar entityType="person" entityId={p.id} title={p.data.name} />
              {CHEV}
            </div>
          ))}
        </div></div>
        </>
      )}
    </div>
  );
}
