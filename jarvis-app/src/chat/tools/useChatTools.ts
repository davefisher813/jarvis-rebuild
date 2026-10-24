import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTasks, useSchedule, useNotes, usePeople, useProjects, useMoney, useGoals, useCategories, useDecisions, useChat, useUserId, useOptionalFiles, useOptionalStrands, useOptionalBrainMemory } from "../../data/NotesProvider";
import { useOptionalGoogle } from "../../connections/google/GoogleSession";
import { noteBlockText } from "../../search/search";
import { todayISO } from "../../ai/useAIContext";
import { flagOn } from "../../substrate/flags";
import type { AIService, AIMessage, AISystem } from "../../ai/AIService";
import { makeReadTools } from "./readTools";
import { runToolTurn, type TurnResult } from "./turn";
import { TOOL_NAMES } from "./registry";
import type { ToolContext } from "./dispatcher";
import { ProposalStore } from "./proposals";
import { makeProposers } from "./propose";
import { makeWriteDeps } from "./writeDeps";
import { approveAndRun } from "./approval";

// THE CHAT'S TOOLS, WIRED TO THE APP'S OWN SERVICES (chat box order, 2026-10-24).
//
// ChatFlow is already a thousand lines, so the wiring lives here: this hook reads the services the chat already sits on, hands the read
// tools plain functions over them (never the services, so a read cannot reach a write), and returns one `run` that carries a turn through
// the dispatcher. `working` is the one honest line of what is being looked at while it does.
//
// `seen` is the dispatcher's memory of the records it has handed back in this conversation. It lives as long as the screen does and no
// longer: a ref from last week is not a ref the model may use, it searches again.
//
// THE CARDS. A write the model asks for becomes a proposal in a ProposalStore (proposals.ts), and the screen draws one card for each. The
// store outlives the screen for the five minutes a card is good for, so leaving Chat for another tab and coming back does not lose a card
// the thread still says is waiting; it is keyed to the SIGNED-IN USER, so another account never sees it. (Not to the task service: the
// provider rebuilds every service whenever the session's token refreshes, which happens on its own, and a card must not vanish then, nor a
// turn already in flight file its card where nobody is looking.) The hook hands the screen three things to do with a card: approve (the only
// road to a write, approval.ts), cancel, and settle (the receipt is written; the card goes).

/** Is the model's tool layer switched on in this build? (VITE_JARVIS_FLAGS, per deploy; unset means the chat is exactly what it was.) */
export const chatToolsOn = (): boolean => flagOn("chat_tools_v1");

// One store per signed-in user, for as long as the page lives.
const stores = new Map<string, ProposalStore>();
function storeFor(userId: string): ProposalStore {
  let s = stores.get(userId);
  if (!s) { s = new ProposalStore(); stores.set(userId, s); }
  return s;
}

export function useChatTools(ai: AIService) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const people = usePeople();
  const projects = useProjects();
  const money = useMoney();
  const goals = useGoals();
  const categories = useCategories();
  const decisions = useDecisions();
  const chat = useChat();
  const files = useOptionalFiles();
  const strands = useOptionalStrands();
  const brainMemory = useOptionalBrainMemory();
  const google = useOptionalGoogle();
  const userId = useUserId();

  const [working, setWorking] = useState<string | null>(null);
  const ctx = useRef<ToolContext>({ seen: new Set(), now: new Date() });

  // The cards. A subscription redraws the screen when one changes; a timer marks the next one that runs out of time.
  const store = useMemo(() => storeFor(userId ?? "signed-out"), [userId]);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { store.sweep(); return store.subscribe(bump); }, [store]);
  useEffect(() => {
    const next = store.list().filter((p) => p.state === "open").map((p) => p.expiresAt).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const t = setTimeout(() => store.sweep(), Math.max(0, next - Date.now()) + 25);
    return () => clearTimeout(t);
  }, [store, version]);

  const impls = useMemo(() => makeReadTools({
    // Every list Search reads, each answering with nothing on its own failure so a broken read cannot blank the rest.
    async searchData() {
      const none = () => [] as never[];
      const [t, e, n, p, pr, ac, g, c, dec, fl, st] = await Promise.all([
        tasks.listTasks().catch(none), schedule.listEvents().catch(none), notes.listNotes().catch(none), people.list().catch(none),
        projects.list().catch(none), money.list().catch(none), goals.list().catch(none), categories.list().catch(none), decisions.list().catch(none),
        files ? files.list("money").catch(none) : Promise.resolve([]),
        strands ? strands.list().catch(none) : Promise.resolve([]),
      ]);
      return { tasks: t, events: e, notes: n, people: p, projects: pr, accounts: ac, goals: g, categories: c, decisions: dec, files: fl, strands: st };
    },
    async note(id) {
      const d = await notes.note(id);
      return d ? { title: d.title, text: noteBlockText(d) } : null;
    },
    events: () => schedule.listDisplayEvents(),
    tasks: () => tasks.listTasks(),
    async mail() {
      const api = google?.apis("mail")[0]?.api;
      return api ? { searchThreads: (q, max) => api.searchThreads(q, max) } : null;
    },
    facts: async () => (brainMemory ? brainMemory.list() : []),
    async activity(sinceMs) {
      return (await chat.list())
        .filter((m) => m.data.role === "jarvis" && m.data.provenance?.kind === "action" && Date.parse(m.data.ts) >= sinceMs)
        .reverse()
        .map((m) => ({ at: m.data.ts, text: m.data.text }));
    },
    today: () => todayISO(),
    links: flagOn("memory_v1"),
  }), [tasks, schedule, notes, people, projects, money, goals, categories, decisions, chat, files, strands, brainMemory, google]);

  // What turns a write the model asked for into the content of a card. Two reads and nothing else (propose.ts).
  const proposers = useMemo(() => makeProposers({
    task: (id) => tasks.task(id),
    async person(id) {
      const p = await people.get(id);
      return p ? { name: p.data.name } : null;
    },
    today: () => todayISO(),
  }), [tasks, people]);

  // The writes a tap may make. Handed to the approval path and to nothing else.
  const writes = useMemo(() => makeWriteDeps({ tasks, decisions }), [tasks, decisions]);

  const run = useCallback(async (history: AIMessage[], system: AISystem): Promise<TurnResult> => {
    ctx.current.now = new Date();
    return runToolTurn(history, {
      step: (messages) => ai.completeTurn(messages, system, { tools: TOOL_NAMES, kind: "chat" }),
      dispatch: { impls, proposers, proposals: store, ctx: ctx.current },
      working: setWorking,
    });
  }, [ai, impls, proposers, store]);

  /** The person tapped a card, which drew `shownHash`. The one road to a write. */
  const approve = useCallback((id: string, shownHash: string) => approveAndRun(store, id, shownHash, writes), [store, writes]);
  const cancel = useCallback((id: string) => store.cancel(id), [store]);
  const dismiss = useCallback((id: string) => store.dismiss(id), [store]);
  /** The receipt is written (or the failure said): the card has done its job. */
  const settle = useCallback((id: string, ok: boolean) => store.finish(id, ok), [store]);
  /** Where this turn's cards stand NOW (still waiting, already made), for the line the thread writes when the turn ends. */
  const tally = useCallback((ids: readonly string[]) => store.tally(ids), [store]);

  return { run, working, proposals: store.list(), approve, cancel, dismiss, settle, tally };
}
