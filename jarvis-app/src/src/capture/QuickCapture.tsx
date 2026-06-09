import { createPortal } from "react-dom";
import { useState } from "react";
import { useTasks, useSchedule, useNotes, useCategories } from "../data/NotesProvider";
import { useAIContext, todayISO } from "../ai/useAIContext";
import type { AIService } from "../ai/AIService";
import { captureSystemPrompt, parseCapture, localParse, applyCapture, type CaptureResult } from "../ai/capture";

const KIND_LABEL: Record<CaptureResult["kind"], string> = { task: "Task", event: "Event", note: "Note" };

// Type a quick note; JARVIS routes it to a task, event, or note. Uses the AI
// proxy when available, and a local heuristic otherwise (e.g. the demo).
export default function QuickCapture({ ai, onClose }: { ai: AIService; onClose: () => void }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const categories = useCategories();
  const gather = useAIContext();

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"input" | "thinking" | "preview">("input");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState("");

  const capture = async () => {
    const t = text.trim();
    if (!t) return;
    setError("");
    setPhase("thinking");
    const today = todayISO();
    try {
      let parsed: CaptureResult | null = null;
      if (ai.available) {
        const ctx = await gather();
        const raw = await ai.complete([{ role: "user", content: t }], captureSystemPrompt(ctx, today));
        parsed = parseCapture(raw);
      }
      setResult(parsed ?? localParse(t, today));
      setPhase("preview");
    } catch {
      setResult(localParse(t, today));
      setPhase("preview");
    }
  };

  const confirm = async () => {
    if (!result) return;
    await applyCapture(result, { tasks, schedule, notes }, await categories.list(), todayISO());
    onClose();
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Quick Capture</div></div>

        {phase !== "preview" && (
          <div className="pad-x sheet-form">
            <textarea
              className="input input-multiline"
              placeholder="Lunch with Sam Thursday 1pm. Or: remember to renew the domain."
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            {error && <div className="input-error">{error}</div>}
            <div className="sheet-actions">
              <button className="btn btn-primary btn-block" onClick={capture} disabled={!text.trim() || phase === "thinking"}>
                {phase === "thinking" ? "Thinking..." : "Capture"}
              </button>
              <button className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {phase === "preview" && result && (
          <div className="pad-x sheet-form">
            <div className="capture-preview">
              <span className="capture-kind">{KIND_LABEL[result.kind]}</span>
              <div className="capture-title">{result.title}</div>
              {(result.date || result.start) && (
                <div className="capture-meta">{[result.date, result.start].filter(Boolean).join(" at ")}</div>
              )}
              {result.category && <div className="capture-meta">{result.category}</div>}
            </div>
            <div className="sheet-actions">
              <button className="btn btn-primary btn-block" onClick={confirm}>Add {KIND_LABEL[result.kind]}</button>
              <button className="btn btn-secondary btn-block" onClick={() => setPhase("input")}>Edit</button>
            </div>
          </div>
        )}
      </div>
    </div>
    ,
    document.body,
  );
}
