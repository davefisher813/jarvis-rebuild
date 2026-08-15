import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import type { Person } from "./types";
import type { AIService } from "../ai/AIService";
import { draftSystemPrompt, smsLink, DRAFT_TONES, TONE_LABEL, type DraftTone } from "./messageDraft";
import { personInitials, avatarClass } from "./types";

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
  onClose,
}: {
  person: Person;
  ai: AIService;
  // What the message needs to say, when the opening surface knows (a task,
  // an event, a lateness). Absent = a natural check-in.
  about?: string;
  onClose: () => void;
}) {
  const [tone, setTone] = useState<DraftTone>("direct");
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);

  const draft = useCallback(async (t: DraftTone) => {
    if (!ai.available) return; // honest empty composer; placeholder says so
    setDrafting(true);
    try {
      const out = await ai.complete(
        [{ role: "user", content: about ?? `Draft a message to ${person.data.name}.` }],
        draftSystemPrompt(person.data, t, about),
        { kind: "message", pin: "messageDrafts", tier: "write" },
      );
      setText(out.trim());
    } catch {
      // The composer still works by hand; a failed draft is an empty box,
      // not an error state.
    } finally {
      setDrafting(false);
    }
  }, [ai, person, about]);

  // Draft exists at open.
  useEffect(() => { void draft(tone); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
              <div key={t} className={"seg" + (tone === t ? " active" : "")} role="radio" aria-checked={tone === t} tabIndex={0} onClick={() => pickTone(t)}>
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
