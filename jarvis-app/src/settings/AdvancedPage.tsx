import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useChat, useSettings } from "../data/NotesProvider";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { clearLocalData } from "./clearLocalData";
import { Head, Card, Row, DangerRow, Foot, Switch } from "./kit";
import { readDoneClearing, type DoneClearing } from "../bigger/doneClearing";
import { SETTING_DONE_CLEARING } from "../data/SettingsService";

export default function AdvancedPage({ onBack, onExport }: { onBack: () => void; onExport?: () => void }) {
  const chat = useChat();
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
  const [confirm, setConfirm] = useState(false);
  const [chatArmed, setChatArmed] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const deleteChat = async () => {
    if (chatBusy) return;
    setChatBusy(true);
    setChatArmed(false);
    const ok = await attemptWrite(async () => {
      const n = await chat.clearAll();
      showToast({ message: n === 0 ? "No chat history" : `Deleted ${n} ${n === 1 ? "message" : "messages"}` });
    });
    if (!ok) showToast({ message: "Couldn't delete · Try again" });
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
      <Head label="Data" />
      <Card>
        <Row label="Export Data" value="JSON" onClick={onExport} />
        {/* Which commit this build came from. Exists so "is my phone on the
            new build?" is a ten-second look instead of a debugging session:
            that question has now been guessed at twice and guessed wrong. */}
        <Row label="Build" value={typeof __BUILD_ID__ === "string" ? __BUILD_ID__ + " · " + __BUILD_DATE__ : "dev"} />
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
