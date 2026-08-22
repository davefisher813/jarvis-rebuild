import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { useChat, useTasks, useSchedule, useNotes, useCategories } from "../data/NotesProvider";
import { useAI } from "../ai/useAI";
import { useAIContext, todayISO } from "../ai/useAIContext";
import { contextToText } from "../ai/context";
import { chatSystemPrompt } from "./chatPrompt";
import { nowHHMM } from "../today/todayData";
import { answerQuestion, looksLikeQuestion, type AnswerSnapshot } from "./answers";
import { parseCommand, resolveTarget, type ChatCommand, type CommandTarget } from "./commands";
import { smartPasteSave } from "../paste/smartPaste";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import type { ChatMessage } from "./ChatService";
import type { ChatProvenance } from "./types";

// Chat (addendum item 23): one box that ANSWERS (deterministic Q&A first,
// grounded AI second, honest refusal offline), ACTS (command parser under
// the Uncertainty Protocol: one match acts with receipt and undo, several
// matches render a bounded chooser whose tap is both answer and action,
// zero is a refusal that states nothing changed), and CAPTURES (everything
// else rides the Smart Paste pipeline: instant save, provenance, receipt).
// Drafting yes, sending never. File routing is the flagged follow-up.

const SEND = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
);

interface PendingChoice {
  command: ChatCommand;
  options: CommandTarget[];
}

export default function ChatFlow() {
  const chat = useChat();
  const tasksSvc = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const catsSvc = useCategories();
  const ai = useAI();
  const gather = useAIContext();

  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<PendingChoice | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => setMsgs(await chat.list()), [chat]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length, choice]);

  const say = async (role: "user" | "jarvis", text: string, provenance?: ChatProvenance) => {
    await chat.append({ role, text, ...(provenance ? { provenance } : {}) });
    await reload();
  };

  const snapshot = async (): Promise<AnswerSnapshot> => {
    const today = todayISO();
    const [evs, tks] = await Promise.all([schedule.listEvents(), tasksSvc.listTasks()]);
    // Money answers ride the AI path for now; the money layer's derived line
    // gets wired here in the files-and-money chat pass.
    const left: string | null = null;
    return {
      today,
      nowHHMM: nowHHMM(new Date()),
      events: evs.map((e) => ({ id: e.id, title: e.data.title, date: e.data.date, start: e.data.start, location: e.data.location })),
      tasks: tks.map((t) => ({ id: t.id, text: t.data.text, due: t.data.due, done: t.data.done })),
      leftToSpend: left,
    };
  };

  const runCommand = async (cmd: ChatCommand, target: CommandTarget) => {
    if (cmd.kind === "complete") {
      const ok = await attemptWrite(() => tasksSvc.toggleDone(target.id));
      if (!ok) return;
      await say("jarvis", `Done: ${target.text}`, { kind: "action", refs: [{ kind: "task", id: target.id, label: target.text }] });
      showToast({ message: "Task completed", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasksSvc.toggleDone(target.id)); } });
    } else if (cmd.kind === "reschedule") {
      const today = todayISO();
      const when = cmd.when === "today" ? today : new Date(Date.parse(today + "T12:00:00") + 86400000).toISOString().slice(0, 10);
      const prior = (await tasksSvc.task(target.id))?.due ?? null;
      const ok = await attemptWrite(() => tasksSvc.setDue(target.id, when));
      if (!ok) return;
      await say("jarvis", `Moved to ${cmd.when}: ${target.text}`, { kind: "action", refs: [{ kind: "task", id: target.id, label: target.text }] });
      showToast({ message: `Moved to ${cmd.when}`, actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasksSvc.setDue(target.id, prior)); } });
    } else {
      const snapshotTask = await tasksSvc.task(target.id);
      const ok = await attemptWrite(() => tasksSvc.deleteTask(target.id));
      if (!ok) return;
      await say("jarvis", `Deleted: ${target.text}`, { kind: "action", refs: [{ kind: "task", id: target.id, label: target.text }] });
      showToast({
        message: "Task deleted",
        actionLabel: "Undo",
        onAction: async () => {
          if (snapshotTask) await attemptWrite(() => tasksSvc.createTask(snapshotTask.text, { category: snapshotTask.category, due: snapshotTask.due ?? null }));
        },
      });
    }
  };

  const pickChoice = async (target: CommandTarget) => {
    if (!choice) return;
    const cmd = choice.command;
    setChoice(null);
    await runCommand(cmd, target);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    try {
      await say("user", text);

      // 1. Commands, before any AI call (cost guard).
      const cmd = parseCommand(text);
      if (cmd) {
        const open = (await tasksSvc.listTasks()).filter((t) => !t.data.done).map((t) => ({ id: t.id, text: t.data.text }));
        const res = resolveTarget(open, cmd.query);
        if (res.kind === "one") await runCommand(cmd, res.target);
        else if (res.kind === "choose") {
          await say("jarvis", "Which one?", { kind: "records" });
          setChoice({ command: cmd, options: res.options });
        } else {
          await say("jarvis", `Nothing matching "${cmd.query}" · Nothing changed`, { kind: "records" });
        }
        return;
      }

      // 2. Deterministic Q&A, still before any AI call.
      if (looksLikeQuestion(text)) {
        const ans = answerQuestion(text, await snapshot());
        if (ans) { await say("jarvis", ans.text, ans.provenance); return; }
        // 3. Grounded AI for the questions the rules cannot read.
        if (!ai.available) {
          await say("jarvis", "I can answer that when you're back online", { kind: "records" });
          return;
        }
        try {
          const ctx = await gather();
          const raw = await ai.complete(
            [{ role: "user", content: text }],
            chatSystemPrompt(contextToText(ctx)),
            { kind: "chat", background: false },
          );
          await say("jarvis", raw.trim(), { kind: "ai" });
        } catch {
          await say("jarvis", "Couldn't reach the AI · Try again", { kind: "records" });
        }
        return;
      }

      // 4. Everything else is a capture: the Smart Paste pipeline, verbatim.
      const cats = await catsSvc.list().catch(() => []);
      let saved: Awaited<ReturnType<typeof smartPasteSave>> = [];
      const ok = await attemptWrite(async () => {
        saved = await smartPasteSave(text, { ai, gather, tasks: tasksSvc, schedule, notes, categories: cats, today: todayISO() });
      });
      if (!ok) return;
      if (saved.length === 0) {
        await say("jarvis", "Nothing to save in that", { kind: "records" });
        return;
      }
      const first = saved[0]!;
      await say(
        "jarvis",
        saved.length === 1 ? `Saved: ${first.title}` : `Saved ${saved.length} items`,
        { kind: "action", refs: saved.map((s) => ({ kind: s.kind, id: s.id, label: s.title })) },
      );
    } finally {
      setBusy(false);
    }
  };

  const provLine = (m: ChatMessage): string | null => {
    const p = m.data.provenance;
    if (!p) return null;
    if (p.kind === "ai") return "From your data + AI";
    if (p.kind === "action") return "Done · Undo on the toast";
    if (p.refs && p.refs.length > 0) return "From your records";
    return "From your records";
  };

  return (
    <div className="screen">
      <PageHeader title="Chat" hero={<div className="pagehead-title">JARVIS</div>} />
      <div className="chat-thread">
        {/* B4 (audit 2026-08-21): Chat opened on a blank wall with a text
            field, which asks the person with the initiation problem to think
            up the first move. Four chips, each one a thing this screen
            actually does -- ask the records, run a command, capture -- so
            nothing here promises a capability it does not have. They fill
            the field rather than sending, because a chip that fires
            immediately is a button that lies about being a suggestion. */}
        {msgs.length === 0 && (
          <div className="chat-starters">
            <div className="chat-starter-head">Try</div>
            <div className="chip-row">
              {[
                { label: "What's on today?", fill: "What's on today?" },
                { label: "What's next?", fill: "What's next?" },
                // These two teach the grammar rather than firing it: the chip
                // leaves the cursor exactly where the missing word goes.
                { label: "Complete…", fill: "Complete " },
                { label: "Move… to tomorrow", fill: "Move " },
              ].map((c) => (
                <div className="chip" role="button" tabIndex={0} key={c.label} onClick={() => setDraft(c.fill)}>{c.label}</div>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={"chat-bubble " + (m.data.role === "user" ? "chat-user" : "chat-jarvis")}>
            <div className="chat-text">{m.data.text}</div>
            {m.data.role === "jarvis" && provLine(m) && <div className="chat-prov">{provLine(m)}</div>}
          </div>
        ))}
        {choice && (
          <div className="chip-row chip-picker-open">
            {choice.options.map((o) => (
              <div key={o.id} className="chip" role="button" tabIndex={0} onClick={() => void pickChoice(o)}>{o.text}</div>
            ))}
            <div className="chip" role="button" tabIndex={0} onClick={() => setChoice(null)}>Never Mind</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="chat-inputbar">
        <input
          className="input"
          placeholder="Ask · tell · paste"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
        />
        <button className="convo-send" aria-label="Send" onClick={() => void send()} disabled={busy}>{SEND}</button>
      </div>
    </div>
  );
}
