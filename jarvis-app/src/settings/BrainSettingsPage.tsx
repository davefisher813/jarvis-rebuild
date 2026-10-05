import { useEffect, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useBrainMemory, usePeople } from "../data/NotesProvider";
import { attemptWrite } from "../shared/guard";
import { showToast, hideToast } from "../shared/toast";
import { saveTextFile } from "../shared/saveTextFile";
import { writeTriageCursor } from "../brain/manual/triage";
import { Head, Card, Row, Foot } from "./kit";

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
  // The armed step relaxes by itself after four seconds, like every other two-tap in Settings, so a half-finished erase
  // never waits for a stray tap. Arming also clears a stale receipt ("Brain Exported") off the screen, so the confirm is
  // the only thing talking.
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

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
      if (sent) showToast({ message: "Brain Exported" });
    });
    setBusy(false);
    if (!ok) return;
  };

  // RETRY-SAFE (Dave 2026-09-28): every row is tried, a failure never stops
  // the rest, and anything left standing is counted and said out loud. The
  // erase re-reads what is left each time, so tapping it again finishes the
  // job instead of starting over. Only contacts that carry triage fields are
  // written, and their triage state is cleared rather than set, so a person
  // added by hand reads as sorted again and an import as unsorted.
  const doErase = async () => {
    if (busy) return;
    setBusy(true);
    let left = 0;
    const ok = await attemptWrite(async () => {
      const brain = await brainSvc.removeAll();
      left += brain.failed;
      const all = await peopleSvc.list();
      for (const p of all) {
        const roles = p.data.roles ?? [];
        const areaRoles = roles.filter((r) => typeof r !== "string");
        const hasTriage = areaRoles.length !== roles.length || p.data.roleNote != null || p.data.triageState !== undefined;
        if (!hasTriage) continue;
        // Triage strings go; the person sheet's per-area roles stay.
        try {
          await peopleSvc.update(p.id, {
            roles: areaRoles.length ? areaRoles : undefined,
            roleNote: undefined,
            triageState: undefined,
          });
        } catch { left++; }
      }
      writeTriageCursor(null);
    });
    setBusy(false);
    setArmed(false);
    if (!ok) return;
    if (left > 0) { showToast({ message: `Erase Stopped Short · ${left} Left · Erase Again to Finish` }); return; }
    showToast({ message: "Brain Erased" });
  };

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Brain" back="Settings" onBack={onBack} />

      <Head label="Your Data" />
      <Card>
        <Row label="Export My Brain" meta="Every Filed Row, as JSON" chev
          onClick={() => void doExport()} />
      </Card>

      {/* THE ACTION IS THE HEAD'S (Dave 2026-10-05, locked: an action never sits alone in a box). The card that held only Erase
          Brain Data is gone; the head carries the one capsule in the system red, the tap-again confirm after it is solid red with a
          Cancel beside it, and the notes below say exactly what goes and what stays. */}
      <Head label="Danger Zone"
        actions={armed
          ? [{ label: "Cancel", onClick: () => setArmed(false), disabled: busy }, { label: "Erase Now", tone: "armed", onClick: () => void doErase(), disabled: busy }]
          : [{ label: "Erase Brain Data", tone: "danger", onClick: () => { hideToast(); setArmed(true); }, disabled: busy }]} />
      {/* Two plain notes, sentence case (field notes), no dot typed between them. */}
      <Foot>Decisions, principles, values, writing samples and facts are deleted</Foot>
      <Foot>Contacts stay, but their roles go back to Unsorted</Foot>
    </div>
  );
}
