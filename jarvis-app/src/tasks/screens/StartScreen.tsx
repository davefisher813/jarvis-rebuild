import { useEffect, useRef, useState } from "react";
import type { StartAction, StartTarget, InTheWay } from "../startAction";
import { smallerAction, IN_THE_WAY } from "../startAction";
import { suggestStopPoint } from "../startStore";
import { createPortal } from "react-dom";
import { pressable } from "../../shared/pressable";
import { leaveVia, useNavOrigin } from "../../shell/navOrigin";

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
}

export default function StartScreen({
  target, action, tags = [], onDraftChange, onPrimary, onOpenDestination,
  onBack, onInTheWay, onFinish, onStartTimer, timerLabel,
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

  // A late re-resolve must never overwrite words already being typed. The
  // seed only lands while the box is still untouched.
  const touched = useRef(false);
  useEffect(() => {
    setShown(action);
    setShrinks(0);
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
  const leave = leaveVia(useNavOrigin(), "All Tasks", () => onBack(suggestStopPoint(text)));

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

      <div className="sh2 sh2-quiet"><span className="t">Your First Action</span></div>

      <div className="pad-x"><div className="card pad start-card">
        <div className="start-headline">{shown.headline}</div>

        {/* What the app actually read, and what it could not find. A hole is
            warn-toned and named, never quietly filled in. */}
        {(shown.sources.length > 0 || shown.missing.length > 0) && (
          <div className="facts">
            {shown.sources.map((s, i) => <span className="fact" key={"s" + i}>{s.label}</span>)}
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

      {/* Subordinate on purpose: one dominant action per surface, and these
          are the ways out of it rather than competitors to it. */}
      <div className="pad-x start-support">
        {smaller && (
          <button className="quiet-action" onClick={() => { setShown(smaller); setShrinks((n) => n + 1); }}>
            Make this smaller
          </button>
        )}
        <button className="quiet-action" onClick={() => setAsk(true)}>Something’s in the way</button>
      </div>

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
              <div className="conn-meta">{timerLabel ?? "Books a block you can stop"}</div>
            </div>
            <span className="pill-act">Start It</span>
          </div>
        )}
        {onFinish && (
          <div className="row" {...pressable(onFinish)}>
            <div className="row-grow">
              <div className="conn-name">Finish This Task</div>
              <div className="conn-meta">Ticks the task itself {"·"} Separate from saving</div>
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

/** What the primary button will not do, said before it is pressed. */
function truthOf(a: StartAction): string {
  switch (a.completion.saves) {
    case "draft":
      return "Choosing who it goes to stays with you · Nothing is sent here";
    case "step_new":
      return "Becomes the first step · The task stays open";
    case "step_tick":
      return "Ticks this step · The task stays open";
    case "note":
      return "Saves onto this task · The task stays open";
    default:
      return "Opens the real record · Nothing is changed";
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
