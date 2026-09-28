import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useBrainMemory, usePeople } from "../data/NotesProvider";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { saveTextFile } from "../shared/saveTextFile";
import { writeTriageCursor } from "../brain/manual/triage";
import { Head, Card, Row, DangerRow, Foot } from "./kit";

/**
 * Settings → Brain (Brain Manual v1). Export hands every brain_memory row
 * to the OS as JSON; Erase deletes them all and sends every contact back
 * to unsorted. An erased brain degrades cleanly: the pages read zero rows
 * and the prompt assembler falls back to DNA-only, with no errors.
 */
export default function BrainSettingsPage({ onBack }: { onBack: () => void }) {
  const brainSvc = useBrainMemory();
  const peopleSvc = usePeople();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await attemptWrite(async () => {
      const rows = await brainSvc.list();
      const day = new Date().toISOString().slice(0, 10);
      const sent = await saveTextFile(
        JSON.stringify(rows, null, 2),
        `jarvis-brain-${day}.json`,
        { title: "My Brain Export", mime: "application/json;charset=utf-8" },
      );
      if (sent) showToast({ message: "Brain Exported ✓" });
    });
    setBusy(false);
    if (!ok) return;
  };

  const doErase = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await attemptWrite(async () => {
      await brainSvc.removeAll();
      const all = await peopleSvc.list();
      for (const p of all) {
        // Triage strings go; the person sheet's per-area roles stay.
        const areaRoles = (p.data.roles ?? []).filter((r) => typeof r !== "string");
        await peopleSvc.update(p.id, {
          roles: areaRoles.length ? areaRoles : undefined,
          roleNote: null,
          triageState: "unsorted",
        });
      }
      writeTriageCursor(null);
    });
    setBusy(false);
    setArmed(false);
    if (!ok) return;
    showToast({ message: "Brain Erased ✓" });
  };

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Brain" back="Settings" onBack={onBack} />

      <Head label="Your Data" />
      <Card>
        <Row label="Export My Brain" meta="Every Filed Row, as JSON" chev
          onClick={() => void doExport()} />
      </Card>

      <Head label="Danger Zone" />
      <Card>
        {/* The tap-again confirm, same as AdvancedPage's destructive rows:
            the first tap arms, the second erases. The copy says exactly what
            goes and what stays. */}
        {armed
          ? <DangerRow label="Tap Again to Confirm the Erase" onClick={() => void doErase()} disabled={busy} />
          : <DangerRow label="Erase Brain Data" onClick={() => setArmed(true)} disabled={busy} />}
      </Card>
      <Foot>Decisions, Principles, Values, Writing Samples and Facts Are Deleted. Contacts Stay, but Their Roles Go Back to Unsorted.</Foot>
    </div>
  );
}
