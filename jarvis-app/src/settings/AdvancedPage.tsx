import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useBackup, useChat, useSettings } from "../data/NotesProvider";
import { runBackupExport } from "../backup/runExport";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { clearLocalData } from "./clearLocalData";
import { Head, Card, Row, DangerRow, Foot, Switch } from "./kit";
import { readDoneClearing, type DoneClearing } from "../bigger/doneClearing";
import { SETTING_DONE_CLEARING, SETTING_EMAIL_TASKS } from "../data/SettingsService";
import { readEmailTaskHome, type EmailTaskHome } from "../tasks/emailTasks";
import { useSubstrateReadiness } from "../substrate/useReadiness";
import { flagsOn } from "../substrate/flags";
import { CAPTURE_KINDS, type CaptureKind } from "../substrate/contracts";

// THE UNIFIED SUBSTRATE'S OWN READINESS (docs/jarvis-unified, slice 01). The
// one place the app says whether migration 0044 has been run and which
// destinations a card could save to. It never says ready on a guess: a
// missing function, a failed ask or an unregistered kind all read Not Ready.
const CAPTURE_LABEL: Record<CaptureKind, string> = {
  bill: "Bills to Money", receipt: "Receipts to Money", task: "Tasks", event: "Schedule", waiting: "Waiting",
};

export default function AdvancedPage({ onBack, onLearningLab }: { onBack: () => void; onLearningLab?: () => void }) {
  const chat = useChat();
  const backup = useBackup();
  // Export Data exports (slice 09 QA, 2026-10-04: it opened the Backup page). The same file Backup makes, the same
  // honest answer: a count when the file left the app, nothing when the share sheet was dismissed.
  const [exporting, setExporting] = useState(false);
  const exportNow = async () => {
    if (exporting) return;
    setExporting(true);
    const r = await runBackupExport(backup);
    setExporting(false);
    if (r.kind === "sent") showToast({ message: `Exported ${r.count} ${r.count === 1 ? "Item" : "Items"}` });
    else if (r.kind === "failed") showToast({ message: "Export Failed · Try Again" });
  };
  const settings = useSettings();
  // WHO SAYS A THING IS DONE (Dave 2026-09-12: "the user should be able to
  // decide if it automatically clears or needs permission"). Off is Ask First,
  // which is the 2026-09-09 ruling and the default; on hands the decision back
  // to the arithmetic. One switch, because there are only two answers, and it
  // covers projects and goals together: they are the same question.
  const [doneClearing, setDoneClearing] = useState<DoneClearing>(() => readDoneClearing());
  const setClearing = (next: DoneClearing) => {
    setDoneClearing(next);
    void settings?.set(SETTING_DONE_CLEARING, next);
  };
  // WHERE A TASK MADE FROM AN EMAIL GOES (Dave 2026-09-13: "it should be an
  // option but not default"). Off keeps them under From Email.
  const [emailHome, setEmailHomeState] = useState<EmailTaskHome>(() => readEmailTaskHome());
  const setEmailHome = (next: EmailTaskHome) => {
    setEmailHomeState(next);
    void settings?.set(SETTING_EMAIL_TASKS, next);
  };
  // THE UNIFIED SUBSTRATE'S OWN ROWS SHOW ONLY WHEN A FLAG IS ON (slice 09, the
  // pre-merge review): with every flag off this screen is exactly what it was,
  // and no readiness call is made for a section nobody sees.
  const flags = flagsOn();
  const readiness = useSubstrateReadiness(flags.length > 0);
  const [confirm, setConfirm] = useState(false);
  const [chatArmed, setChatArmed] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const deleteChat = async () => {
    if (chatBusy) return;
    setChatBusy(true);
    setChatArmed(false);
    const ok = await attemptWrite(async () => {
      const n = await chat.clearAll();
      showToast({ message: n === 0 ? "No Chat History" : `Deleted ${n} ${n === 1 ? "message" : "messages"}` });
    });
    if (!ok) showToast({ message: "Couldn't Delete · Try Again" });
    setChatBusy(false);
  };
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Advanced" back="Settings" onBack={onBack} />
      <Head label="Projects and Goals" />
      <Card>
        <Switch label="Clear Done Automatically"
          meta="Off, a finished project or goal waits for you to close it"
          on={doneClearing === "auto"}
          onToggle={() => setClearing(doneClearing === "auto" ? "ask" : "auto")} />
      </Card>
      <Head label="Tasks From Email" />
      <Card>
        <Switch label="Add to Your Task List"
          meta="Off, they wait under From Email in Tasks"
          on={emailHome === "list"}
          onToggle={() => setEmailHome(emailHome === "list" ? "email" : "list")} />
      </Card>
      {/* C-39 (Astra, 2026-09-12): the numbers behind each detector moved
          here from What JARVIS Knows, which now says one word per row. */}
      <Head label="Brain" />
      <Card>
        <Row label="Learning Lab" chev onClick={onLearningLab} />
      </Card>
      {flags.length > 0 && (<>
      <Head label="Unified Substrate" />
      <Card>
        <Row label="Database" value={!readiness ? "Checking" : readiness.migration === "applied" ? "Migration 0044 Applied" : readiness.migration === "missing" ? "Migration 0044 Not Applied" : "Couldn't Check"} />
        {CAPTURE_KINDS.map((k) => <Row key={k} label={CAPTURE_LABEL[k]} value={readiness?.kinds[k].state === "ready" ? "Ready" : "Not Ready"} />)}
        <Row label="Flags" value={flags.join(", ")} />
      </Card>
      </>)}
      <Head label="Data" />
      <Card>
        <Row label="Export Data" value={exporting ? "Exporting" : "JSON"} onClick={() => void exportNow()} disabled={exporting} />
        {/* Which commit this build came from. Exists so "is my phone on the
            new build?" is a ten-second look instead of a debugging session:
            that question has now been guessed at twice and guessed wrong. */}
        <Row label="Build" value={typeof __BUILD_ID__ === "string" ? <><span className="fact">{__BUILD_ID__}</span><span className="fact date">{__BUILD_DATE__}</span></> : "dev"} />
      </Card>
      <div className="set-gap"><Card>
        {!chatArmed
          ? <DangerRow label="Delete Chat History" onClick={() => setChatArmed(true)} disabled={chatBusy} />
          : <DangerRow label="Tap Again to Confirm" onClick={() => void deleteChat()} />}
      </Card></div>
      <div className="set-gap"><Card>
        {!confirm
          ? <DangerRow label="Clear Local Data" onClick={() => setConfirm(true)} />
          : <DangerRow label="Tap Again to Confirm" onClick={() => { clearLocalData(); location.reload(); }} />}
      </Card></div>
      <Foot><span className="slip-warn">This device only · No undo</span></Foot>
      <div className="screen-foot" />
    </div>
  );
}
