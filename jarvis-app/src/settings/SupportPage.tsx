import { useEffect, useState } from "react";
import LegalScreen from "./LegalScreen";
import LegalBody from "../legal/Body";
import { SUPPORT } from "../legal/content";
import FeedbackSheet from "./FeedbackSheet";
import { useAccessToken, useOptionalProfile } from "../data/NotesProvider";


// UP-LAUNCH-05 (2026-09-05): one source, in src/legal/content.ts, rendered
// here and generated into public/support.html. The support address lives
// there too, so the app and the published page cannot give out different
// ones.
//
// UP-LAUNCH-16 (2026-09-05): and a button, because "email us" is a channel a
// tester on a phone will not use. Send Feedback is under the text rather than
// above it, so the two Common Fixes that solve most of it get read first.
export default function SupportPage({ onBack, back }: { onBack: () => void; back?: string }) {
  const [open, setOpen] = useState(false);
  const token = useAccessToken();
  // The template only labels the message, so it is read optionally and an
  // empty one is fine: a support screen must never fail to open because a
  // profile did not load.
  const profileSvc = useOptionalProfile();
  const [template, setTemplate] = useState("");
  useEffect(() => {
    let on = true;
    void profileSvc?.get().then((p) => { if (on && p?.template) setTemplate(p.template); }, () => { /* label only */ });
    return () => { on = false; };
  }, [profileSvc]);
  const build = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
  return (
    <LegalScreen title={SUPPORT.title} onBack={onBack} back={back}>
      <LegalBody doc={SUPPORT} />
      <p>
        <button className="btn btn-primary btn-block" onClick={() => setOpen(true)}>Send Feedback</button>
      </p>
      {open && (
        <FeedbackSheet
          token={token}
          build={build}
          template={template}
          onClose={() => setOpen(false)}
        />
      )}
    </LegalScreen>
  );
}
