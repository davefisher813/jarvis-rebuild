import { Fragment, useCallback, useEffect, useState } from "react";
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
import { fetchLatestBuild, readDevice, readoutLines, readoutText, type DeviceReading, type LatestBuild } from "../shared/deviceCheck";
import { runningBundle } from "../shared/buildCheck";

// THE UNIFIED SUBSTRATE'S OWN READINESS (docs/jarvis-unified, slice 01). The
// one place the app says whether migration 0044 has been run and which
// destinations a card could save to. It never says ready on a guess: a
// missing function, a failed ask or an unregistered kind all read Not Ready.
const CAPTURE_LABEL: Record<CaptureKind, string> = {
  bill: "Bills to Money", receipt: "Receipts to Money", task: "Tasks", event: "Schedule", waiting: "Waiting",
};

// THE LAYER OUTLINES (issue 110, 2026-10-18). One switch draws a hairline round the shell, the scroll area, the page bar and
// the tab bar (styles/components.css, html[data-outline-layers]), so a screenshot of Life or any other page shows where each
// layer actually sits on THIS phone. It lives on the document, not in storage: closing the app puts it away.
const OUTLINE_ATTR = "data-outline-layers";

export default function AdvancedPage({ onBack, onLearningLab }: { onBack: () => void; onLearningLab?: () => void }) {
  const chat = useChat();
  // THIS DEVICE (issue 110): what build this copy is and what the screen measures, read from the phone itself.
  const stamp = { id: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev", date: typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "" };
  const bundle = runningBundle(import.meta.url);
  const [reading, setReading] = useState<DeviceReading>(() => readDevice(bundle));
  const [latest, setLatest] = useState<LatestBuild | null | "checking">("checking");
  const [outline, setOutline] = useState(() => document.documentElement.hasAttribute(OUTLINE_ATTR));
  const measure = useCallback(() => setReading(readDevice(bundle)), [bundle]);
  const askLatest = useCallback(() => { setLatest("checking"); void fetchLatestBuild().then(setLatest); }, []);
  useEffect(() => {
    measure();
    askLatest();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); };
  }, [measure, askLatest]);
  const lines = readoutLines(reading, stamp, latest);
  const toggleOutline = () => {
    const root = document.documentElement;
    if (root.hasAttribute(OUTLINE_ATTR)) root.removeAttribute(OUTLINE_ATTR); else root.setAttribute(OUTLINE_ATTR, "");
    setOutline(root.hasAttribute(OUTLINE_ATTR));
    measure();
  };
  const copyReadout = () => {
    const text = readoutText(lines);
    const done = navigator.clipboard?.writeText(text);
    if (!done) { showToast({ message: "Couldn't Copy" }); return; }
    done.then(() => showToast({ message: "Readout Copied" })).catch(() => showToast({ message: "Couldn't Copy" }));
  };
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
      showToast({ message: n === 0 ? "No Chat History" : `Deleted ${n} ${n === 1 ? "Message" : "Messages"}` });
    });
    if (!ok) showToast({ message: "Couldn't Delete · Try Again" });
    setChatBusy(false);
  };
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Advanced" back="Settings" onBack={onBack} />
      <Head label="This Device" actions={[
        { label: "Copy", onClick: copyReadout },
        { label: "Measure", onClick: () => { measure(); askLatest(); } },
      ]} />
      <Card>
        {lines.map((l) => (
          <Row key={l.label} label={l.label} value={<>{l.parts.map((p, i) => <Fragment key={i}>{i > 0 ? " " : ""}<span className="fact">{p}</span></Fragment>)}</>} />
        ))}
        <Switch label="Outline the Layers"
          meta="Shell Red, Scroll Green, Page Bar Blue, Tab Bar Amber"
          on={outline}
          onToggle={toggleOutline} />
      </Card>
      <Head label="Projects and Goals" />
      <Card>
        <Switch label="Clear Done Automatically"
          meta="Off, a Finished Project or Goal Waits for You to Close It"
          on={doneClearing === "auto"}
          onToggle={() => setClearing(doneClearing === "auto" ? "ask" : "auto")} />
      </Card>
      <Head label="Tasks From Email" />
      <Card>
        <Switch label="Add to Your Task List"
          meta="Off, They Wait Under From Email in Tasks"
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
        <Row label="Build" value={typeof __BUILD_ID__ === "string" ? <><span className="fact">{__BUILD_ID__}</span>{" "}<span className="fact date">{__BUILD_DATE__}</span></> : "dev"} />
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
