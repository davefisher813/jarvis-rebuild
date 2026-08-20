import { useState } from "react";
import { Mail, Clock, CalendarClock, CornerUpLeft } from "lucide-react";
import NoticeCard from "./NoticeCard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import {
  loadMailSnapshot, mailNotices, residualLine, loadDismissed, dismissNotice,
  type MailKind, type MailNotice,
} from "../messages/home";

// Email on the home page, rebuilt (Dave 2026-08-20). The count is gone; what
// is left is the work itself. See messages/home.ts for the reasoning.
//
// Two of the four kinds finish HERE. Add Task writes the task and the card
// clears, no travel, no second decision. The other two open exactly the
// thread that needs him, never the inbox he would then have to search.

const ICON: Record<MailKind, React.ReactNode> = {
  deadline: <CalendarClock className="ic" />,
  reply: <CornerUpLeft className="ic" />,
  promised: <Clock className="ic" />,
  nudge: <Mail className="ic" />,
};

export default function MailNotices({
  today,
  onAddTask,
  onOpenThread,
  onOpenEmail,
  max = 3,
}: {
  today: string;
  // Returns true when the task actually landed, so the receipt never claims
  // a save that failed.
  onAddTask: (text: string, due?: string) => Promise<boolean>;
  onOpenThread?: (threadId: string) => void;
  onOpenEmail?: () => void;
  max?: number;
}) {
  const [hidden, setHidden] = useState<string[]>(() => loadDismissed(today));
  const [done, setDone] = useState<string[]>([]);
  const snap = loadMailSnapshot();
  const notices = mailNotices(snap, today, new Date(), max, [...hidden, ...done]);
  const residual = residualLine(snap, notices.map((n) => n.threadId));

  const act = (n: MailNotice) => {
    if (n.task) {
      haptics.selection();
      void (async () => {
        const ok = await onAddTask(n.task!.text, n.task!.due);
        if (!ok) return;
        setDone((d) => [...d, n.key]);
        showToast({ message: n.task?.due ? "Added to your tasks · Due " + n.task.due : "Added to your tasks" });
      })();
      return;
    }
    onOpenThread?.(n.threadId);
  };

  if (notices.length === 0 && !residual) return null;

  return (
    <>
      {notices.map((n) => (
        <NoticeCard
          key={n.key}
          icon={ICON[n.kind]}
          tone={n.tone}
          title={n.title}
          sub={n.sub}
          action={{ label: n.action, onClick: () => act(n) }}
          onDismiss={() => { haptics.selection(); setHidden(dismissNotice(n.key, today)); }}
          onOpen={onOpenThread ? () => onOpenThread(n.threadId) : undefined}
        />
      ))}
      {residual && (
        <NoticeCard
          icon={<Mail className="ic" />}
          tone="cat-fg-graphite"
          title={residual}
          sub="Nothing in there is urgent"
          onOpen={onOpenEmail}
        />
      )}
    </>
  );
}
