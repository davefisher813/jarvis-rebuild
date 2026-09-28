import { useState } from "react";
import { useBrainMemory, usePeople } from "../../data/NotesProvider";
import { attemptWrite } from "../../shared/guard";
import { showToast } from "../../shared/toast";
import { dismissSetupCard } from "./triage";

/**
 * The three-question seed behind "Set up your brain": what you do, who
 * matters most, one principle you live by. The answers seed What JARVIS
 * Knows (a fact), Contacts (a role note on the named person, creating them
 * when they are not there yet), and Philosophy, so day one is not empty.
 * Every question is skippable; the card dismisses itself once the seed
 * lands.
 */
export default function SeedSheet({
  onClose,
  onSeeded,
}: {
  onClose: () => void;
  onSeeded: () => void;
}) {
  const brainSvc = useBrainMemory();
  const peopleSvc = usePeople();
  const [work, setWork] = useState("");
  const [who, setWho] = useState("");
  const [principle, setPrinciple] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await attemptWrite(async () => {
      const w = work.trim();
      const p = who.trim();
      const ph = principle.trim();
      if (w) {
        await brainSvc.file({
          category: "fact",
          state: "LEARNED",
          text: `I am ${w}`,
          source: "brain",
        });
      }
      if (p) {
        const existing = await peopleSvc.list();
        const match = existing.find((c) => c.data.name.trim().toLowerCase() === p.toLowerCase());
        if (match) {
          if (!match.data.roleNote) await peopleSvc.update(match.id, { roleNote: "Matters most" });
        } else {
          await peopleSvc.create({
            name: p,
            group: "contacts",
            roleNote: "Matters most",
            triageState: "sorted",
            source: "manual",
          });
        }
      }
      if (ph) {
        await brainSvc.file({ category: "philosophy", state: "LEARNED", text: ph, source: "brain" });
      }
    });
    setSaving(false);
    if (!ok) return;
    dismissSetupCard();
    showToast({ message: "Brain Seeded ✓" });
    onSeeded();
    onClose();
  };

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Three Questions</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <label className="input-label">What Do You Do?</label>
            <input className="input" value={work} onChange={(e) => setWork(e.target.value)}
              placeholder="e.g. Run a Sports Facility in Stamford" />
          </div>
          <div className="field">
            <label className="input-label">Who Matters Most?</label>
            <input className="input" value={who} onChange={(e) => setWho(e.target.value)}
              placeholder="e.g. Linda Fisher" />
          </div>
          <div className="field">
            <label className="input-label">One Principle You Live By</label>
            <input className="input" value={principle} onChange={(e) => setPrinciple(e.target.value)}
              placeholder="e.g. Show Up Every Day" />
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={saving}
            onClick={() => void save()}>{saving ? "Saving..." : "Seed My Brain"}</button>
          <button className="btn btn-secondary btn-block" onClick={onClose}>Skip for Now</button>
        </div>
      </div>
    </div>
  );
}
