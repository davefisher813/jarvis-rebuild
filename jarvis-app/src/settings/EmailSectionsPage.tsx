import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { showToast } from "../shared/toast";
import { Mail } from "../shared/icons";
import RowActionSheet from "../shared/RowActionSheet";
import { Head, Card, Row, Foot } from "./kit";
import { useUserId } from "../data/NotesProvider";
import { loadSnapshot } from "../email/deviceCache";
import { SECTION_NAME, listMoves, putBack, recordMove, type SectionMove } from "../email/sections";

// EMAIL SECTIONS (2026-10-12, Email v1 spec 2.7 and 3.2). Settings holds "explicit section overrides", and nothing else
// for sections: no rules builder. The five sections are a fixed, deterministic resolver (src/email/sections.ts); the one
// thing a person changes is where ONE message sits, with Move to Section on the Email tab. This page lists those moves,
// newest first, each with Put Back, which returns the message to the section its own facts give it. Undo on the toast
// moves it again.
//
// The moves live on this device (the Email tab's Move to Section writes them there). Nothing here calls AI or touches
// Gmail: a move never archives, changes a read flag or changes a Gmail label.
//
// The matcher-based section builder that used to be here is gone from Settings (spec 2.7: "No rules builder"). Its data
// module (messages/emailSections.ts) stays for the older Messages screen that still reads it.

export const MOVES_HEAD = "Your Moves";
export const PUT_BACK = "Put Back";
export const NO_MOVES_TITLE = "No Moves Yet";
export const NO_MOVES_SUB = "Move to Section on a Message Puts It Here";
export const OPEN_EMAIL = "Open Email";
export const MOVES_FOOT = "Moves stay on this phone, and nothing changes in Gmail";
export const UNTITLED_MOVE = "A Moved Message";
export const putBackDone = (subject: string | null): string => `Put Back · ${subject || UNTITLED_MOVE}`;

export default function EmailSectionsPage({ onBack, onOpenEmail, userId: givenUser }: {
  onBack: () => void;
  /** The Email tab, where Move to Section is. The empty state's door. */
  onOpenEmail?: () => void;
  /** A test passes its own; undefined means the signed-in person's. */
  userId?: string;
}) {
  const ctxUser = useUserId();
  const userId = givenUser ?? ctxUser ?? "";
  const known = () => { try { return loadSnapshot(userId)?.rows ?? []; } catch { return []; } };
  const [moves, setMoves] = useState<SectionMove[]>(() => listMoves(userId, known()));
  const [menuFor, setMenuFor] = useState<SectionMove | null>(null);
  const reread = () => setMoves(listMoves(userId, known()));

  const back = (m: SectionMove) => {
    putBack(userId, m.id);
    reread();
    showToast({
      message: putBackDone(m.subject),
      actionLabel: "Undo",
      onAction: () => { recordMove(userId, { id: m.id, subject: m.subject ?? "", from_name: m.from ?? "", from_address: "" }, m.key, m.at ? new Date(m.at) : new Date()); reread(); },
    });
  };

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Email Sections" back="Settings" onBack={onBack} />
      <Head label={MOVES_HEAD} count={moves.length > 0 ? moves.length : undefined} />
      {moves.length === 0 ? (
        <div className="empty-state empty-compact">
          {/* D9: a crafted empty state, a glyph in its type's colour (Email is teal), the title, one warm line, its door. */}
          <div className="empty-icon cat-fg-teal"><Mail className="ic" /></div>
          <div className="empty-title">{NO_MOVES_TITLE}</div>
          <div className="empty-sub">{NO_MOVES_SUB}</div>
          {onOpenEmail && <button className="btn btn-primary" onClick={onOpenEmail}>{OPEN_EMAIL}</button>}
        </div>
      ) : (
        <>
          <Card>
            {moves.map((m) => (
              // The row's one grey is the sender; the section it was moved to is a small-caps fact. A tap opens Put Back
              // in the row's sheet: no pill inside the row.
              <Row key={m.id} label={m.subject || UNTITLED_MOVE} onClick={() => setMenuFor(m)} chev
                meta={<><span className="fact date">{`In ${SECTION_NAME[m.key]}`}</span>{m.from && <span className="fact">{m.from}</span>}</>} />
            ))}
          </Card>
          <Foot>{MOVES_FOOT}</Foot>
        </>
      )}
      {menuFor && (
        <RowActionSheet title={menuFor.subject || UNTITLED_MOVE} actions={[{ label: PUT_BACK, onPick: () => back(menuFor) }]} onCancel={() => setMenuFor(null)} />
      )}
      <div className="screen-foot" />
    </div>
  );
}
