import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { StartAction, StartTarget, StartSource, InTheWay } from "../startAction";
import { smallerAction, IN_THE_WAY } from "../startAction";
import { suggestStopPoint } from "../startStore";
import { createPortal } from "react-dom";
import { pressable } from "../../shared/pressable";
import { useLeaveVia } from "../../shell/navOrigin";
import { lineCase } from "../../shared/casing";
import { progressLabel } from "../../encourage/messages";

// THE WORKING SURFACE (Start Now, 2026-09-16).
//
// One tap of Start lands here, and the deal this screen makes is narrow and
// keepable: something you can work in is already on the screen, and the one
// loud button says exactly what it will do to your records.
//
// What the screen refuses to do, each one a line Dave drew:
//   - It does not start a clock. The timer is a row under Optional Support,
//     off until tapped, and the app never picks a length for him.
//   - It does not claim to have done anything. Saving a draft saves a draft;
//     choosing who it goes to and sending it stay where they already live.
//   - It does not finish the task. Every primary here writes one field and
//     leaves the task open; finishing is still the tick on the row.
//   - It does not ask five questions before it helps. One prompt, once.
//
// The anatomy is the app's: a ruled screen, a nav bar, one card, and the
// facts line the mail rows and the goal page already use, so nothing here
// is a new visual language.

/** What just became true, in words, and where the task stands now. It is
 *  state, not a prize: it stays on screen until the next action, whatever
 *  the celebration setting is, and nothing on the screen waits for it. */
export interface StartAck {
  line: string;
  done: number;
  total: number;
  /** The last open step was just done. The task is NOT done: finishing it is
   *  its own tap, so this is a stopping point and never a second completion. */
  allDone: boolean;
  /** Offered only when there is an exact state to put back. */
  canUndo: boolean;
  /** Changes with every acknowledgment so a new one replays its pulse. */
  nonce: number;
}

type EditorMode = "edit" | "smaller" | "worked";

export interface StartScreenProps {
  target: StartTarget;
  action: StartAction;
  /** The chips over the title: the project or area this belongs to. */
  tags?: string[];
  /** Autosaved on every change, debounced by the caller's store. */
  onDraftChange: (text: string) => void;
  /** The one primary action. Resolves to a receipt line, or null if it
   *  failed, so the screen can stay open with the words still in it. */
  onPrimary: (text: string) => Promise<string | null>;
  /** Navigate to the action's destination, when it has one. */
  onOpenDestination?: () => void;
  /** Leaving: the stopping point travels with it, and is never demanded. */
  onBack: (stopPoint: string) => void;
  /** Something's in the Way, answered. */
  onInTheWay: (answer: InTheWay, text: string) => void;
  /** Finishing is a separate, explicit act, and it lives on the row rather
   *  than in here; this is the one door to it from the work surface. */
  onFinish?: () => void;
  /** Optional support, chosen by the person, never by the app. */
  onStartTimer?: () => void;
  timerLabel?: string;
  /** Where the task's own steps stand: "1 of 4 Complete" and a fill. */
  progress?: { done: number; total: number } | null;
  /** The last time it was worked on, as a plain fact ("Last Worked on Today"). */
  lastWorked?: string | null;
  /** The acknowledgment of the last thing done here. */
  ack?: StartAck | null;
  onUndoAck?: () => void;
  /** Rewrite the words of the step on screen. Resolves true when saved. */
  onEditStep?: (text: string) => Promise<boolean>;
  /** The person's own smaller first move, placed in front of the step. */
  onSmallerStep?: (text: string) => Promise<boolean>;
  /** Partial progress, with an optional note. Never completes anything. */
  onWorked?: (note: string) => Promise<boolean>;
  /** Stop for now: saved, no failure language, no reason asked for. */
  onDoneForNow?: (stopPoint: string) => void;
}

export default function StartScreen({
  target, action, tags = [], onDraftChange, onPrimary, onOpenDestination,
  onBack, onInTheWay, onFinish, onStartTimer, timerLabel,
  progress, lastWorked, ack, onUndoAck, onEditStep, onSmallerStep, onWorked, onDoneForNow,
}: StartScreenProps) {
  // The action on screen can be simplified without the task changing, so the
  // screen owns which version of it is showing.
  const [shown, setShown] = useState<StartAction>(action);
  const [shrinks, setShrinks] = useState(0);
  const [text, setText] = useState(action.seed ?? "");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // The small inline editor under the work card: rewrite this move, name a
  // smaller one, or log that you worked on it. One at a time, never a wizard.
  const [mode, setMode] = useState<EditorMode | null>(null);
  const [editorText, setEditorText] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  // After the last open step the card steps aside for a stopping point;
  // Add Another Move brings it back.
  const [reopened, setReopened] = useState(false);

  // A late re-resolve must never overwrite words already being typed. The
  // seed only lands while the box is still untouched.
  const touched = useRef(false);
  useEffect(() => {
    setShown(action);
    setShrinks(0);
    setMode(null);
    setReopened(false);
    if (!touched.current) setText(action.seed ?? "");
  }, [action]);

  const writes = shown.completion.saves !== "none";
  const opens = !!shown.destination && !!onOpenDestination;
  const smaller = shrinks < 2 ? smallerAction(shown, target) : null;

  const type = (v: string) => {
    touched.current = true;
    setText(v);
    setReceipt(null);
    onDraftChange(v);
  };

  const run = () => void (async () => {
    if (busy) return;
    setBusy(true);
    try {
      const said = await onPrimary(text);
      setReceipt(said);
    } finally {
      setBusy(false);
    }
  })();

  // BACK IS WHERE YOU CAME FROM (Dave 2026-09-21). This said "All Tasks" and
  // meant it, which is right when you opened it from the Tasks list and wrong
  // every other time: Start Now on Today's dealt row jumps into this flow, so
  // the one button on the screen took you somewhere you had not been. Either
  // way the work in progress is saved first -- the stop point is the point of
  // this screen and it is written before anything navigates.
  const leave = useLeaveVia("All Tasks", () => onBack(suggestStopPoint(text)));

  const openEditor = (m: EditorMode) => {
    setMode(m);
    setEditorText(m === "edit" ? (shown.step?.text ?? "") : "");
  };
  const submitEditor = () => void (async () => {
    if (editorBusy || !mode) return;
    const words = editorText.trim();
    // A note on Worked on It is optional. The other two need words.
    if (!words && mode !== "worked") return;
    const send = mode === "edit" ? onEditStep : mode === "smaller" ? onSmallerStep : onWorked;
    if (!send) return;
    setEditorBusy(true);
    try {
      if (await send(words)) { setMode(null); setEditorText(""); }
    } finally {
      setEditorBusy(false);
    }
  })();

  const atRest = !!ack?.allDone && !reopened;
  const hasStep = !!shown.step;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="screen ruled start-ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={leave.onBack}>{leave.label}</button>
        <div className="nav-title">Start</div>
        <span className="nav-action" />
      </div>

      <div className="pad-x start-head">
        {tags.length > 0 && (
          <div className="msg-chips start-tags">
            {tags.map((t) => <span className="chip" key={t}>{t}</span>)}
          </div>
        )}
        <div className="start-title">{target.title}</div>
      </div>

      {progress && progress.total > 0 && (
        <div className="pad-x"><div className="fb-progress">
          {/* One labelled quantity: this task's own steps. The fill is the
              same number the words say, never a score. */}
          <div className="fb-track" aria-hidden="true"><div className="fb-fill" style={{ "--p": pct } as CSSProperties} /></div>
          <div className="fb-count">{progressLabel(progress.done, progress.total)}</div>
        </div></div>
      )}
      {lastWorked && <div className="pad-x"><div className="start-last">{lastWorked}</div></div>}

      {/* A live region that is always present, so a new acknowledgment is
          announced once, politely, and nothing else on the screen is. */}
      <div className="pad-x" role="status" aria-live="polite">
        {ack && (
          <div className="fb-ack" key={ack.nonce}>
            <svg className="fb-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            <span className="fb-ack-line">{ack.line}</span>
            {ack.canUndo && onUndoAck && <button className="quiet-action" onClick={onUndoAck}>Undo</button>}
          </div>
        )}
      </div>

      {atRest ? (
        <div className="pad-x"><div className="card pad start-card">
          <div className="start-headline">Nothing Left Here</div>
          <div className="start-truth">The Task Stays Open Until You Finish It</div>
          <div className="start-acts">
            <button className="btn btn-secondary btn-block" onClick={() => setReopened(true)}>Add Another Move</button>
          </div>
        </div></div>
      ) : (<>
      <div className="sh2 sh2-quiet"><span className="t">Your First Action</span></div>

      <div className="pad-x"><div className="card pad start-card">
        <div className="start-headline">{shown.headline}</div>

        {/* What the app actually read, and what it could not find. A hole is
            warn-toned and named, never quietly filled in.
            ONE GREY RUN (§AK R1, 2026-09-26). A message task hanging off an
            event and a person read "Source: Saturday Tournament" beside "To
            Marco", two plain facts in the same grey. What was read is one
            statement, so it is one fact: the sources join into a phrase
            ("Source: Saturday Tournament, to Marco"), and the amber holes
            stay facts of their own. */}
        {(shown.sources.length > 0 || shown.missing.length > 0) && (
          <div className="facts">
            {shown.sources.length > 0 && <span className="fact">{sourcePhrase(shown.sources)}</span>}
            {shown.missing.map((m, i) => <span className="fact warn" key={"m" + i}>{m}</span>)}
          </div>
        )}

        {/* The work area. A text box when there is something to write, the
            move itself when there is something to do, and a real door when
            there is something to open. */}
        {shown.prompt !== undefined ? (
          <>
            {/* The question is the label, and it stays put while he types.
                It is deliberately NOT repeated as a placeholder: the same
                sentence twice reads as two asks. */}
            <div className="start-label">{shown.prompt}</div>
            <textarea
              ref={boxRef}
              className="msg-textarea start-box"
              aria-label={shown.prompt}
              value={text}
              onChange={(e) => type(e.target.value)}
            />
          </>
        ) : (
          <div className="start-move">{shown.ready}</div>
        )}

        {/* ONE primary, structurally rather than by exemption: the button
            is the same element whichever thing it does, so this screen
            cannot grow a second filled red by accident. */}
        <div className="start-acts">
          <button
            className="btn btn-primary btn-block"
            disabled={busy || (!opens && shown.prompt !== undefined && !text.trim())}
            onClick={() => (opens ? onOpenDestination!() : run())}
          >
            {busy ? "Saving…" : shown.verb}
          </button>
        </div>

        {/* The honest line: what this button does NOT do. Fragments, because
            a paragraph of reassurance is how a screen stops being read. */}
        <div className="start-truth">{truthOf(shown)}</div>
        {receipt && <div className="conn-status">{receipt}</div>}
      </div></div>
      </>)}

      {/* Subordinate on purpose: one dominant action per surface, and these
          are the ways out of it rather than competitors to it. */}
      <div className="pad-x start-support">
        {smaller && !(hasStep && onSmallerStep) && (
          <button className="quiet-action" onClick={() => { setShown(smaller); setShrinks((n) => n + 1); }}>
            Make this smaller
          </button>
        )}
        {hasStep && onSmallerStep && !atRest && (
          <button className="quiet-action" onClick={() => openEditor("smaller")}>Make this smaller</button>
        )}
        {hasStep && onEditStep && !atRest && (
          <button className="quiet-action" onClick={() => openEditor("edit")}>Edit This Move</button>
        )}
        {onWorked && <button className="quiet-action" onClick={() => openEditor("worked")}>Worked on It</button>}
        <button className="quiet-action" onClick={() => setAsk(true)}>Something’s in the way</button>
        {onDoneForNow && <button className="quiet-action" onClick={() => onDoneForNow(suggestStopPoint(text))}>Done for Now</button>}
      </div>

      {mode && (
        <div className="pad-x"><div className="card pad start-card fb-editor">
          <div className="start-label">{mode === "edit" ? "Reword This Move" : mode === "smaller" ? "What Is a Smaller First Move?" : "Anything to Note? (Optional)"}</div>
          <textarea
            className="msg-textarea start-box"
            aria-label={mode === "edit" ? "Reword this move" : mode === "smaller" ? "A smaller first move" : "A note on what you worked on"}
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
          />
          <div className="start-acts fb-editor-acts">
            <button className="btn btn-secondary btn-block" disabled={editorBusy || (mode !== "worked" && !editorText.trim())} onClick={submitEditor}>
              {mode === "edit" ? "Save Change" : mode === "smaller" ? "Save Smaller Move" : "Log It"}
            </button>
            <button className="btn btn-tertiary btn-block" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div></div>
      )}

      <div className="sh2 sh2-quiet"><span className="t">Optional Support</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {/* NEVER AUTOMATIC (Dave 2026-09-16: "Start never begins a timer or
            changes deadlines by default"). The clock is a row you press, it
            says what it will do before you press it, and the length is the
            one the app already uses everywhere else rather than a new one
            invented for this screen. */}
        {onStartTimer && (
          <div className="row" {...pressable(onStartTimer)}>
            <div className="row-grow">
              <div className="conn-name">Put It on the Day</div>
              <div className="conn-meta">{timerLabel ?? "Books a Block You Can Stop"}</div>
            </div>
            <span className="pill-act">Start It</span>
          </div>
        )}
        {onFinish && (
          <div className="row" {...pressable(onFinish)}>
            <div className="row-grow">
              <div className="conn-name">Finish This Task</div>
              <div className="conn-meta">Ticks the Task Itself, Separate from Saving</div>
            </div>
            <span className="pill-act">Finish</span>
          </div>
        )}
      </div></div>

      {writes && <div className="list-floor">Saved on this device {"·"} Nothing leaves here</div>}
      <div className="screen-foot" />

      {ask && (
        <InTheWaySheet
          onPick={(answer) => { setAsk(false); onInTheWay(answer, text); }}
          onClose={() => setAsk(false)}
        />
      )}
    </div>
  );
}

/** What was read, as one phrase: the sources after a comma, cased as one
 *  facts line (the whole rule, Dave 2026-09-26). Only the grounding path
 *  returns two (the event or note it read, then "To" whoever it goes to):
 *  "Source: Practice, To Marco". */
function sourcePhrase(sources: StartSource[]): string {
  return lineCase(sources.map((s) => s.label).join(", "));
}

/** What the primary button will not do, said before it is pressed. */
function truthOf(a: StartAction): string {
  switch (a.completion.saves) {
    case "draft":
      return "Choosing Who It Goes to Stays with You · Nothing Is Sent Here";
    case "step_new":
      return "Becomes the First Step · The Task Stays Open";
    case "step_tick":
      return "Ticks This Step · The Task Stays Open";
    case "note":
      return "Saves Onto This Task · The Task Stays Open";
    default:
      return "Opens the Real Record · Nothing Is Changed";
  }
}

/** Four answers, no questionnaire. */
function InTheWaySheet({ onPick, onClose }: { onPick: (a: InTheWay) => void; onClose: () => void }) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">In the Way</div></div>
        <div className="pad-x sheet-form">
          <div className="list-flat">
            {IN_THE_WAY.map((o) => (
              <div className="row" key={o} {...pressable(() => onPick(o))}>
                <div className="row-grow"><div className="conn-name">{o}</div></div>
                <div className="chev" />
              </div>
            ))}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
