import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { useChat, useTasks, useSchedule, useNotes, useCategories, useOptionalStrands, usePeople, useOptionalFiles, useFileStore, useOptionalGym } from "../data/NotesProvider";
import { useOptionalGoogle } from "../connections/google/GoogleSession";
import { lastContactFor } from "../people/lastContact";
import { askSaid } from "../messages/saidWhat";
import { fullThreadsFor, SENT_BODY_CAP } from "../messages/sentBodies";
import { cleanBody } from "../messages/bodyText";
import { namePatterns } from "../people/mentions";
import { usePickFile, PICK_ANY } from "../shared/usePickFile";
import { routeFile, parseRouteAnswer, ROUTE_PROMPT, DESTINATION_LABEL, isPdf, type FileDestination } from "../files/route";
import { fileStem, sizeLabel } from "../files/types";
import { buildVisionMessage } from "../ai/AIService";
import { encodeImageForVision } from "../shared/imageEncode";
import { getAIControl } from "../ai/levelStore";
import { effectiveLevel } from "../ai/aiGate";
import ScheduleUploadFlow from "../schedule/screens/ScheduleUploadFlow";
import GymUploadFlow from "../gym/UploadFlow";
import { useAI } from "../ai/useAI";
import { useAIContext, todayISO } from "../ai/useAIContext";
import { contextToText } from "../ai/context";
import { chatSystemPrompt } from "./chatPrompt";
import { nowHHMM } from "../today/todayData";
import { addDays } from "../schedule/calendar";
import { answerQuestion, looksLikeQuestion, rewriteFollowUp, type AnswerSnapshot, type Prior } from "./answers";
// S6-Q42 (2026-09-05): the same needs-you snapshot the Email tab and Today
// already read -- a synchronous cache read, no network, no AI call.
import { loadMailSnapshot } from "../messages/home";
import { parseCommand, resolveTarget, type ChatCommand, type CommandTarget } from "./commands";
import { smartPasteSave, undoSaved } from "../paste/smartPaste";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import type { ChatMessage } from "./ChatService";
import type { ChatProvenance } from "./types";
import type { EventItem } from "../schedule/types";
import type { SheetCategory } from "../tasks/screens/TaskSheet";
import { emit } from "../events";
import { putComposeDraft } from "./composeDraft";
import { draftSystemPrompt } from "../people/messageDraft";
import { voiceToText } from "../ai/context";
import MessageDraftSheet from "../people/MessageDraftSheet";
import type { Person } from "../people/types";

// Chat (addendum item 23): one box that ANSWERS (deterministic Q&A first,
// grounded AI second, honest refusal offline), ACTS (command parser under
// the Uncertainty Protocol: one match acts with receipt and undo, several
// matches render a bounded chooser whose tap is both answer and action,
// zero is a refusal that states nothing changed), and CAPTURES (everything
// else rides the Smart Paste pipeline: instant save, provenance, receipt).
// Drafting yes, sending never.
//
// UP-PLAT-08 (2026-09-06), A23: and it takes FILES. A photo of a receipt
// files to Money, a season schedule PDF goes through the schedule
// distillation, a whiteboard workout to the gym uploader, anything else to a
// new note. Deterministic first (files/route.ts), one vision call only when
// the file says nothing about itself and the master AI level allows it, and
// the receipt bubble names where it went with refile chips and an Undo, which
// is Smart Paste's anatomy applied to bytes.

// The paperclip. Same 24px stroke grammar as SEND below it.
const CLIP = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
);

const SEND = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
);

// UP-MIND-04 (2026-09-05): the last six stored messages as alternating
// turns, ending with what was just typed. Trimmed from the FRONT, so the
// most recent turns are the ones that survive the cap, and forced to start
// on a user turn because a conversation that opens with an assistant reply
// is not one.
const HISTORY_TURNS = 6;
const HISTORY_CHARS = 6000;

export function recentTurns(
  stored: { data: { role: "user" | "jarvis"; text: string } }[],
  latest: string,
): { role: "user" | "assistant"; content: string }[] {
  const prior = stored
    .slice(0, -1) // the message just stored is `latest`, added below
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.data.role === "user" ? "user" as const : "assistant" as const, content: m.data.text }));
  while (prior.length && (prior[0]!.role !== "user" || prior.reduce((n, t) => n + t.content.length, 0) > HISTORY_CHARS)) {
    prior.shift();
  }
  return [...prior, { role: "user" as const, content: latest }];
}

interface PendingChoice {
  // A command that matched more than one task (the Uncertainty Protocol).
  command?: ChatCommand;
  // UP-MIND-03 (2026-09-05): a QUESTION that named more than one person.
  // Same bounded chooser, same tap, so ambiguity is a question back rather
  // than a confident answer about the wrong Marco.
  question?: string;
  options: CommandTarget[];
}

export default function ChatFlow({ onOpen, onCompose, askPersonId, askNonce, onAskConsumed }: {
  // UP-MIND-02 (2026-09-05): open the record an answer was built from.
  // Optional, and the chips only render when it is given: a chip that opens
  // nothing is a control that lies about being one.
  onOpen?: (kind: string, id: string) => void;
  // UP-MIND-22 (2026-09-05): open the email composer on the draft Chat just
  // wrote and stored. Absent means the email path is unavailable, and the
  // command says so rather than writing words that go nowhere.
  onCompose?: () => void;
  // UP-MIND-24 (2026-09-05): Today's meeting line asked "what did you say"
  // about this person. Chat is where that question already has an answer
  // (UP-MIND-21), so the tap lands here with the person filled in.
  askPersonId?: string;
  askNonce?: number;
  onAskConsumed?: () => void;
} = {}) {
  const chat = useChat();
  const tasksSvc = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const catsSvc = useCategories();
  const peopleSvc = usePeople();
  const strands = useOptionalStrands();
  // UP-MIND-03: "when did I last talk to Marco" reads the cached Gmail
  // lookup the person card already uses. Optional, because Chat has to
  // render with no Google provider above it, and the answer says so.
  const google = useOptionalGoogle();
  const ai = useAI();
  const gather = useAIContext();

  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<PendingChoice | null>(null);
  // UP-MIND-04 (2026-09-05): the last question this conversation actually
  // answered, and the records it cited. "And tomorrow?" resolves against
  // this instead of starting cold. In state, not in the store: it is about
  // THIS conversation on THIS screen, and a stale one from last week is
  // exactly the wrong thing to resolve a pronoun against.
  const [prior, setPrior] = useState<Prior | null>(null);
  // UP-MIND-22: the person whose text sheet is open, and what the message
  // needs to say. The sheet owns no services and sends nothing; the user
  // taps Open in Messages and sends it themselves.
  const [textTo, setTextTo] = useState<{ person: Person; about: string } | null>(null);
  // The email draft, shown in the bubble with an Open button. Never sent
  // from here, and never sent by anything this path touches.
  const [emailDraft, setEmailDraft] = useState<{ to: string; name: string; body: string } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const filesSvc = useOptionalFiles();
  const fileStore = useFileStore();
  const gymSvc = useOptionalGym();

  // UP-PLAT-08 (2026-09-06): the attached file, from the pick to the receipt.
  // `pending` is the distillation handoff: the two review flows (schedule,
  // gym) own the rest of the journey and the file never lands anywhere until
  // the person has looked at what was read.
  const [attaching, setAttaching] = useState(false);
  const [pending, setPending] = useState<{ to: "schedule" | "gym"; file: File } | null>(null);
  // Loaded only for the schedule distillation, which needs the areas to file
  // an event under and the day's events to spot a duplicate. Loaded when a
  // schedule file is actually handed over, so an ordinary chat turn pays
  // nothing for a feature it is not using.
  const [sheetCats, setSheetCats] = useState<SheetCategory[]>([]);
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  useEffect(() => {
    if (pending?.to !== "schedule") return;
    let on = true;
    void (async () => {
      const [cats, evs] = await Promise.all([catsSvc.list().catch(() => []), schedule.listEvents().catch(() => [])]);
      if (!on) return;
      setSheetCats(cats.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
      setAllEvents(evs);
    })();
    return () => { on = false; };
  }, [pending, catsSvc, schedule]);

  // Returns the list it just loaded (UP-MIND-04): `msgs` inside an async
  // handler is the value from the render that started it, so a handler that
  // needs the history INCLUDING the message it just stored has to be handed
  // it rather than reading the state it set two lines up.
  const reload = useCallback(async () => {
    const list = await chat.list();
    setMsgs(list);
    return list;
  }, [chat]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length, choice]);

  const say = async (role: "user" | "jarvis", text: string, provenance?: ChatProvenance) => {
    await chat.append({ role, text, ...(provenance ? { provenance } : {}) });
    await reload();
  };

  // UP-MIND-05 (2026-09-05): Chat emitted nothing at all, so the box that
  // answers, acts and captures taught the Brain nothing about any of it.
  // WHICH LANE answered is the whole payload: no question, no answer, no
  // subject. rowFrom drops every prop but this one, so nothing typed into
  // Chat can leave the device through the log.
  const logAnswered = (kind: "records" | "ai" | "action" | "capture") => {
    emit({ type: "chat.answered", props: { kind } });
  };

  const snapshot = async (): Promise<AnswerSnapshot> => {
    const today = todayISO();
    const [evs, tks] = await Promise.all([schedule.listEvents(), tasksSvc.listTasks()]);
    // Money answers ride the AI path for now; the money layer's derived line
    // gets wired here in the files-and-money chat pass.
    const left: string | null = null;
    // ts stays 0 on the placeholder EMPTY snapshot (no Gmail connection, or
    // nothing recent enough to trust) -- the one signal that distinguishes
    // "never checked" from "checked, genuinely caught up" (needsYou: 0 either
    // way), so a missing connection reads as unknown, never as a false all-clear.
    const mail = loadMailSnapshot();
    const people = await peopleSvc.list().catch(() => []);
    // UP-MIND-03: the mail account that can answer "when did we last talk".
    // Null with no session, which the answer distinguishes from "never".
    const mailApis = (google?.apis("mail") ?? []).map((a) => a.api);
    const mailApi = mailApis[0] ?? null;
    return {
      today,
      nowHHMM: nowHHMM(new Date()),
      events: evs.map((e) => ({ id: e.id, title: e.data.title, date: e.data.date, start: e.data.start, location: e.data.location })),
      tasks: tks.map((t) => ({ id: t.id, text: t.data.text, due: t.data.due, done: t.data.done, ...(t.data.personId ? { personId: t.data.personId } : {}) })),
      leftToSpend: left,
      // SHELL-F-08 (2026-09-05): the true total AND the preview. mail.threads
      // is capped at 6 by the snapshot; mail.needsYou is what actually needs
      // him, which is the number Today and the Email tab both show.
      mailNeedsYou: mail.ts > 0 ? { total: mail.needsYou, threads: mail.threads.map((t) => ({ id: t.id, subject: t.subject })) } : null,
      people: people.map((p) => ({
        id: p.id,
        name: p.data.name,
        ...(p.data.email ? { email: p.data.email } : {}),
        ...(p.data.birthday ? { birthday: p.data.birthday } : {}),
        ...(p.data.relationship ? { relationship: p.data.relationship } : {}),
      })),
      waiting: mail.waiting,
      ...(mailApi ? { lastContact: (email: string) => lastContactFor(mailApi, email, Date.now()) } : {}),
      // UP-MIND-21 (2026-09-05): the same pass the Email tab runs, over every
      // connected account, reachable from the box people already ask in.
      ...(mailApis.length && ai.available ? {
        said: (person: string, about: string) => askSaid(person, about, {
          search: async (query, cap) => {
            const per = await Promise.all(mailApis.map(async (api) => {
              const metas = await api.searchThreads(query, cap).catch(() => []);
              return fullThreadsFor(api, metas, cap);
            }));
            return per.flat();
          },
          complete: (messages, system) => ai.complete(messages as { role: "user" | "assistant"; content: string }[], system),
          localDay: (d) => todayISO(d),
          clean: cleanBody,
          cap: Math.max(1, Math.ceil(SENT_BODY_CAP / mailApis.length)),
        }),
      } : {}),
      now: Date.now(),
    };
  };

  // UP-MIND-22 (2026-09-05): "draft a note to Sarah saying I'll send the
  // roster Friday". Writes the words in the user's voice, in the recipient's
  // register, and hands them over. NOTHING here sends: the email path opens
  // the composer and the text path opens the system message sheet, and both
  // end in a tap the user makes.
  const runDraft = async (cmd: Extract<ChatCommand, { kind: "draft" }>, person: Person) => {
    if (!ai.available) {
      await say("jarvis", "I can draft that when you're back online", { kind: "records" });
      return;
    }
    if (cmd.medium === "email" && !person.data.email) {
      await say("jarvis", `${person.data.name} has no email on file`, { kind: "records", refs: [{ kind: "person", id: person.id, label: person.data.name }] });
      return;
    }
    if (cmd.medium === "email" && !onCompose) {
      await say("jarvis", "Email isn't available from here", { kind: "records" });
      return;
    }
    // A text goes to the sheet that already exists for exactly this, with
    // the topic passed in: the sheet drafts, shows the words, and hands them
    // to the system composer.
    if (cmd.medium === "text") {
      setTextTo({ person, about: cmd.about });
      await say("jarvis", `Drafting a text to ${person.data.name}`, { kind: "action", refs: [{ kind: "person", id: person.id, label: person.data.name }] });
      logAnswered("action");
      return;
    }
    // UP-MIND-23 (2026-09-05): scoped to the person being written to, so
    // the draft knows what is already decided with them and does not
    // re-open it.
    const voice = await gather({ personId: person.id, personName: person.data.name })
      .then((c) => voiceToText(c, { styleRule: false }))
      .catch(() => "");
    let body = "";
    try {
      body = (await ai.complete(
        [{ role: "user", content: cmd.about || `Draft an email to ${person.data.name}.` }],
        draftSystemPrompt(person.data, "direct", cmd.about || undefined, { medium: "email", voice }),
        { kind: "message", pin: "messageDrafts", tier: "write" },
      )).trim();
    } catch {
      await say("jarvis", "Couldn't reach JARVIS · Nothing was written", { kind: "records" });
      return;
    }
    if (!body) {
      await say("jarvis", "Couldn't draft that one · Nothing was written", { kind: "records" });
      return;
    }
    putComposeDraft({ to: person.data.email!, subject: cmd.about ? cmd.about.slice(0, 80) : "", body });
    setEmailDraft({ to: person.data.email!, name: person.data.name, body });
    await say("jarvis", body, { kind: "action", refs: [{ kind: "person", id: person.id, label: person.data.name }] });
    logAnswered("action");
  };

  const runCommand = async (cmd: ChatCommand, target: CommandTarget) => {
    if (cmd.kind === "complete") {
      // SHARED-F-03 (2026-09-05): the Undo was a second toggleDone, which
      // flips whatever the row is NOW and rolls a recurring task forward
      // again. The state before the tick is read here and put back on Undo.
      const before = await tasksSvc.task(target.id);
      const ok = await attemptWrite(() => tasksSvc.toggleDone(target.id));
      if (!ok) return;
      await say("jarvis", `Done: ${target.text}`, { kind: "action", refs: [{ kind: "task", id: target.id, label: target.text }] });
      if (before) showToast({ message: "Task completed", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasksSvc.restoreCompletion(target.id, before)); } });
    } else if (cmd.kind === "reschedule") {
      const today = todayISO();
      // SHELL-F-07 (2026-09-05): tomorrow used to be local noon plus a fixed
      // day, read back through toISOString(). Beyond UTC+12 (Auckland in
      // summer, Kiribati) local noon is still yesterday in UTC, so "move it
      // to tomorrow" moved it to today. addDays walks with setDate and
      // formats from local getters.
      const when = cmd.when === "today" ? today : addDays(today, 1);
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
    const { command: cmd, question } = choice;
    setChoice(null);
    // UP-MIND-03: the tap on a person chip re-runs the same question with
    // that person pinned, so the tap is both the answer to "which one" and
    // the answer to what was actually asked.
    if (question) {
      const ans = await answerQuestion(question, await snapshot(), { id: target.id });
      if (ans) await say("jarvis", ans.text, ans.provenance);
      return;
    }
    if (cmd?.kind === "draft") {
      const p = (await peopleSvc.list().catch(() => [])).find((x) => x.id === target.id);
      if (p) await runDraft(cmd, p);
      return;
    }
    if (cmd) await runCommand(cmd, target);
  };

  // UP-MIND-24: one-shot, same shape as every intent the shell owns: act on
  // the value and the nonce together, then say it was consumed.
  const askedFor = useRef<string>("");
  useEffect(() => {
    if (!askPersonId) return;
    const key = askPersonId + "|" + (askNonce ?? 0);
    if (askedFor.current === key) return;
    askedFor.current = key;
    onAskConsumed?.();
    void (async () => {
      const p = (await peopleSvc.list().catch(() => [])).find((x) => x.id === askPersonId);
      if (!p) return;
      // The box is FILLED, not fired: the user still taps Send, which is the
      // same rule the starter chips follow.
      setDraft(`What did I tell ${p.data.name} about `);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askPersonId, askNonce]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      // SHELL-F-17 (2026-09-05): the box used to empty BEFORE the first
      // write, inside a try/finally with no catch, so a store that rejected
      // (a real error, not the queued offline path) left no bubble, no toast
      // and no text: the message was gone. The user's bubble is stored first,
      // guarded; the draft clears only once it is. A failure leaves the words
      // in the box with the standard toast, ready for another tap.
      const stored = await attemptWrite(() => chat.append({ role: "user", text }));
      if (!stored) return;
      setDraft("");
      try {
        const history = await reload();

        // UP-MIND-04: "and tomorrow", "move it to Friday", "where is it".
        // Rewritten into a whole sentence BEFORE the command parser and the
        // Q&A shapes see it, so both stay stateless. The user's own words
        // are what is stored and shown; only the resolution changes.
        const asked = rewriteFollowUp(text, prior) ?? text;

        // 1. Commands, before any AI call (cost guard).
        const cmd = parseCommand(asked);
        // UP-MIND-22: a draft resolves against PEOPLE, not against open
        // tasks, so it branches before the task chooser below.
        if (cmd?.kind === "draft") {
          const all = await peopleSvc.list().catch(() => []);
          const matches = all.filter((p) => namePatterns(p.data.name).some((re) => re.test(cmd.query)));
          if (matches.length === 0) {
            await say("jarvis", `Nobody in Contacts matches "${cmd.query}" · Nothing was written`, { kind: "records" });
            return;
          }
          if (matches.length > 1) {
            await say("jarvis", "Which one?", { kind: "records", refs: matches.slice(0, 4).map((p) => ({ kind: "person", id: p.id, label: p.data.name })) });
            setChoice({ command: cmd, options: matches.slice(0, 4).map((p) => ({ id: p.id, text: p.data.name })) });
            return;
          }
          await runDraft(cmd, matches[0]!);
          return;
        }
        if (cmd) {
          const open = (await tasksSvc.listTasks()).filter((t) => !t.data.done).map((t) => ({ id: t.id, text: t.data.text }));
          const res = resolveTarget(open, cmd.query);
          logAnswered("action");
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
        if (looksLikeQuestion(asked)) {
          const ans = await answerQuestion(asked, await snapshot());
          if (ans) {
            // The turn that a follow-up will resolve against next.
            if (!ans.choose) setPrior({ question: asked, ...(ans.provenance.refs ? { refs: ans.provenance.refs } : {}) });
            logAnswered("records");
            await say("jarvis", ans.text, ans.provenance);
            // UP-MIND-03: more than one person answers to that name. The
            // chips are the same bounded chooser the command path renders.
            if (ans.choose) setChoice({ question: text, options: ans.choose.map((o) => ({ id: o.id, text: o.text })) });
            return;
          }
          // 3. Grounded AI for the questions the rules cannot read.
          if (!ai.available) {
            await say("jarvis", "I can answer that when you're back online", { kind: "records" });
            return;
          }
          try {
            const ctx = await gather();
            const raw = await ai.complete(
              // UP-MIND-04: the last six turns ride along, so "and what
              // about the week after" is a question rather than a fragment.
              // Capped hard: the proxy refuses an input over 32 KB
              // (api/ai.ts:61) and the context block below is already most
              // of one prompt.
              recentTurns(history, text),
              chatSystemPrompt(contextToText(ctx)),
              { kind: "chat", background: false },
            );
            setPrior({ question: asked });
            logAnswered("ai");
            await say("jarvis", raw.trim(), { kind: "ai" });
          } catch {
            await say("jarvis", "Couldn't reach the AI · Try again", { kind: "records" });
          }
          return;
        }

        // 4. Everything else is a capture: the Smart Paste pipeline, verbatim.
        const cats = await catsSvc.list().catch(() => []);
        let saved: Awaited<ReturnType<typeof smartPasteSave>> = [];
        let refusedFact = false;
        const ok = await attemptWrite(async () => {
          // The genome rides along (Quick Add, handoff 5.0): "I never work out
          // on Sundays" typed into chat is a fact about the person, and the one
          // box that answers, acts and captures now also remembers.
          saved = await smartPasteSave(text, { ai, gather, tasks: tasksSvc, schedule, notes, categories: cats, today: todayISO(), ...(strands ? { strands } : {}), onFactRefused: () => { refusedFact = true; } });
        });
        if (!ok) return;
        if (saved.length === 0) {
          await say("jarvis", refusedFact ? "The Brain is full · Prune it in What JARVIS Knows" : "Nothing to save in that", { kind: "records" });
          return;
        }
        logAnswered("capture");
        const first = saved[0]!;
        await say(
          "jarvis",
          saved.length === 1
            // A fact is not "saved" the way a task is: it was remembered. The
            // receipt says which, because the two land in different places.
            ? (first.kind === "fact" ? `JARVIS will remember that: ${first.title}` : `Saved: ${first.title}`)
            : `Saved ${saved.length} items`,
          { kind: "action", refs: saved.map((s) => ({ kind: s.kind, id: s.id, label: s.title })) },
        );
        // S4-Q23 (2026-09-04): provLine below has always printed "Done · Undo
        // on the toast" for this reply, and nothing here ever raised one, on
        // every kind of capture chat can produce, facts included. A told-rank
        // fact is the highest-priority thing JARVIS remembers, which makes an
        // untappable Undo the most consequential case of this bug, not the
        // only one. undoSaved already handles every kind (Quick Capture's own
        // Undo button calls the same function), so this is wiring an existing
        // capability to the reply that already promised it, not new behaviour.
        const justSaved = saved;
        showToast({
          message: justSaved.length === 1 ? "Saved" : `Saved ${justSaved.length} items`,
          actionLabel: "Undo",
          onAction: async () => {
            await attemptWrite(async () => {
              for (const s of justSaved) await undoSaved(s, { tasks: tasksSvc, schedule, notes, ...(strands ? { strands } : {}) });
            });
          },
        });
      } catch {
        // The bubble is in the thread; what failed is reading the records
        // behind the reply (listTasks, the snapshot, a reply's own write).
        // Silence here read as "JARVIS ignored me", so it says so instead.
        showToast({ message: "Couldn't reach your records · Try again" });
      }
    } finally {
      setBusy(false);
    }
  };

  // ---- FILES (UP-PLAT-08, 2026-09-06) ----

  // The one vision call, and only when the deterministic router could not
  // decide. No pin: this rides the MASTER level, so a person at On Request
  // who just tapped the clip is asking, and a person at Off never spends a
  // cent here. An unreadable answer is a note, which loses nothing.
  const askWhere = async (file: File, said: string): Promise<FileDestination> => {
    if (!ai.available || effectiveLevel(getAIControl()) === "off") return "note";
    if (isPdf(file.type, file.name)) return "note"; // the proxy takes images, not PDFs
    try {
      const img = await encodeImageForVision(file);
      const raw = await ai.complete(
        [buildVisionMessage(ROUTE_PROMPT + (said ? `\nThe person said: ${said}` : ""), img.data, img.mediaType)],
        undefined,
        { kind: "file_route", background: false },
      );
      return parseRouteAnswer(raw) ?? "note";
    } catch {
      return "note";
    }
  };

  // Money and Notes are writes this screen can make itself. Schedule and Gym
  // are review flows that already exist, so the file is handed to them and
  // nothing is written until the person has approved what was read.
  const fileToMoney = async (file: File, why: string) => {
    if (!filesSvc || !fileStore) { await say("jarvis", "Files need a signed-in account", { kind: "records" }); return; }
    const rowId = await filesSvc.create({
      name: file.name, path: "", mime: file.type, bytes: file.size, scope: "money", addedAt: todayISO(),
    });
    try {
      const stored = await fileStore.upload(rowId, file);
      await filesSvc.update(rowId, { path: stored.path, name: stored.name, mime: stored.mime, bytes: stored.bytes });
    } catch (e) {
      await filesSvc.remove(rowId).catch(() => undefined);
      throw e;
    }
    await say("jarvis", `Filed to Money as a receipt · ${why}`, {
      kind: "action",
      refs: [{ kind: "file", id: rowId, label: file.name }],
    });
    showToast({
      message: "Filed to Money",
      actionLabel: "Undo",
      onAction: async () => {
        const row = await filesSvc.get(rowId);
        await attemptWrite(() => filesSvc.remove(rowId));
        if (row?.data.path) void fileStore.remove([row.data.path]);
        showToast({ message: "Receipt removed" });
      },
    });
  };

  const fileToNote = async (file: File, why: string) => {
    if (!fileStore) { await say("jarvis", "Files need a signed-in account", { kind: "records" }); return; }
    // Born unfiled, same rule every other note creation follows.
    const noteId = await notes.createNote(fileStem(file.name), "");
    if (!noteId) throw new Error("Couldn't make a note for that file.");
    try {
      const stored = await fileStore.upload(noteId, file);
      await notes.addBlock(noteId, {
        type: stored.mime.startsWith("image/") ? "photo" : "file",
        name: stored.name, size: sizeLabel(stored.bytes), path: stored.path, mime: stored.mime,
      });
    } catch (e) {
      await notes.deleteNote(noteId).catch(() => undefined);
      throw e;
    }
    await say("jarvis", `Attached to a new note · ${why}`, {
      kind: "action",
      refs: [{ kind: "note", id: noteId, label: fileStem(file.name) }],
    });
    showToast({
      message: "Saved to Notes",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => notes.deleteNote(noteId));
        void fileStore.removeAll(noteId);
        showToast({ message: "Note removed" });
      },
    });
  };

  const deliver = async (file: File, to: FileDestination, why: string) => {
    setLastTo(to);
    if (to === "schedule" || to === "gym") {
      setPending({ to, file });
      await say("jarvis", `Reading it as a ${to === "schedule" ? "schedule" : "workout"} · ${why}`, { kind: "records" });
      return;
    }
    if (to === "money") { await fileToMoney(file, why); return; }
    await fileToNote(file, why);
  };

  // The whole journey for one picked file. The draft text rides along as a
  // signal, because "here is the receipt from lunch" is the strongest thing
  // the router can read, and it is NOT consumed: it stays in the box, so a
  // person who meant to send it as a message still can.
  const onPickedFile = async (file: File) => {
    if (attaching) return;
    setAttaching(true);
    const said = draft.trim();
    try {
      await say("user", said ? `${said} · ${file.name}` : file.name);
      const decided = routeFile({ name: file.name, mime: file.type, text: said });
      const to = decided?.to ?? await askWhere(file, said);
      await deliver(file, to, decided?.why ?? "Read from the file itself");
    } catch (e) {
      // Never a silent failure: the bytes did not land and the thread says so.
      await say("jarvis", e instanceof Error && e.message ? e.message : "Couldn't save that file", { kind: "records" });
    } finally {
      setAttaching(false);
    }
  };

  // Refile: the same file, somewhere else, without picking it again. Only
  // offered on the last receipt, because that is the one the person is
  // looking at, and only while the file is still in hand.
  const [lastFile, setLastFile] = useState<File | null>(null);
  // Where it went last, so the refile chips never offer the place it is
  // already in.
  const [lastTo, setLastTo] = useState<FileDestination | null>(null);
  const refile = async (to: FileDestination) => {
    if (!lastFile || attaching) return;
    setAttaching(true);
    try {
      await deliver(lastFile, to, "You moved it here");
    } catch (e) {
      await say("jarvis", e instanceof Error && e.message ? e.message : "Couldn't save that file", { kind: "records" });
    } finally {
      setAttaching(false);
    }
  };

  const picker = usePickFile((f) => { setLastFile(f); void onPickedFile(f); });

  // UP-MIND-02 (2026-09-05): every record an answer used has been stored on
  // the bubble since Chat shipped (types.ts ChatProvenance.refs) and nothing
  // ever rendered them, so "when is the dentist" answered with a date and
  // left the user to go and find the event themselves.
  const refsOf = (m: ChatMessage) => (m.data.role === "jarvis" ? m.data.provenance?.refs ?? [] : []);

  const provLine = (m: ChatMessage): string | null => {
    const p = m.data.provenance;
    if (!p) return null;
    if (p.kind === "ai") return "From your data + AI";
    // SHELL-F-26 (2026-09-05): this said "Done · Undo on the toast" under
    // every stored action bubble, including yesterday's, and a toast lives
    // five seconds. The Undo is real (S4-Q23 wired it) but it is on the
    // toast, not on the bubble, so the bubble stops promising it.
    if (p.kind === "action") return "Done";
    if (p.refs && p.refs.length > 0) return "From your records";
    return "From your records";
  };

  return (
    <div className="screen ruled chat-ruled">
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
            <div className="sh2 sh2-quiet chat-starter-head"><span className="t">Try</span></div>
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
            {onOpen && refsOf(m).length > 0 && (
              <div className="chip-row chat-refs">
                {refsOf(m).map((r) => (
                  <button
                    key={r.kind + ":" + r.id}
                    type="button"
                    className="chip"
                    onClick={() => onOpen(r.kind, r.id)}
                  >{r.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {/* UP-PLAT-08: refile chips, Smart Paste's anatomy applied to bytes.
            Only on the file still in hand, and only the three places it did
            NOT go: a chip that files it where it already is does nothing and
            says it did something. */}
        {lastFile && !attaching && !pending && (
          <div className="chip-row">
            {(["money", "schedule", "gym", "note"] as FileDestination[])
              .filter((d) => d !== lastTo)
              .map((d) => (
                <div className="chip" role="button" tabIndex={0} key={d} onClick={() => void refile(d)}>
                  Move to {DESTINATION_LABEL[d]}
                </div>
              ))}
          </div>
        )}
        {choice && (
          <div className="chip-row chip-picker-open">
            {choice.options.map((o) => (
              <div key={o.id} className="chip" role="button" tabIndex={0} onClick={() => void pickChoice(o)}>{o.text}</div>
            ))}
            <div className="chip" role="button" tabIndex={0} onClick={() => setChoice(null)}>Never Mind</div>
          </div>
        )}
        {/* UP-MIND-22: the draft, and the tap that opens it. The words are
            on screen before anything can be sent, and Chat itself never
            sends: this button opens the composer, where Send lives. */}
        {emailDraft && onCompose && (
          <div className="chip-row chat-refs">
            <button type="button" className="chip chip-act" onClick={() => { setEmailDraft(null); onCompose(); }}>
              Open in Email
            </button>
            <button type="button" className="chip" onClick={() => setEmailDraft(null)}>Discard</button>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {textTo && (
        <MessageDraftSheet
          person={textTo.person}
          ai={ai}
          {...(textTo.about ? { about: textTo.about } : {})}
          onClose={() => setTextTo(null)}
        />
      )}
      <div className="chat-inputbar">
        {/* UP-PLAT-08 (2026-09-06): the attach button. One picker, the
            phone's own sheet (camera, library, Files), same seam Money and
            Notes already use. */}
        {picker.input}
        <button
          className="convo-send"
          aria-label="Attach a File"
          onClick={() => picker.open(PICK_ANY)}
          disabled={attaching || busy}
        >{CLIP}</button>
        <input
          className="input"
          placeholder="Ask · tell · paste"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
        />
        {/* BROWSER-F-12 (2026-09-05): disabled on an empty box, not just
            inert. send() has always returned early on blank text, but the
            button gave no sign of it: a dead-tap detector pressed it and the
            DOM did not move in 1.1 seconds, which is a control that lies. */}
        <button className="convo-send" aria-label="Send" onClick={() => void send()} disabled={busy || draft.trim() === ""}>{SEND}</button>
      </div>
      {/* UP-PLAT-08: the two distillation flows the app already has, handed
          the file the person attached. Nothing is written until they have
          seen what was read and approved it, which is these screens' whole
          reason for existing; Chat only decided which one to open. */}
      {pending?.to === "schedule" && (
        <ScheduleUploadFlow
          ai={ai}
          svc={schedule}
          categories={sheetCats}
          existingEvents={allEvents}
          initialFile={pending.file}
          onDone={async ({ createdCount, updatedCount, undo }) => {
            setPending(null);
            const parts: string[] = [];
            if (createdCount) parts.push(`${createdCount} added`);
            if (updatedCount) parts.push(`${updatedCount} updated`);
            await say("jarvis", parts.length ? `Schedule read · ${parts.join(", ")}` : "Nothing to add from that", { kind: "action" });
            if (parts.length) showToast({ message: parts.join(", "), actionLabel: "Undo", onAction: async () => { await undo(); } });
          }}
          onCancel={() => { setPending(null); void say("jarvis", "Left it alone", { kind: "records" }); }}
        />
      )}
      {pending?.to === "gym" && (
        <GymUploadFlow
          ai={ai}
          initialFile={pending.file}
          onSave={async (program) => {
            setPending(null);
            if (!gymSvc) { await say("jarvis", "The gym needs a signed-in account", { kind: "records" }); return; }
            // The receipt fires only after the write resolved, never before.
            if (!(await attemptWrite(() => gymSvc.createProgram(program)))) return;
            await say("jarvis", `Saved ${program.name} to the gym`, { kind: "action" });
          }}
          onCancel={() => { setPending(null); void say("jarvis", "Left it alone", { kind: "records" }); }}
        />
      )}
    </div>
  );
}
