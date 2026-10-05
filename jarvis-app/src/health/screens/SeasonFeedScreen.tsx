import { useRef, useState } from "react";
import type { AIService } from "../../ai/AIService";
import { buildVisionMessage } from "../../ai/AIService";
import { JARVIS_VOICE } from "../../ai/voice";
import { SEASON_EXTRACT_PROMPT, parseSeasonExtract, type SeasonFeedDraft } from "../seasonFeed";
import { showToast } from "../../shared/toast";
import { encodeImageForVision } from "../../shared/imageEncode";
import { weekdayShortDate } from "../../shared/dateFormat";
import { fmtRange } from "../../schedule/calendar";

// THE SEASON FEED (Part 8, rank #3). Photo/screenshot or pasted text of a
// team's practice schedule -> the model extracts -> every row is reviewed
// before anything commits. The raw file is never retained, same pipeline
// shape as gym/UploadFlow.tsx (read as a pattern, not shared code).
//
// FOLLOW-UP: a real ICS/subscription feed is not built in this pass; only
// the photo/text path ships here.
export default function SeasonFeedScreen({ ai, onCommit, onBack }: {
  ai: AIService;
  onCommit: (draft: SeasonFeedDraft) => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SeasonFeedDraft | null>(null);

  const extract = async (message: Parameters<AIService["complete"]>[0][number]) => {
    setBusy(true);
    try {
      const out = await ai.complete([message], JARVIS_VOICE);
      const parsed = parseSeasonExtract(out);
      if (!parsed) {
        showToast({ message: "Couldn't Read That · Try a Clearer Photo" });
        return;
      }
      setDraft(parsed);
    } catch {
      showToast({ message: "Couldn't Reach JARVIS · Try Again" });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    try {
      const img = await encodeImageForVision(file);
      await extract(buildVisionMessage(SEASON_EXTRACT_PROMPT, img.data, img.mediaType));
    } catch {
      showToast({ message: "Couldn't Open That Image \u00b7 Try Another File" });
    }
  };

  if (draft) {
    return (
      <div className="screen ruled health-ruled">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={() => setDraft(null)}></button>
          <div className="nav-title truncate">{draft.org}</div>
        </div>
        <div className="pad-x"><div className="card pad">
          <div className="conn-name">What I Read · Fix Anything Later</div>
        </div></div>
        <div className="pad-x"><div className="card list-card-ruled">
          {draft.events.map((e, i) => (
            <div className="row" key={i}>
              <div className="row-grow">
                <div className="conn-name truncate">{e.title}</div>
                {/* A neutral date and a neutral time, each small caps (§AM
                    F5), with the dot between them drawn by CSS (F3). */}
                {/* 2026-10-05 (the catalog gate): the extractor's own strings
                    ("2026-09-04", "15:30") were drawn as they came, an ISO date
                    and a 24-hour clock. A date is said the way a person says it
                    ("Fri, Sep 4") and a time is 12-hour with AM or PM, through
                    the same two formatters the Schedule upload review uses. */}
                <div className="facts">
                  <span className="fact date">{weekdayShortDate(e.date)}</span>
                  <span className="fact date">{fmtRange(e.start, e.end)}</span>
                </div>
              </div>
            </div>
          ))}
        </div></div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => onCommit(draft)}>Add These to the Calendar</button>
          <button className="btn btn-secondary btn-block" onClick={onBack}>Cancel</button>
        </div>
        <div className="screen-foot" />
      </div>
    );
  }

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Season Feed</div>
      </div>
      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Read a Team Schedule</div>
        <div className="bp-sub">A screenshot or a pasted message, turned into real calendar events.</div>
      </div></div>
      <div className="pad-x">
        <input ref={fileRef} className="visually-hidden-input" type="file" accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Reading..." : "Photo or Screenshot"}
        </button>
        <div className="field">
          <div className="input-label">Or Paste It</div>
          {/* A placeholder is content, not a label: sentence case, like the
              two screens that do this identical job (UploadFlow's "Paste the
              Program · a message or spreadsheet works" and
              ScheduleUploadFlow's "Paste the Schedule · a message or email
              works"). This one shipped in Title Case. */}
          <textarea className="input input-multiline" rows={5} placeholder="Paste the schedule · a message or a spreadsheet works" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button className="btn btn-secondary btn-block" disabled={busy || !text.trim()}
          onClick={() => void extract({ role: "user", content: SEASON_EXTRACT_PROMPT + "\n\nCONTENT:\n" + text.trim().slice(0, 12000) })}>
          {busy ? "Reading..." : "Read the Pasted Text"}
        </button>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
