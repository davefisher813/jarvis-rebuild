import { createPortal } from "react-dom";
import type { AIActionKey } from "../aiActions";
import { actionLabel } from "../aiActions";

// JARVIS'S REPLY, AS A PREVIEW (the writing system, wave 4). The original
// and the suggestion side by side, and three ways out: Apply (one undo
// step), Keep Original (nothing happens), Copy Result. When the words
// changed while JARVIS worked, Apply is not offered over them: the reply
// can be inserted after the caret, or copied, and the newer words stand.
export default function AISheet({ action, original, result, error, stale, onApply, onInsert, onCopy, onRetry, onClose }: {
  action: AIActionKey;
  original: string;
  /** Null while JARVIS is working. */
  result: string | null;
  error: string | null;
  /** True when the selected words changed since the request went out. */
  stale: boolean;
  onApply: () => void;
  onInsert: () => void;
  onCopy: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{actionLabel(action)}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Your Words</div>
            <pre className="exp-preview ai-original">{original}</pre>
          </div>
          <div className="field">
            <div className="input-label">JARVIS Suggests</div>
            {result === null && !error && <div className="exp-note" role="status">Working on it</div>}
            {error && <div className="exp-note" role="alert">{error}</div>}
            {result !== null && <pre className="exp-preview ai-result">{result}</pre>}
          </div>
          {stale && result !== null && (
            <div className="exp-note" role="status">You kept writing while JARVIS worked, so your newer words stay</div>
          )}
          <div className="exp-acts">
            {result !== null && !stale && <button type="button" className="btn btn-primary" onClick={onApply}>Apply</button>}
            {result !== null && stale && <button type="button" className="btn btn-primary" onClick={onInsert}>Insert After the Caret</button>}
            {error && <button type="button" className="btn btn-primary" onClick={onRetry}>Retry</button>}
            {result !== null && <button type="button" className="btn btn-secondary" onClick={onCopy}>Copy Result</button>}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Keep Original</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
