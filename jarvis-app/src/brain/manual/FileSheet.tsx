import { useState } from "react";
import { useBrainMemory } from "../../data/NotesProvider";
import { attemptWrite } from "../../shared/guard";
import { showToast } from "../../shared/toast";
import {
  categoryLabel,
  filedToastText,
  type BrainMemoryCategory,
} from "../../ai/brainMemory";
import { fileMemory } from "../../ai/filingIntake";
import { voiceGuard } from "../../ai/filing";

const CATS: BrainMemoryCategory[] = ["fact", "decision", "philosophy", "value", "voice"];

const TEXT_LABEL: Record<BrainMemoryCategory, string> = {
  fact: "The Fact",
  decision: "The Decision",
  philosophy: "The Principle",
  value: "The Value",
  voice: "The Sample",
};

const TEXT_PLACEHOLDER: Record<BrainMemoryCategory, string> = {
  fact: "e.g. Allergic to Peanuts",
  decision: "e.g. Hired a Trainer Twice a Week",
  philosophy: "e.g. Discipline Beats Motivation",
  value: "e.g. Family First",
  voice: "e.g. Paste a Paragraph You Wrote",
};

/**
 * The Brain tab's quick-add sheet. One text field, a category chooser, and
 * for decisions the why. Filed rows land in brain_memory with source
 * "brain", so the detail screen's "Filed from" line reads "The Brain Tab".
 * Voice samples go through the voice guard (3-word minimum, no duplicates)
 * and the 5-sample cap, exactly like the filing intake.
 */
export default function FileSheet({
  category: initialCategory,
  onClose,
  onFiled,
}: {
  category: BrainMemoryCategory;
  onClose: () => void;
  onFiled: () => void;
}) {
  const svc = useBrainMemory();
  const [category, setCategory] = useState<BrainMemoryCategory>(initialCategory);
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving || !text.trim()) return;
    setSaving(true);
    const done = (message: string, close: boolean) => {
      setSaving(false);
      showToast({ message });
      if (close) { onFiled(); onClose(); }
    };
    if (category === "voice") {
      const existing = (await svc.voiceSamples()).map((s) => s.data.text);
      const guard = voiceGuard(text, existing);
      if (guard === "too-short") { setSaving(false); showToast({ message: "Too Short · Needs 3 Words" }); return; }
      if (guard === "duplicate") { done("Already Filed · Skipped", true); return; }
    }
    const ok = await attemptWrite(async () => {
      if (category === "voice") {
        // Brain Manual v1: a sample filed from the Brain tab says so. Without
        // the source it would file as "email", and the Writing page would
        // tell him the sample came from his mail.
        const { replaced } = await svc.saveVoiceSample(text.trim(), "brain");
        done(replaced ? "Saved to Voice ✓ · Oldest Replaced" : filedToastText("voice"), true);
      } else if (category === "decision") {
        // fileMemory builds the §2 payload: LEARNED, today's date and the
        // active status, the same shape every other filing writes.
        await svc.file(fileMemory({
          category: "decision",
          text: text.trim(),
          why: why.trim() || undefined,
          source: "brain",
        }));
        done(filedToastText("decision"), true);
      } else {
        await svc.file({ category, state: "LEARNED", text: text.trim(), source: "brain" });
        done(filedToastText(category), true);
      }
    });
    if (!ok) setSaving(false);
  };

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">File It in the Brain</div></div>
        <div className="pad-x sheet-form">
          <div className="field"><div className="input-label">Where It Belongs</div>
            <div className="chip-row">{CATS.map((c) => (
              <button key={c} type="button" className={"chip" + (category === c ? " active" : "")}
                aria-pressed={category === c} onClick={() => setCategory(c)}>{categoryLabel(c)}</button>
            ))}</div>
          </div>
          <div className="field">
            <label className="input-label">{TEXT_LABEL[category]}</label>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)}
              placeholder={TEXT_PLACEHOLDER[category]} />
          </div>
          {category === "decision" && (
            <div className="field">
              <label className="input-label">Why This Call</label>
              <input className="input" value={why} onChange={(e) => setWhy(e.target.value)}
                placeholder="e.g. Recovery Was Slipping" />
            </div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={saving || !text.trim()}
            onClick={() => void save()}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
