import { useState } from "react";
import { FormSheet, Group, TextRow, SwitchRow, ErrorLine, Note } from "../shared/FormSheet";
import { MessageSquare } from "../shared/icons";
import { lastErrorText } from "../monitoring/monitor";
import { apiUrl } from "../shared/apiBase";
import { showToast } from "../shared/toast";
import { sendFeedback, tooLong, FEEDBACK_MESSAGE, type SendResult } from "./feedback";

// UP-LAUNCH-16 (2026-09-05): one box, one switch, Send.
//
// No shake gesture, no floating widget, no chat bubble. A tester who wants to
// tell us something opens Settings, Support and finds a button, which is
// where they already are when the app has just annoyed them.
//
// "Include the last error" is only offered when there IS one, because a
// switch that attaches nothing is a switch that teaches people the app is
// lying to them. What it attaches is the newest entry of the in-memory ring
// in monitoring/monitor.ts: message and stack, already scrubbed.
export default function FeedbackSheet({ token, build, template, onClose }: {
  token: string | undefined;
  build: string;
  template: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(true);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<Exclude<SendResult, "sent"> | null>(null);
  // Read once, when the sheet opens: a crash that happens while somebody is
  // typing about a different crash should not swap the attachment under them.
  const [crash] = useState<string | null>(() => lastErrorText());

  const long = tooLong(text);
  const valid = text.trim().length > 0 && !long;

  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    setFailed(null);
    const device = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const r = await sendFeedback(
      { text, build, device, template, lastError: attach ? crash : null },
      token,
      apiUrl("/api/feedback"),
    );
    if (r === "sent") {
      // The toast fires after the write resolved, never before.
      showToast({ message: "Feedback sent · Thank you" });
      onClose();
      return;
    }
    setSending(false);
    setFailed(r);
  };

  return (
    <FormSheet
      title="Send Feedback"
      onCancel={onClose}
      onSave={() => { void send(); }}
      saveDisabled={!valid}
      saveLabel={sending ? "Sending" : "Send"}
      dirty={text.trim().length > 0}
    >
      <Group label="What Happened">
        <TextRow value={text} onChange={setText} rows={6} ariaLabel="Your feedback"
          placeholder="e.g. The gym timer keeps running when I leave the screen" />
      </Group>
      <ErrorLine text={long ? FEEDBACK_MESSAGE["too-long"] : failed ? FEEDBACK_MESSAGE[failed] : null} />
      {crash && (
        <Group label="Attach">
          <SwitchRow tone="red" glyph={<MessageSquare className="ic" />} label="Include the Last Error"
            meta="The newest crash, with no text you wrote" on={attach} onToggle={() => setAttach((v) => !v)}
            ariaLabel="Include the last error" />
        </Group>
      )}
      <Note>This goes straight to the person who builds JARVIS. It carries the build number and the kind of device, and nothing else from your account.</Note>
    </FormSheet>
  );
}
