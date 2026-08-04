import { useCallback, useEffect, useRef, useState } from "react";
import type { AIService } from "../ai/AIService";
import type { GoogleApi } from "../connections/google/api";
import { mapThreadFull, buildReply, encodeEmail, type ThreadRow, type ThreadFull } from "../connections/google/map";
import { useTasks, useSchedule, usePeople } from "../data/NotesProvider";
import { emit } from "../events";
import { buildPlanPrompt, parseDeckPlan, primaryLabel, laterTaskTitle, type DeckPlan, type VoiceProfile } from "./deck";
import { voiceExamplesFor } from "./voiceExamples";
import { showToast } from "../shared/toast";

// The Deal With It deck (email 2): one email at a time, the decision already
// prepared — a reply in the user's voice, a bill for Money, a slot for the
// Schedule, or a task. One tap closes the loop and advances. "Later" files a
// real task pointing back at the email, so deferring never means losing.
// Nothing sends, files, or schedules without the tap.
export default function DeckFlow({ ai, api, threads, onDone, onExit, onOpenThread, onEditReply, onHandled }: {
  ai: AIService;
  api: GoogleApi;
  threads: ThreadRow[];
  onDone: (handled: number, ms: number) => void;
  onExit: () => void;
  onOpenThread: (id: string) => void;
  onEditReply: (thread: ThreadFull, body: string) => void;
  onHandled: (threadId: string, archived: boolean) => void;
  }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const people = usePeople();
  const [idx, setIdx] = useState(0);
  const [thread, setThread] = useState<ThreadFull | null>(null);
  const [plan, setPlan] = useState<DeckPlan | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [busy, setBusy] = useState(false);
  const handled = useRef(0);
  const started = useRef(Date.now());
  const row = threads[idx];

  const prepare = useCallback(async (r: ThreadRow) => {
    setPreparing(true);
    setThread(null);
    setPlan(null);
    try {
      const full = mapThreadFull(await api.getThread(r.id));
      if (full.messages.length === 0) throw new Error("empty");
      setThread(full);
      if (!ai.available) return; // honest degrade: read + reply, no prepared plan
      const person = (await people.list()).find(
        (p) => (p.data.email || "").toLowerCase() === r.fromEmail.toLowerCase(),
      );
      const voice: VoiceProfile = {
        register: person?.data.register,
        flagged: person?.data.flagged,
        examples: await voiceExamplesFor(api, r.fromEmail, Date.now()),
      };
      const today = new Date().toISOString().slice(0, 10);
      const { system, user } = buildPlanPrompt(full, voice, today);
      const raw = await ai.complete([{ role: "user", content: user }], system, { tier: "write" });
      setPlan(parseDeckPlan(raw)); // null = honest fallback, card still works
    } catch {
      setPlan(null);
    } finally {
      setPreparing(false);
    }
  }, [ai, api, people]);

  useEffect(() => {
    if (row) void prepare(row);
  }, [row, prepare]);

  const advance = (archivedRow: boolean) => {
    if (row) onHandled(row.id, archivedRow);
    handled.current += 1;
    if (idx + 1 >= threads.length) {
      onDone(handled.current, Date.now() - started.current);
    } else {
      setIdx(idx + 1);
    }
  };

  const archiveRemote = (id: string) => {
    api.modifyThread(id, [], ["INBOX", "UNREAD"]).catch(() => {});
  };

  const runPrimary = async () => {
    if (!row || !thread || busy) return;
    if (!plan) { onOpenThread(row.id); return; }
    setBusy(true);
    try {
      if (plan.kind === "reply" && plan.reply) {
        const last = thread.messages[thread.messages.length - 1]!;
        const r = buildReply(last, plan.reply);
        await api.sendMessage(encodeEmail({ to: r.to, subject: r.subject, body: plan.reply, inReplyTo: r.inReplyTo }), r.threadId);
        archiveRemote(row.id);
        // The honest voice metric: sent exactly as drafted (edited sends are
        // logged from the compose path with edited: true).
        emit({ type: "action", props: { name: "email.deck.sent", edited: false } });
        showToast({ message: "Sent" });
      } else if (plan.kind === "bill" && plan.bill) {
        await tasks.createTask("Pay " + plan.bill.name, {
          due: plan.bill.due ?? null,
          bill: { amount: plan.bill.amount },
        });
        archiveRemote(row.id);
        showToast({ message: "Bill added to Money" });
      } else if (plan.kind === "event" && plan.event) {
        await schedule.createEvent(plan.event.title, {
          date: plan.event.date,
          start: plan.event.start,
          end: plan.event.end,
        });
        archiveRemote(row.id);
        showToast({ message: "On the schedule" });
      } else if (plan.kind === "task" && plan.task) {
        await tasks.createTask(plan.task.title, { due: plan.task.due ?? null });
        archiveRemote(row.id);
        showToast({ message: "Task added" });
      } else {
        archiveRemote(row.id);
      }
      emit({ type: "action", props: { name: "email.deck.handled", kind: plan.kind } });
      advance(true);
    } catch (e) {
      showToast({ message: (e as Error).message || "That didn't go through. Nothing was lost." });
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    if (!row || busy) return;
    setBusy(true);
    try {
      await tasks.createTask(laterTaskTitle(row.from, row.subject), { due: new Date().toISOString().slice(0, 10) });
      emit({ type: "action", props: { name: "email.deck.later" } });
      advance(false); // stays in the inbox: the task is the reminder, the mail is the evidence
    } finally {
      setBusy(false);
    }
  };

  const archive = () => {
    if (!row || busy) return;
    archiveRemote(row.id);
    emit({ type: "action", props: { name: "email.deck.handled", kind: "archive" } });
    advance(true);
  };

  if (!row) return null;

  return (
    <div className="screen" key={"deck" + row.id}>
      <div className="nav-bar">
        <button className="nav-back" onClick={onExit}>Email</button>
        <span className="nav-title">{idx + 1} of {threads.length}</span>
        <span className="nav-act"></span>
      </div>
      <div className="pad-x">
        <div className="card pad deck-card">
          <div className="msg-detail-subj">{row.from}</div>
          <div className="conn-meta truncate">{row.subject}</div>
          <div className="deck-why">{plan?.why || row.snippet}</div>

          {preparing ? (
            <div className="conn-status">Preparing...</div>
          ) : plan?.kind === "reply" && plan.reply ? (
            <div className="deck-prep">
              <div className="eyebrow">Reply ready · your voice</div>
              <div className="deck-prep-text">{plan.reply}</div>
            </div>
          ) : plan?.kind === "bill" && plan.bill ? (
            <div className="deck-prep">
              <div className="eyebrow">Bill prepped for Money</div>
              <div className="deck-prep-text">{plan.bill.name} · ${plan.bill.amount}{plan.bill.due ? " · due " + plan.bill.due : ""}</div>
            </div>
          ) : plan?.kind === "event" && plan.event ? (
            <div className="deck-prep">
              <div className="eyebrow">Ready for the Schedule</div>
              <div className="deck-prep-text">{plan.event.title} · {plan.event.date} at {plan.event.start}</div>
            </div>
          ) : plan?.kind === "task" && plan.task ? (
            <div className="deck-prep">
              <div className="eyebrow">Task prepped</div>
              <div className="deck-prep-text">{plan.task.title}{plan.task.due ? " · due " + plan.task.due : ""}</div>
            </div>
          ) : null}

          <div className="deck-actions">
            <button className="btn btn-primary btn-block" disabled={preparing || busy} onClick={() => void runPrimary()}>
              {preparing ? "..." : plan ? primaryLabel(plan) : "Open & Reply"}
            </button>
            <div className="deck-secondary">
              {plan?.kind === "reply" && plan.reply && thread && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => onEditReply(thread, plan.reply!)}>Edit</button>
              )}
              <button className="btn btn-secondary" disabled={busy} onClick={() => onOpenThread(row.id)}>Open</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => void later()}>Later</button>
              <button className="btn btn-secondary" disabled={busy} onClick={archive}>Archive</button>
            </div>
          </div>
        </div>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
