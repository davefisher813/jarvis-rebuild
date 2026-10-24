import { useCallback, useMemo, useRef, useState } from "react";
import { useTasks, useSchedule, useNotes, usePeople, useProjects, useMoney, useGoals, useCategories, useDecisions, useChat, useOptionalFiles, useOptionalStrands, useOptionalBrainMemory } from "../../data/NotesProvider";
import { useOptionalGoogle } from "../../connections/google/GoogleSession";
import { noteBlockText } from "../../search/search";
import { todayISO } from "../../ai/useAIContext";
import { flagOn } from "../../substrate/flags";
import type { AIService, AIMessage, AISystem } from "../../ai/AIService";
import { makeReadTools } from "./readTools";
import { runToolTurn, type TurnResult } from "./turn";
import { TOOL_NAMES } from "./registry";
import type { ToolContext } from "./dispatcher";

// THE CHAT'S TOOLS, WIRED TO THE APP'S OWN SERVICES (chat box order, 2026-10-24).
//
// ChatFlow is already a thousand lines, so the wiring lives here: this hook reads the services the chat already sits on, hands the read
// tools plain functions over them (never the services, so a read cannot reach a write), and returns one `run` that carries a turn through
// the dispatcher. `working` is the one honest line of what is being looked at while it does.
//
// `seen` is the dispatcher's memory of the records it has handed back in this conversation. It lives as long as the screen does and no
// longer: a ref from last week is not a ref the model may use, it searches again.

/** Is the model's tool layer switched on in this build? (VITE_JARVIS_FLAGS, per deploy; unset means the chat is exactly what it was.) */
export const chatToolsOn = (): boolean => flagOn("chat_tools_v1");

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

  const [working, setWorking] = useState<string | null>(null);
  const ctx = useRef<ToolContext>({ seen: new Set(), now: new Date() });

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

  const run = useCallback(async (history: AIMessage[], system: AISystem): Promise<TurnResult> => {
    ctx.current.now = new Date();
    return runToolTurn(history, {
      step: (messages) => ai.completeTurn(messages, system, { tools: TOOL_NAMES, kind: "chat" }),
      dispatch: { impls, ctx: ctx.current },
      working: setWorking,
    });
  }, [ai, impls]);

  return { run, working };
}
