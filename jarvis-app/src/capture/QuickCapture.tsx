import { createPortal } from "react-dom";
import { useState } from "react";
import { useTasks, useSchedule, useNotes, useCategories } from "../data/NotesProvider";
import { useAIContext, todayISO } from "../ai/useAIContext";
import type { AIService } from "../ai/AIService";
import type { Category } from "../categories/types";
import { smartPasteSave, undoSaved, refileSaved, recategorizeSaved, type SavedEntity } from "../paste/smartPaste";
import { pasteSeenAge, readRecentCaptures, dropCapture, type RecentCapture } from "../paste/captureLog";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";

const KIND_LABEL: Record<SavedEntity["kind"], string> = { task: "Task", event: "Event", note: "Note" };
const KINDS: SavedEntity["kind"][] = ["task", "event", "note"];

// "Thursday Aug 20 · 7:00 PM" on the receipt: the resolved date is shown so a
// wrong read is visible the moment it happens (Smart Paste law: resolved
// dates on receipt).
function fmtWhen(s: SavedEntity): string {
  const parts: string[] = [];
  if (s.date) {
    const d = new Date(s.date + "T00:00:00");
    parts.push(d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }));
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
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
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

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"input" | "saving" | "saved">("input");
  const [saved, setSaved] = useState<SavedEntity[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [recents, setRecents] = useState<RecentCapture[]>([]);
  const [error, setError] = useState("");
  const [dupAge, setDupAge] = useState<number | null>(null);

  const deps = (categories: Category[]) => ({ ai, gather, tasks, schedule, notes, categories, today: todayISO() });

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

  const onCat = async (s: SavedEntity, categoryId: string) => {
    const ok = await attemptWrite(() => recategorizeSaved(s, categoryId, deps(cats)));
    if (!ok) return;
    setSaved(saved.map((x) => (x.id === s.id ? { ...x, category: categoryId } : x)));
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
                <button className="btn btn-primary btn-block" onClick={() => void capture(true)}>Save Anyway</button>
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
                      <div className="conn-meta">{[KIND_LABEL[s.kind], fmtWhen(s)].filter(Boolean).join(" · ")} · from your paste</div>
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
