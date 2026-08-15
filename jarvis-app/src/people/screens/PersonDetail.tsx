import type { Person } from "../types";
import { personInitials, avatarClass } from "../types";
import { FileText } from "lucide-react";
import { catColor } from "../../shared/categories";

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
  linkedNotes = [],
  onOpenNote,
  onCallPrep,
  onMessage,
  categoryNames = [],
}: {
  person: Person;
  onEdit: () => void;
  onBack: () => void;
  linkedNotes?: { id: string; title: string; category: string }[];
  onOpenNote?: (id: string) => void;
  // Opens the Call Prep card (addendum item 2). Without it the row falls
  // back to a bare tel: link (surfaces with no service access).
  onCallPrep?: () => void;
  // Opens the Messages drafting sheet (addendum item 3). Without it the row
  // falls back to a bare sms: link.
  onMessage?: () => void;
  // Names of the categories this person belongs to (resolved by the caller,
  // since this screen has no service access on purpose).
  categoryNames?: string[];
}) {
  const { name, relationship, birthday, notes, color, email, phone, register, flagged } = person.data;
  const hasAttrs = relationship || birthday || flagged || register || categoryNames.length > 0;
  // How JARVIS writes to them, stated in the card because it drives every
  // draft. Flagged wins over register, same precedence the drafting stack uses.
  const writeStyle = flagged
    ? "With care, always professional"
    : register === "friend" ? "Like a close friend"
    : register === "casual" ? "Casual"
    : register === "professional" ? "Professional"
    : undefined;
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
      {/* Reach them (2026-08-10): the email and phone this card has stored
          since the person pass, finally shown, and tappable so the card is a
          launchpad, not a filing cabinet. */}
      {(email || phone) && (
        <div className="pad-x"><div className="card">
          {phone && onCallPrep && (
            // Call Prep (addendum item 2): the call action opens the prep
            // card, which carries the dial. Context first, then the phone.
            <div className="row person-reach" role="button" tabIndex={0} onClick={onCallPrep}>
              <div className="row-grow"><div className="conn-name">Call</div></div>
              <span className="kv-val">{phone}</span>
            </div>
          )}
          {phone && !onCallPrep && (
            <a className="row person-reach" href={"tel:" + phone.replace(/[^+\d]/g, "")}>
              <div className="row-grow"><div className="conn-name">Call</div></div>
              <span className="kv-val">{phone}</span>
            </a>
          )}
          {phone && onMessage && (
            // Messages Drafting (addendum item 3): the text action opens the
            // drafting sheet; the draft exists when it opens.
            <div className="row person-reach" role="button" tabIndex={0} onClick={onMessage}>
              <div className="row-grow"><div className="conn-name">Text</div></div>
              <span className="kv-val">{phone}</span>
            </div>
          )}
          {phone && !onMessage && (
            <a className="row person-reach" href={"sms:" + phone.replace(/[^+\d]/g, "")}>
              <div className="row-grow"><div className="conn-name">Text</div></div>
              <span className="kv-val">{phone}</span>
            </a>
          )}
          {email && (
            <a className="row person-reach" href={"mailto:" + email}>
              <div className="row-grow"><div className="conn-name">Email</div></div>
              <span className="kv-val">{email}</span>
            </a>
          )}
        </div></div>
      )}
      {hasAttrs && (
        <div className="pad-x"><div className="card">
          <KV label="Relationship" value={relationship} />
          <KV label="Birthday" value={birthday} />
          <KV label="JARVIS writes" value={writeStyle} />
          <KV label="Categories" value={categoryNames.length > 0 ? categoryNames.join(", ") : undefined} />
        </div></div>
      )}
      {notes && (
        <>
          <div className="grp"><div className="eyebrow">Notes</div></div>
          <div className="pad-x"><div className="card"><div className="note-body">{notes}</div></div></div>
        </>
      )}
      {linkedNotes.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Linked Notes</div></div>
          <div className="pad-x"><div className="card">
            {linkedNotes.map((n) => (
              <div className="row" role={onOpenNote ? "button" : undefined} tabIndex={onOpenNote ? 0 : undefined} key={n.id} onClick={onOpenNote ? () => onOpenNote(n.id) : undefined}>
                <div className={"proj-icon cat-bg-" + (n.category ? catColor(n.category) : "graphite")}><FileText className="ic" /></div>
                <div className="conn-name">{n.title}</div>
                {onOpenNote && <div className="chev"></div>}
              </div>
            ))}
          </div></div>
        </>
      )}
    </div>
  );
}
