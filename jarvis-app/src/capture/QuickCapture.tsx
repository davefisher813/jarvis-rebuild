import { createPortal } from "react-dom";
import { useState } from "react";
import { useTasks, useSchedule, useNotes, useCategories, useOptionalRules } from "../data/NotesProvider";
import { aliasTrigger } from "../rules/triggers";
import { useAIContext, todayISO } from "../ai/useAIContext";
import type { AIService } from "../ai/AIService";
import type { Category } from "../categories/types";
import { smartPasteSave, undoSaved, refileSaved, recategorizeSaved, type SavedEntity } from "../paste/smartPaste";
import { pasteSeenAge, readRecentCaptures, dropCapture, type RecentCapture } from "../paste/captureLog";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { weekdayLongDate, shortDateFromMs } from "../shared/dateFormat";

const KIND_LABEL: Record<SavedEntity["kind"], string> = { task: "Task", event: "Event", note: "Note" };
const KINDS: SavedEntity["kind"][] = ["task", "event", "note"];

// "Thursday Aug 20 · 7:00 PM" on the receipt: the resolved date is shown so a
// wrong read is visible the moment it happens (Smart Paste law: resolved
// dates on receipt).
function fmtWhen(s: SavedEntity): string {
  const parts: string[] = [];
  if (s.date) {
    parts.push(weekdayLongDate(s.date));
  }
  if (s.start) {
    const [h, m] = s.start.split(":").map((x) => parseInt(x, 10));
    const d = new Date();
    d.setHours(h ?? 9, m ?? 0);
    parts.push(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }
  return parts.join(" · ");
}

function fmtRecent(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yd = new Date(today.getTime() - 86400000);
  if (d.toDateString() === yd.toDateString()) return "Yesterday";
  return shortDateFromMs(ts);
}

// Smart Paste (addendum item 1). Type or paste; JARVIS saves INSTANTLY,
// deterministic rules first, AI only for what they could not read. The
// receipt carries refile chips and undo; correction is post-action, never a
// confirm gate. Recent Captures shows the last ten so a mis-capture from
// earlier is one tap away.
export default function QuickCapture({ ai, onClose }: { ai: AIService; onClose: () => void }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const categoriesSvc = useCategories();
  const gather = useAIContext();
  // Optional: QuickCapture renders in surfaces that may sit outside the rules
  // provider, and a missing store must mean "learn nothing", not a crash.
  const rules = useOptionalRules();

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"input" | "saving" | "saved">("input");
  const [saved, setSaved] = useState<SavedEntity[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [recents, setRecents] = useState<RecentCapture[]>([]);
  const [error, setError] = useState("");
  const [dupAge, setDupAge] = useState<number | null>(null);

  // rules is passed IN, not reached for inside smartPaste: the pipeline stays
  // a pure function of its deps, and a surface that has no rules store simply
  // does not learn rather than crashing or reaching for a global.
  const deps = (categories: Category[]) => ({ ai, gather, tasks, schedule, notes, categories, today: todayISO(), ...(rules ? { rules } : {}) });

  const capture = async (force = false) => {
    const t = text.trim();
    if (!t || phase === "saving") return;
    setError("");
    // Exact-text 7-day dedupe: a fact and a choice, never a silent block.
    if (!force) {
      const age = pasteSeenAge(t);
      if (age !== null) { setDupAge(age); return; }
    }
    setDupAge(null);
    setPhase("saving");
    const categories = await categoriesSvc.list().catch(() => []);
    setCats(categories);
    let out: SavedEntity[] = [];
    const ok = await attemptWrite(async () => { out = await smartPasteSave(t, deps(categories)); });
    if (!ok || out.length === 0) {
      if (ok) setError("Nothing to save in that.");
      setPhase("input");
      return;
    }
    haptics.selection();
    setSaved(out);
    setRecents(readRecentCaptures().filter((r) => !out.some((s) => s.id === r.id)));
    setPhase("saved");
  };

  const onUndo = async (s: SavedEntity) => {
    const ok = await attemptWrite(() => undoSaved(s, deps(cats)));
    if (!ok) return;
    dropCapture(s.id);
    const left = saved.filter((x) => x.id !== s.id);
    setSaved(left);
    if (left.length === 0) setPhase("input");
  };

  const onKind = async (s: SavedEntity, kind: SavedEntity["kind"]) => {
    if (kind === s.kind) return;
    let next: SavedEntity | null = null;
    const ok = await attemptWrite(async () => { next = await refileSaved(s, kind, deps(cats)); });
    if (!ok || !next) return;
    dropCapture(s.id);
    setSaved(saved.map((x) => (x.id === s.id ? next! : x)));
  };

  // A CORRECTION, RECORDED (2026-08-24). Smart Paste read the text and chose
  // a category; changing it here is the user saying that choice was wrong.
  // That is the exact signal the learned-rules engine was built for and had
  // never been given: recordCorrection had zero callers, so no rule was ever
  // created and What JARVIS Learned could only ever be empty.
  //
  // RECORDING ONLY, by Dave's decision. Nothing calls resolve(), so no
  // capture is ever categorised by a rule. The page fills with what JARVIS
  // noticed so the rules can be judged before they are allowed to act.
  //
  // Three guards, all of them refusals:
  //   - only when the category actually CHANGED, so re-tapping the current
  //     chip is not evidence of anything
  //   - only when the text carries a proper noun (see rules/triggers.ts); a
  //     capture with no name in it teaches nothing
  //   - after the write succeeds, never before, because a correction that
  //     failed to save is not a correction
  const onCat = async (s: SavedEntity, categoryId: string) => {
    const was = s.category;
    const ok = await attemptWrite(() => recategorizeSaved(s, categoryId, deps(cats)));
    if (!ok) return;
    setSaved(saved.map((x) => (x.id === s.id ? { ...x, category: categoryId } : x)));
    if (was === categoryId) return;
    // s.raw, not s.title: title has been through titleCase, which capitalises
    // every meaningful word, so the proper-noun heuristic run over it returns
    // the whole title. The apply side in smartPaste keys on raw too, and the
    // two must agree or no correction ever matches its own lookup.
    const trigger = s.raw ? aliasTrigger(s.raw) : null;
    if (!trigger || !rules) return;
    const to = cats.find((c) => c.id === categoryId)?.data.name ?? categoryId;
    // Never throws into the tap: learning is a side effect of the correction,
    // and a storage failure must not make the recategorise look like it lost.
    void rules.recordCorrection("alias", "capture.category", trigger, categoryId, `"${s.title}" moved to ${to}`)
      .catch(() => { /* the next identical correction re-observes it */ });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{phase === "saved" ? "Saved" : "Smart Paste"}</div></div>

        {phase !== "saved" && (
          <div className="pad-x sheet-form">
            <textarea
              className="input input-multiline"
              placeholder="Paste or type · dinner with Marco Thursday 7pm"
              value={text}
              onChange={(e) => { setText(e.target.value); setDupAge(null); }}
              autoFocus
            />
            {error && <div className="input-error">{error}</div>}
            {dupAge !== null && (
              <div className="input-note">You captured this exact text {Math.max(1, Math.round(dupAge / 86400000))} {dupAge < 86400000 * 1.5 ? "day" : "days"} ago.</div>
            )}
            <div className="sheet-actions">
              {dupAge === null ? (
                <button className="btn btn-primary btn-block" onClick={() => void capture()} disabled={!text.trim() || phase === "saving"}>
                  {phase === "saving" ? "Saving..." : "Capture"}
                </button>
              ) : (
                // B12: the sibling Capture button already disables while
                // saving; this branch could still double-fire.
                <button className="btn btn-primary btn-block" disabled={phase === "saving"} onClick={() => void capture(true)}>{phase === "saving" ? "Saving..." : "Save Anyway"}</button>
              )}
              <button className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {phase === "saved" && (
          <div className="pad-x sheet-form">
            <div className="capture-saved-list">
              {saved.map((s) => (
                <div key={s.id} className="capture-saved">
                  <div className="row">
                    <div className="row-stack">
                      <div className="conn-name">{s.title}</div>
                      <div className="conn-meta">{[KIND_LABEL[s.kind], fmtWhen(s)].filter(Boolean).join(" · ")} · From your paste</div>
                    </div>
                    <button className="btn-sm" onClick={() => void onUndo(s)}>Undo</button>
                  </div>
                  <div className="chip-row">
                    {KINDS.map((k) => (
                      <div key={k} className={"chip" + (s.kind === k ? " active" : "")} role="radio" aria-checked={s.kind === k} tabIndex={0} onClick={() => void onKind(s, k)}>{KIND_LABEL[k]}</div>
                    ))}
                    {cats.slice(0, 4).map((c) => (
                      <div key={c.id} className={"chip" + (s.category === c.id ? " active" : "")} role="radio" aria-checked={s.category === c.id} tabIndex={0} onClick={() => void onCat(s, c.id)}>
                        <span className={"cat-dot cat-bg-" + c.data.color} />
                        {c.data.name}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {recents.length > 0 && (
              <>
                <div className="grp"><div className="eyebrow">Recent Captures</div></div>
                <div className="capture-recents">
                  {recents.map((r) => (
                    <div key={r.id} className="row">
                      <div className="row-stack">
                        <div className="conn-name truncate">{r.title}</div>
                        <div className="conn-meta">{KIND_LABEL[r.kind]} · {fmtRecent(r.ts)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="sheet-actions">
              <button className="btn btn-primary btn-block" onClick={() => { setText(""); setSaved([]); onClose(); showToast({ message: saved.length === 1 ? "Saved" : `Saved ${saved.length} items` }); }}>Done</button>
              <button className="btn btn-secondary btn-block" onClick={() => { setText(""); setSaved([]); setPhase("input"); }}>Capture Another</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
