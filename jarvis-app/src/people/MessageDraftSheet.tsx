import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Person } from "./types";
import type { AIService } from "../ai/AIService";
import { draftSystemPrompt, smsLink, DRAFT_TONES, TONE_LABEL, type DraftTone } from "./messageDraft";
import { personInitials, avatarClass } from "./types";
import { onPressKey } from "../shared/pressable";

// Messages Drafting (addendum item 3, approved preview 2026-08-15). The
// draft exists at open; the textarea IS the edit surface; Open in Messages
// hands the text to the real composer via sms: and the USER hits send.
// Nothing is logged after: this sheet owns no services, performs no writes,
// and the law test pins it that way. Register-aware: the person's stored
// register and flag set the floor, the three-way segment sets this message's
// tone, and changing it redrafts.
export default function MessageDraftSheet({
  person,
  ai,
  about,
  voice: userVoice,
  onClose,
}: {
  person: Person;
  ai: AIService;
  // UP-MIND-23 (2026-09-05): the writing voice plus what is LINKED to this
  // person, gathered by the caller (this sheet owns no services, which is
  // its own law and pinned by a test). Absent means the plain prompt.
  voice?: string;
  // What the message needs to say, when the opening surface knows (a task,
  // an event, a lateness). Absent = a natural check-in.
  about?: string;
  onClose: () => void;
}) {
  const [tone, setTone] = useState<DraftTone>("direct");
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  // Audit 2026-09-11 item 1 (fixed 2026-09-13): the voice ("How You Write")
  // arrives async from the caller, after the draft at open has already gone
  // out without it. These three remember what the last draft was written
  // with and what it said, so a voice that lands late redrafts once, never
  // over words he has already edited by hand; and a draft that comes back
  // after a newer one was asked for is dropped, so a slow first answer can
  // never overwrite the voiced one.
  const draftedVoice = useRef<string | undefined>(undefined);
  const lastAI = useRef<string | null>(null);
  const seq = useRef(0);

  const draft = useCallback(async (t: DraftTone) => {
    if (!ai.available) return; // honest empty composer; placeholder says so
    const mine = ++seq.current;
    const voice = userVoice?.trim() || undefined;
    draftedVoice.current = voice;
    setDrafting(true);
    try {
      const out = await ai.complete(
        [{ role: "user", content: about ?? `Draft a message to ${person.data.name}.` }],
        draftSystemPrompt(person.data, t, about, { ...(voice ? { voice } : {}) }),
        { kind: "message", pin: "messageDrafts", tier: "write" },
      );
      if (mine !== seq.current) return;
      lastAI.current = out.trim();
      setText(out.trim());
    } catch {
      // The composer still works by hand; a failed draft is an empty box,
      // not an error state.
    } finally {
      if (mine === seq.current) setDrafting(false);
    }
  }, [ai, person, about, userVoice]);

  // Draft exists at open.
  useEffect(() => { void draft(tone); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The late voice: redraft once, only while the box still holds the AI's
  // own words (or nothing yet).
  useEffect(() => {
    const voice = userVoice?.trim() || undefined;
    if (!voice || voice === draftedVoice.current) return;
    if (lastAI.current !== null && text !== lastAI.current) return;
    void draft(tone);
  }, [userVoice]);

  const pickTone = (t: DraftTone) => {
    if (t === tone) return;
    setTone(t);
    void draft(t);
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Message</div></div>
        <div className="pad-x sheet-form">
          <div className="row">
            <div className={"av " + avatarClass(person.data.color)}>{personInitials(person.data.name)}</div>
            <div className="row-grow"><div className="conn-name">{person.data.name}</div></div>
          </div>
          <div className="seg-card"><div className="segmented">
            {DRAFT_TONES.map((t) => (
              <div key={t} className={"seg" + (tone === t ? " active" : "")} role="radio" aria-checked={tone === t} tabIndex={0} onClick={() => pickTone(t)} onKeyDown={onPressKey(() => pickTone(t))}>
                {TONE_LABEL[t]}
              </div>
            ))}
          </div></div>
          <div className="field">
            <textarea
              className="input input-multiline"
              placeholder={ai.available ? (drafting ? "Drafting..." : "Say it your way.") : "Type your message."}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="sheet-actions">
            {/* The preview's "you hit send there" line is the DESIGN, not
                copy: permanent helper text is banned, so the sheet just
                behaves that way instead of saying it. */}
            <a className="btn btn-primary btn-block" href={smsLink(person.data.phone, text)} onClick={onClose}>Open in Messages</a>
            <button className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
