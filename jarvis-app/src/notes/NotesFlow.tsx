import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sourceOpener } from "../shared/openSource";
import { useFreshLists } from "../data/useFreshLists";
import { ENTITY_NOTE } from "./types";
import { useNotes, useCategories, useTasks, useSchedule, useProjects, useGoals, usePeople, useOptionalProfile, useFileStore, useOptionalDecisions } from "../data/NotesProvider";
import { useAI } from "../ai/useAI";
import { findInNote, passLength, PASS_DELTA } from "./jarvisFound";
import type { TurnIntoType } from "./screens/NoteEditor";
import { catName } from "../shared/categories";
import type { Category } from "../categories/types";
import type { Block, Connection, NoteData, TemplateKey } from "./types";
import NotesList, { type NoteListItem } from "./screens/NotesList";
import { noteBlockText } from "../search/search";
import NoteEditor, { type EditorNote } from "./screens/NoteEditor";
import Templates from "./screens/Templates";
import { usePushDepth } from "../shared/pushNav";
import AddBlockSheet from "./screens/AddBlockSheet";
import Connections from "./screens/Connections";
import LinkPicker from "./screens/LinkPicker";
import { showToast } from "../shared/toast";
import { parseRich } from "./richtext";
import { usePickFile, PICK_ANY, PICK_IMAGE } from "../shared/usePickFile";
import { fileStem, sizeLabel } from "../files/types";
import { FormSheet, Group, Row, FieldRow, Strip } from "../shared/FormSheet";
import { Check } from "../shared/icons";

import { attemptWrite } from "../shared/guard";
import { recordSpot } from "../restore/whereYouWere";
import CreateTasks from "./screens/CreateTasks";
import type { BlockType } from "./types";
import QuickCreateSheet, { nextHalfHour, type QuickCreateKind } from "./screens/QuickCreateSheet";
import { todayISO, addDays } from "../schedule/calendar";

type Screen = "list" | "editor" | "templates" | "connections" | "createTasks" | "linkPicker";

const TEMPLATE_TITLE: Record<TemplateKey, string> = {
  blank: "New Note",
  meeting: "Meeting Notes",
  todo: "Checklist",
  tracker: "Tracker",
  brief: "Project Brief",
  journal: "Journal",
};

// maps a stored note into the editor's display shape
function toEditorNote(data: NoteData): EditorNote {
  const blocks = data.blocks
    .map((b): EditorNote["blocks"][number] | null => {
      switch (b.type) {
        case "heading": return { id: b.id, type: "heading", text: b.text ?? "" };
        case "text": return { id: b.id, type: "text", text: b.text ?? "" };
        case "meta": return { id: b.id, type: "meta", text: b.text ?? "" };
        // C-17
        case "quote": return { id: b.id, type: "quote", text: b.text ?? "" };
        case "callout": return { id: b.id, type: "callout", text: b.text ?? "" };
        case "divider": return { id: b.id, type: "divider" };
        case "checklist":
          return {
            id: b.id,
            type: "checklist",
            items: (b.items ?? []).map((it) =>
              typeof it === "string" ? { text: it, done: false } : { text: it.text, done: it.done, taskId: it.taskId }),
          };
        case "bulleted_list":
          return { id: b.id, type: "bulleted_list", items: (b.items ?? []).map((it) => typeof it === "string" ? it : it.text) };
        case "numbered_list":
          return { id: b.id, type: "numbered_list", items: (b.items ?? []).map((it) => typeof it === "string" ? it : it.text) };
        case "table": return { id: b.id, type: "table", header: b.columns ?? [], rows: b.rows ?? [] };
        case "file": return { id: b.id, type: "file", name: b.name ?? "File", size: b.size ?? "", path: b.path, mime: b.mime };
        case "photo": return { id: b.id, type: "photo", name: b.name ?? "Photo", size: b.size ?? "", path: b.path, mime: b.mime };
        default: return null;
      }
    })
    .filter((b): b is EditorNote["blocks"][number] => b !== null);
  return {
    category: data.category,
    eyebrow: catName(data.category).toUpperCase(),
    title: data.title,
    blocks,
    ...(data.source ? { source: data.source } : {}),
  };
}

// THE EMPTY-STARTER TYPES (2026-09-13, from a doubled "Write Something"
// under a Heading card): these five render through InlineEdit with nothing
// but a placeholder when blank, so two of the same kind back to back are
// visually identical rows with no way to tell them apart -- exactly what a
// double-tap on the same toolbar chip (or a chip tapped right after the
// note's own ready-to-type line primed itself) produced. isBlankStarter
// lets addBlock recognize that state and refocus the existing line instead
// of stacking a twin under it.
const EMPTY_STARTER_TYPES = new Set<BlockType>(["heading", "text", "meta", "quote", "callout"]);
function isBlankStarter(b: { type: BlockType; text?: string }): boolean {
  return EMPTY_STARTER_TYPES.has(b.type) && (b.text ?? "").trim() === "";
}

// a starter block for each add-block type
function starterBlock(type: BlockType): Omit<Block, "id"> {
  switch (type) {
    // Empty starters: the placeholder does the explaining and the first
    // keystroke is the writer's, not a delete of ours (deep writing pass).
    case "heading": return { type, text: "" };
    case "text": return { type, text: "" };
    case "meta": return { type, text: "" };
    // C-17
    case "quote": return { type, text: "" };
    case "callout": return { type, text: "" };
    case "divider": return { type };
    case "checklist": return { type, items: [{ text: "", done: false }] };
    case "bulleted_list": return { type, items: [""] };
    case "numbered_list": return { type, items: [""] };
    case "table": return { type, columns: ["", ""], rows: [["", ""]] };
    case "photo": return { type, name: "Photo", size: "" };
    case "file": return { type, name: "Attachment", size: "" };
  }
}

// The first line of a note's body, as words: the first block that carries
// text, rich markers stripped, a list's first item. "" when the note is
// only a title.
function firstLine(blocks: Block[] | undefined): string {
  for (const b of blocks ?? []) {
    if (b.type === "photo" || b.type === "file" || b.type === "table") continue;
    if (b.text && b.text.trim()) return parseRich(b.text).map((seg) => seg.text).join("").trim();
    const it = b.items?.[0];
    const t = typeof it === "string" ? it : it?.text;
    if (t && t.trim()) return t.trim();
  }
  return "";
}

export default function NotesFlow({
  seed = false,
  onChrome,
  onNavigate,
  openId,
  openNonce,
  onOpenConsumed,
}: {
  seed?: boolean;
  onChrome?: (chrome: { tabBar: boolean }) => void;
  onNavigate?: (kind: string, targetId: string) => void;
  openId?: string;
  // HMN-F-19 (2026-09-05): the shell's one-shot shape (shell/intents.ts).
  // The effect below fires on a CHANGE of openId, so opening note X from
  // search, backing out to the list and searching X again did nothing at all:
  // the id was still X and nothing had cleared it.
  openNonce?: number;
  onOpenConsumed?: () => void;
}) {
  const svc = useNotes();
  const cats = useCategories();
  const tasksSvc = useTasks();
  const schedSvc = useSchedule();
  const projSvc = useProjects();
  const goalSvc = useGoals();
  const peopleSvc = usePeople();
  const [catList, setCatList] = useState<Category[]>([]);
  const defaultCatId = catList[0]?.id ?? "";
  const [screen, setScreen] = useState<Screen>("list");
  const [list, setList] = useState<NoteListItem[]>([]);
  const [current, setCurrent] = useState<EditorNote | null>(null);
  // UP-CORE-05 (2026-09-05): the one map from a provenance stamp to a route,
  // shared with the Schedule tab (shared/openSource).
  const openSourceFor = useMemo(() => (onNavigate ? sourceOpener(onNavigate) : undefined), [onNavigate]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // 2026-09-12: the same id, readable from inside an await. Every write here
  // reloads the note afterwards, and a reload that started on the note he just
  // left finishes after the next one has opened; loadCurrent checks this before
  // it paints anything, so a stale note can no longer land in the editor. The
  // ref is set with the state and never separately.
  const currentIdRef = useRef<string | null>(null);
  const openCurrentId = useCallback((id: string | null) => { currentIdRef.current = id; setCurrentId(id); }, []);
  // Canvas typing flow: which block should hold the caret after a mutation.
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  // Undo/redo (2026-08-19, deep writing pass): every block mutation snapshots
  // the blocks array first. Undo restores wholesale; a new edit clears redo.
  const history = useRef<Block[][]>([]);
  const redoStack = useRef<Block[][]>([]);
  const [histTick, setHistTick] = useState(0);
  // ONE QUEUE FOR EVERY MUTATION (HMN-F-01, 2026-09-05). Every block edit is
  // read the note, change the whole `blocks` array, write it back, and the
  // editor's blur-save fires on the same tap that starts the next mutation
  // (a toolbar chip, Add Item, another item's checkbox). Two of those in
  // flight read the same stale note and the second write erased the first,
  // so a paragraph just typed reverted or the new block never appeared, and
  // loadCurrent then repainted the loss because the store is the truth. The
  // table edits had this queue to themselves since the deep template pass
  // (found live, the same way); now every mutation on the open note goes
  // through it, so each read-modify-write runs alone against a fresh read.
  // A failed step never wedges the queue: the chain continues either way.
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    const next = writeQueue.current.then(fn, fn);
    writeQueue.current = next.catch(() => {});
    return next;
  };
  const snap = async () => {
    if (!currentId) return;
    const d = await svc.note(currentId);
    if (!d) return;
    history.current.push(JSON.parse(JSON.stringify(d.blocks)) as Block[]);
    if (history.current.length > 50) history.current.shift();
    redoStack.current = [];
    setHistTick((t) => t + 1);
  };
  const undo = () => enqueue(async () => {
    if (!currentId) return;
    const prev = history.current.pop();
    if (!prev) return;
    // HMN-F-27 (2026-09-05): a photo block comes back with its picture, so
    // any bytes still waiting to be swept stay where they are.
    cancelBlockSweeps();
    const d = await svc.note(currentId);
    if (d) redoStack.current.push(JSON.parse(JSON.stringify(d.blocks)) as Block[]);
    await attemptWrite(() => svc.setBlocks(currentId, prev));
    await loadCurrent(currentId);
    setHistTick((t) => t + 1);
  });
  const redo = () => enqueue(async () => {
    if (!currentId) return;
    const next = redoStack.current.pop();
    if (!next) return;
    const d = await svc.note(currentId);
    if (d) history.current.push(JSON.parse(JSON.stringify(d.blocks)) as Block[]);
    await attemptWrite(() => svc.setBlocks(currentId, next));
    await loadCurrent(currentId);
    setHistTick((t) => t + 1);
  });
  const enterAt = (blockId: string, text: string) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    let newId: string | null = null;
    await attemptWrite(async () => {
      await svc.editBlock(currentId, blockId, { text });
      newId = await svc.insertBlockAfter(currentId, blockId, { type: "text", text: "" });
    });
    await loadCurrent(currentId);
    setFocusBlockId(newId);
  });
  const backspaceAt = (blockId: string) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    // The neighbour to land the caret on is found in the FRESH note, not the
    // rendered one: an edit queued ahead of this may have moved or removed it.
    const blocks = (await svc.note(currentId))?.blocks ?? [];
    const idx = blocks.findIndex((b) => b.id === blockId);
    const prev = [...blocks.slice(0, idx)].reverse().find((b) => b.type === "text" || b.type === "heading" || b.type === "meta");
    await attemptWrite(() => svc.deleteBlock(currentId, blockId));
    await loadCurrent(currentId);
    setFocusBlockId(prev?.id ?? null);
  });
  const transformAt = (blockId: string, prefix: "#" | "[]" | "-" | "1.", rest: string) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    await attemptWrite(async () => {
      if (prefix === "#") await svc.editBlock(currentId, blockId, { type: "heading", text: rest });
      else if (prefix === "[]") await svc.editBlock(currentId, blockId, { type: "checklist", text: undefined, items: [{ text: rest, done: false }] });
      else if (prefix === "-") await svc.editBlock(currentId, blockId, { type: "bulleted_list", text: undefined, items: [rest] });
      else await svc.editBlock(currentId, blockId, { type: "numbered_list", text: undefined, items: [rest] });
    });
    await loadCurrent(currentId);
    setFocusBlockId(prefix === "#" ? blockId : prefix === "-" || prefix === "1." ? blockId + ":0" : null);
  });
  const listItems = (blockId: string, items: string[], focusKey: string | null) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.editBlock(currentId, blockId, { items }));
    await loadCurrent(currentId);
    setFocusBlockId(focusKey);
  });
  const listExit = (blockId: string, remaining: string[]) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    if (remaining.length === 0) {
      await attemptWrite(() => svc.editBlock(currentId, blockId, { type: "text", text: "", items: undefined }));
      await loadCurrent(currentId);
      setFocusBlockId(blockId);
    } else {
      let newId: string | null = null;
      await attemptWrite(async () => {
        await svc.editBlock(currentId, blockId, { items: remaining });
        newId = await svc.insertBlockAfter(currentId, blockId, { type: "text", text: "" });
      });
      await loadCurrent(currentId);
      setFocusBlockId(newId);
    }
  });
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [conns, setConns] = useState<Connection[]>([]);
  // C-18 / C-19 / C-20 (Astra, 2026-09-12): the open note's flags, the
  // notes around it, and what JARVIS found in it.
  const [noteFlags, setNoteFlags] = useState<{ pinned: boolean; archived: boolean; tags: string[] }>({ pinned: false, archived: false, tags: [] });
  const [linkedFrom, setLinkedFrom] = useState<{ id: string; title: string }[]>([]);
  const [related, setRelated] = useState<{ id: string; title: string; shared: number }[]>([]);
  const [found, setFound] = useState<import("./types").FoundCandidate[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const ai = useAI();
  const decisionsSvc = useOptionalDecisions();
  // The text length the last JARVIS Found pass ran at, per open note.
  const passLenRef = useRef<number>(-1);
  const passingRef = useRef(false);
  // HMN-F-18: which of them point at something that is no longer there.
  const [goneConns, setGoneConns] = useState<Set<string>>(new Set());
  // The connection strip's "+" (Dave 2026-08-28) reaches LinkPicker directly
  // from the editor, not just through Connections -- so LinkPicker needs to
  // know which screen sent it, to come back to that one rather than always
  // landing on Connections.
  const [linkReturnTo, setLinkReturnTo] = useState<Screen>("connections");
  const [linkEvents, setLinkEvents] = useState<{ id: string; title: string }[]>([]);
  const [linkTasks, setLinkTasks] = useState<{ id: string; text: string }[]>([]);
  // The picker has always been able to render these; nothing ever loaded them,
  // so "Add Link" could only ever reach events and tasks.
  const [linkProjects, setLinkProjects] = useState<{ id: string; title: string }[]>([]);
  const [linkGoals, setLinkGoals] = useState<{ id: string; title: string }[]>([]);
  const [linkPeople, setLinkPeople] = useState<{ id: string; name: string }[]>([]);
  const [linkNotes, setLinkNotes] = useState<{ id: string; title: string }[]>([]);
  const seeded = useRef(false);
  // Optional, not required: several tests and the standalone Notes harness
  // mount this flow without a ProfileProvider, and a one-time cleanup is not
  // worth making the whole screen refuse to render.
  const profile = useOptionalProfile();
  // Guards the one-time unfiling against a second run within this mount (the
  // effect re-runs when its deps change). The PROFILE flag is what makes it
  // once per account; this ref only stops two runs racing each other before
  // the first has written that flag.
  const unfiled = useRef(false);

  const loadList = useCallback(async () => {
    const items = await svc.listNotes();
    setList(
      items.map((it) => {
        const d = it.data as unknown as NoteData;
        // WHEN IT WAS LAST TOUCHED (Notes and Money catalog, 2026-09-02).
        // The store's server time is the row's updated_at as epoch millis in
        // production and a bare counter in the in-memory store, so only a
        // value that reads as a real date (past 2001) is one; anything else
        // is "unknown" and the row shows no date rather than a wrong one.
        const edited = it.serverTime > 1e12 ? it.serverTime : 0;
        return {
          id: it.id, title: d.title || "Untitled", edited, category: d.category || "", first: firstLine(d.blocks), body: noteBlockText(d),
          // C-18 / C-20
          ...(d.pinned ? { pinned: true } : {}), ...(d.archived ? { archived: true } : {}), ...(d.tags?.length ? { tags: d.tags } : {}),
          ...((d.found ?? []).some((c) => !c.added) ? { found: (d.found ?? []).filter((c) => !c.added).length } : {}),
        };
      }),
    );
  }, [svc]);

  // HMN-F-18 (2026-09-05): nothing listens for entity deletion to clean a
  // note's connections, so a note linked to a task deleted three weeks ago
  // kept a live-looking chip: tapping it switched to the Tasks tab and opened
  // nothing, with nothing said. Only the person branch of navigateToEntity
  // ever checked (AppShell.tsx:129-152), and it returned in silence.
  //
  // The link is not deleted with the thing it pointed at: the note is a
  // record of what was connected, and a chip that quietly disappears is a
  // worse lie than one that says what happened. It is marked instead, and a
  // marked link does not pretend to be tappable.
  //
  // A read that FAILS is not a deletion: on a bad connection every link is
  // left alone rather than headstoned.
  const targetGone = useCallback(
    async (kind: string, targetId: string): Promise<boolean> => {
      try {
        if (kind === "task") return !(await tasksSvc.task(targetId));
        if (kind === "event") return !(await schedSvc.event(targetId));
        if (kind === "project") return !(await projSvc.get(targetId));
        if (kind === "goal") return !(await goalSvc.get(targetId));
        if (kind === "person") return !(await peopleSvc.get(targetId));
      } catch { /* a read that failed says nothing about what exists */ }
      return false;
    },
    [tasksSvc, schedSvc, projSvc, goalSvc, peopleSvc],
  );

  const loadCurrent = useCallback(
    async (id: string) => {
      // Pull linked-task completions into the checklist first, so a task
      // checked off in Tasks shows checked here on open.
      await svc.reconcileChecklistTasks(id);
      const d = await svc.note(id);
      // Not the open note any more: he left it while this was in flight. The
      // editor used to show the old note's blocks while currentId was the new
      // one, so typing went to blocks the open note does not have and was
      // dropped, and Delete Note removed the note that was NOT on screen.
      if (currentIdRef.current !== id) return;
      setCurrent(d ? toEditorNote(d) : null);
      const cs = d?.connections ?? [];
      setConns(cs);
      if (d) {
        setNoteFlags({ pinned: !!d.pinned, archived: !!d.archived, tags: d.tags ?? [] });
        setFound(d.found ?? []);
        if (passLenRef.current < 0) passLenRef.current = passLength(d);
        // C-19: the notes around this one. Best effort; an empty list is the
        // honest fallback for a read that failed.
        void Promise.all([svc.notesLinkedTo(id), svc.relatedNotes(id)]).then(([from, rel]) => {
          if (currentIdRef.current !== id) return;
          setLinkedFrom(from.map((n) => ({ id: n.id, title: n.title })));
          setRelated(rel);
        }).catch(() => { /* the heads simply do not render */ });
      }
      // Where You Were (addendum item 6): the open note is the spot.
      if (d) recordSpot({ kind: "note", id, label: d.title || "Untitled" });
      const checked = await Promise.all(
        cs.map(async (c) => (c.targetId && (await targetGone(c.kind, c.targetId)) ? c.id : null)),
      );
      if (currentIdRef.current !== id) return;
      setGoneConns(new Set(checked.filter((x): x is string => !!x)));
    },
    [svc, targetGone],
  );

  // initial load (+ optional one-time demo seed)
  useEffect(() => {
    (async () => {
      const cl = await cats.list();
      setCatList(cl);
      if (seed && !seeded.current) {
        seeded.current = true;
        const existing = await svc.listNotes();
        if (__DEMO_SEED__ && existing.length === 0) {
          const { seedDemoNotes } = await import("../data/seedNotes");
          await seedDemoNotes(svc, cl);
        }
      }
      // THE GREAT UNFILING (2026-08-30), once per account, on the first Notes
      // open after this ships. Law 11 made new notes born unfiled; every note
      // written BEFORE that still carries the category the bug chose for it
      // (catList[0]), which is why the library looked uniformly pink.
      //
      // Demo builds are exempt: the demo library is seeded WITH deliberate
      // categories to show the colour system working, and unfiling it would
      // turn the showcase into a wall of yellow.
      //
      // Failure is silent by design. This is a nicety running behind a screen
      // he opened to read a note; a toast about a background migration he
      // never asked for would be worse than the smudged colours it fixes. The
      // flag is only set after the clear SUCCEEDS, so a failed run simply
      // tries again on the next open.
      if (!__DEMO_SEED__ && profile && !unfiled.current) {
        unfiled.current = true;
        try {
          const p = await profile.get();
          if (p && !p.notesUnfiled) {
            await svc.unfileAllNotes();
            await profile.save({ notesUnfiled: true });
          }
        } catch { /* retried on the next open */ }
      }
      await loadList();
    })();
  }, [seed, svc, cats, loadList, profile]);

  // UP-PLAT-06 (2026-09-06): a note written on the laptop shows up here
  // without a relaunch. useFreshLists shipped 2026-08-24 and only three
  // surfaces ever subscribed; the resume refresh and the Realtime channel
  // both speak through it, so every list surface has to be listening or the
  // repaint stops at the three that were.
  useFreshLists([ENTITY_NOTE], loadList);

  useEffect(() => {
    onChrome?.({ tabBar: screen === "list" });
  }, [screen, onChrome]);

  // HMN-F-20 (2026-09-05): three of these five reads had a fallback and two
  // did not, so on a bad connection the bare await threw inside
  // openLinkPicker and the tap on + or Add Link died where it stood: no
  // picker, no toast, nothing at all. All five fall back to an empty list
  // now, and a read that FAILED says so, because an empty Events section
  // otherwise reads as "you have no events", which is a different lie.
  const loadLinkables = useCallback(async () => {
    let failed = false;
    const fall = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => { failed = true; return [] as T[]; });
    const [ev, ts, pr, gl, pe] = await Promise.all([
      fall(schedSvc.listEvents()),
      fall(tasksSvc.listTasks()),
      fall(projSvc.list()),
      fall(goalSvc.list()),
      fall(peopleSvc.list()),
    ]);
    setLinkProjects(pr.map((p) => ({ id: p.id, title: (p.data as { title?: string }).title || "Untitled" })));
    setLinkGoals(gl.map((g) => ({ id: g.id, title: (g.data as { title?: string }).title || "Untitled" })));
    setLinkPeople(pe.map((p) => ({ id: p.id, name: (p.data as { name?: string }).name || "Someone" })));
    // C-19: the other live notes, for a note-to-note link.
    setLinkNotes(list.filter((n) => n.id !== currentIdRef.current && !n.archived).map((n) => ({ id: n.id, title: n.title })));
    // HMN-F-26 (2026-09-05): every event ever went into the picker, oldest
    // and newest mixed, so after a few months of real use the Events section
    // was hundreds of rows with no way to narrow them. A note is linked to
    // something near now: the window is the last 30 days onward, what is
    // coming first and what just happened after it. Undated events keep
    // their place at the end rather than being dropped.
    const today = todayISO();
    const from = addDays(today, -30);
    const dated = ev.map((e) => {
      const d = e.data as { title?: string; date?: string };
      return { id: e.id, title: d.title || "Untitled", date: d.date ?? "" };
    });
    const inWindow = dated.filter((e) => e.date >= from);
    const ahead = inWindow.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const behind = inWindow.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
    const undated = dated.filter((e) => !e.date);
    setLinkEvents([...ahead, ...behind, ...undated].map((e) => ({ id: e.id, title: e.title })));
    setLinkTasks(
      ts
        .filter((t) => !(t.data as { done?: boolean }).done)
        .map((t) => ({ id: t.id, text: (t.data as { text?: string }).text || "Untitled" })),
    );
    if (failed) showToast({ message: "Couldn't load · Check your connection" });
  }, [schedSvc, tasksSvc, projSvc, goalSvc, peopleSvc]);

  const openNote = async (id: string) => {
    history.current = [];
    redoStack.current = [];
    setHistTick((t) => t + 1);
    passLenRef.current = -1;
    setLinkedFrom([]); setRelated([]); setFound([]);
    openCurrentId(id);
    await loadCurrent(id);
    setScreen("editor");
  };

  // When arriving from another screen (e.g. a project's Linked Notes), open that
  // note once on mount.
  useEffect(() => {
    if (!openId) return;
    void openNote(openId);
    onOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, openNonce]);

  const pickTemplate = async (key: TemplateKey) => {
    let id: string | null = null;
    await attemptWrite(async () => {
      // NO SILENT FILING (Dave 2026-08-29). This passed defaultCatId --
      // whatever category happens to sort first -- so every note was born
      // wearing a category nobody chose, and the list's "color-coded" icons
      // were really one color: the first category's. A new note starts
      // unfiled; choosing its home is the editor's job, on the user's tap.
      id = await svc.createNote(TEMPLATE_TITLE[key], "");
      if (id && key !== "blank") await svc.applyTemplate(id, key);
    });
    if (!id) return;
    openCurrentId(id);
    await loadCurrent(id);
    setScreen("editor");
  };

  // A PHOTO OR FILE WITH REAL BYTES (Dave 2026-09-02: "fully wired"). The
  // Photo and File blocks used to add a placeholder that said "Photo" and
  // held nothing. Now they open the phone's own sheet (camera, library,
  // files); the bytes go to the user's private storage under the note's
  // id and the block carries the path, so the editor can show the picture
  // and open the file. Same door from the list page: the clip in the bar
  // makes a note titled after the file and opens it.
  const fileStore = useFileStore();
  const [uploading, setUploading] = useState(false);
  const pendingPick = useRef<{ noteId: string | null; type: "photo" | "file" }>({ noteId: null, type: "photo" });
  const attachFile = async (noteId: string, file: File, type: "photo" | "file"): Promise<boolean> => {
    if (!fileStore) return false;
    setUploading(true);
    try {
      const stored = await fileStore.upload(noteId, file);
      const kind: "photo" | "file" = type === "photo" || stored.mime.startsWith("image/") ? "photo" : "file";
      // The upload runs outside the write queue (it can take a while and a
      // blur-save should not wait on it); only the block write is queued.
      let ok = false;
      await enqueue(async () => {
        await snap();
        ok = await attemptWrite(() => svc.addBlock(noteId, {
          type: kind, name: stored.name, size: sizeLabel(stored.bytes), path: stored.path, mime: stored.mime,
        }));
      });
      if (!ok) { void fileStore.remove([stored.path]); return false; }
      return true;
    } catch (e) {
      showToast({ message: e instanceof Error && e.message ? e.message : "Couldn't upload that file." });
      return false;
    } finally {
      setUploading(false);
    }
  };
  const onPicked = async (file: File) => {
    const { noteId, type } = pendingPick.current;
    if (noteId) {
      // Into the open note.
      const ok = await attachFile(noteId, file, type);
      await enqueue(() => loadCurrent(noteId));
      if (ok) showToast({ message: type === "photo" ? "Photo added" : "File added" });
      return;
    }
    // From the list: a new note, titled after the file, opened on the file.
    let id: string | null = null;
    await attemptWrite(async () => { id = await svc.createNote(fileStem(file.name), ""); });
    if (!id) return;
    const ok = await attachFile(id, file, file.type.startsWith("image/") ? "photo" : "file");
    if (!ok) { await attemptWrite(() => svc.deleteNote(id!)); await loadList(); return; }
    openCurrentId(id);
    await loadCurrent(id);
    setScreen("editor");
  };
  const picker = usePickFile((f) => void onPicked(f));
  const pickInto = (noteId: string | null, type: "photo" | "file") => {
    pendingPick.current = { noteId, type };
    picker.open(type === "photo" ? PICK_IMAGE : PICK_ANY);
  };

  const addBlock = async (type: BlockType) => {
    if (!currentId) return;
    if ((type === "photo" || type === "file") && fileStore) {
      setAddBlockOpen(false);
      pickInto(currentId, type);
      return;
    }
    setAddBlockOpen(false);
    await enqueue(async () => {
      // NO TWIN FOR AN EMPTY LINE (2026-09-13): the note's last block is
      // already this exact still-blank starter -- a double-tap on the chip,
      // or a tap right after the ready-to-type line primed one for a brand
      // new note -- so the tap refocuses it rather than appending a second,
      // indistinguishable placeholder row nobody could tell apart on sight.
      // Read fresh off the service, inside the queue, rather than trusting
      // React's `current`: a blur-save queued moments earlier by the same
      // gesture (HMN-F-01) has landed by the time this runs, and `current`
      // has not necessarily caught up to it yet.
      const note = await svc.note(currentId);
      const blocks = note?.blocks ?? [];
      const tail = blocks[blocks.length - 1];
      if (tail && tail.type === type && isBlankStarter(tail)) {
        setFocusBlockId(tail.id);
        return;
      }
      await snap();
      let newId: string | null = null;
      await attemptWrite(async () => { newId = await svc.addBlock(currentId, starterBlock(type)); });
      await loadCurrent(currentId);
      // Writing toolbar (V4): the caret lands in the block you just added.
      if (newId) setFocusBlockId(newId);
    });
  };

  // AN EMPTY NOTE OPENS READY TO TYPE (Dave 2026-09-09, from his phone: "in
  // notes there is nothing showing that you are ready to type on a line.
  // There's no blinking line or anything. That's the most standard typing
  // feature ever.")
  //
  // He is describing the blank note exactly as it opened: a title, a dashed
  // +, and the words "Nothing here yet". There was no line, so there was no
  // caret to blink in it -- before you could type a single character you had
  // to know that the chips along the bottom (Text, Heading, List) were how a
  // page gets its first line. Every notes app anyone has used opens with the
  // caret already in the body, and the reason is that a blank page asking to
  // be configured is not a blank page.
  //
  // So a note with nothing in it gets one empty text block, and the caret
  // goes in it. It writes a real block rather than faking a line, because a
  // fake one has to become real on the first keystroke and that seam is where
  // the first character of a thought gets dropped.
  //
  // Three deliberate details:
  //   - once per note id, so deleting the last block leaves the page empty.
  //     Deleting the line you are on is an instruction, not a state to undo.
  //   - outside the undo history (no snap()), so the first Undo in a new note
  //     is the writer's first edit and never the line itself vanishing.
  //   - it waits for `current`, so it sees the note's real blocks and cannot
  //     fire against a stale empty render.
  const primedNote = useRef<string | null>(null);
  useEffect(() => {
    if (screen !== "editor" || !currentId || !current) return;
    if (current.blocks.length > 0 || primedNote.current === currentId) return;
    primedNote.current = currentId;
    const id = currentId;
    void enqueue(async () => {
      let newId: string | null = null;
      await attemptWrite(async () => { newId = await svc.addBlock(id, starterBlock("text")); });
      await loadCurrent(id);
      if (newId) setFocusBlockId(newId);
    });
  }, [screen, currentId, current, enqueue, attemptWrite, svc, loadCurrent]);

  // The swipe's File: an area, or "" to unfile. Closes on the pick.
  const [filing, setFiling] = useState<string | null>(null);
  const fileUnder = async (id: string, category: string) => {
    setFiling(null);
    const ok = await attemptWrite(() => svc.fileUnder(id, category));
    if (ok) await loadList();
  };

  // What a deleted note leaves in storage goes a beat after the note, so
  // Undo can bring the note back with its pictures; Undo cancels the sweep.
  const sweepAfter = (ids: string[]): { cancel: () => void } => {
    let undone = false;
    const t = setTimeout(() => { if (!undone) for (const id of ids) void fileStore?.removeAll(id); }, 6000);
    return { cancel: () => { undone = true; clearTimeout(t); } };
  };

  // HMN-F-27 (2026-09-05): deleting a photo or file BLOCK took the block and
  // left its bytes in storage forever, so a note edited over a year quietly
  // grew a pile nobody could see or reach. The note delete has had this sweep
  // since the day it shipped; the block delete never got one. Same beat, same
  // reason: the editor's Undo brings the block back WITH its picture, so the
  // bytes cannot go the instant the block does.
  const blockSweeps = useRef<Array<() => void>>([]);
  const sweepPathAfter = (path: string) => {
    let undone = false;
    const cancel = () => { undone = true; clearTimeout(t); };
    const t = setTimeout(() => {
      blockSweeps.current = blockSweeps.current.filter((c) => c !== cancel);
      if (!undone) void fileStore?.remove([path]);
    }, 6000);
    blockSweeps.current.push(cancel);
  };
  // Any Undo cancels every sweep still waiting: the history restores the
  // whole blocks array, so which block came back is not this layer's to
  // guess, and keeping bytes for a picture nobody wants costs a great deal
  // less than losing the picture.
  const cancelBlockSweeps = () => {
    for (const c of blockSweeps.current) c();
    blockSweeps.current = [];
  };

  const openLinkPicker = async (from: Screen) => {
    await loadLinkables();
    setLinkReturnTo(from);
    setScreen("linkPicker");
  };

  // CREATE AND LINK IN ONE STEP (LinkPicker catalog pick, 2026-09-0X). The
  // picker only ever offered what already existed; this makes the thing on
  // the spot, with only the one field the picker itself can honestly ask
  // for, and links it to the open note the same way a pick from the list
  // always has. Everything else about it (a due date, a time, an area) is
  // exactly what its own screen already asks for -- unset here, editable
  // there the moment it exists.
  const [quickCreate, setQuickCreate] = useState<QuickCreateKind | null>(null);
  const runQuickCreate = async (title: string) => {
    const kind = quickCreate;
    if (!kind) return;
    let id: string | null = null;
    await attemptWrite(async () => {
      if (kind === "task") id = await tasksSvc.createTask(title);
      else if (kind === "event") id = await schedSvc.createEvent(title, { date: todayISO(), start: nextHalfHour() });
      else if (kind === "project") id = await projSvc.create({ title, status: "active" });
      else if (kind === "person") id = await peopleSvc.create({ name: title, group: "contacts" });
      else if (kind === "goal") id = await goalSvc.create({ title, state: "on_track" });
    });
    setQuickCreate(null);
    if (id && currentId) {
      await enqueue(async () => {
        await attemptWrite(() => svc.addConnection(currentId, kind, title, id!));
        await loadCurrent(currentId);
      });
    }
    setScreen(linkReturnTo);
  };

  // HMN-F-14 (2026-09-05): the note is re-read before the editor comes
  // back, so the linked-task badges and the new connection chips are there
  // on arrival rather than on the next reopen.
  const runCreateTasks = async () => {
    if (!currentId) return;
    await enqueue(async () => {
      await attemptWrite(() => svc.tasksFromChecklist(currentId));
      await loadCurrent(currentId);
    });
    setScreen("editor");
  };

  // UP-CORE-16 (2026-09-05): ONE LINE, ONE TASK. Meeting notes produce
  // action items one at a time and the bulk screen three taps away makes
  // tasks out of the whole list, which is why the one line that is actually
  // an action stayed in the note. Through the same serialised queue every
  // other block write uses (HMN-F-01), so the promotion cannot race the
  // blur-save of the line being typed in.
  const promoteCheckItem = (blockId: string, index: number) => enqueue(async () => {
    if (!currentId) return;
    const noteId = currentId;
    await snap();
    // BROWSER-F-01's lesson (2026-09-05), which this file is one line away
    // from repeating: attemptWrite resolves a BOOLEAN, never the write's own
    // value, so the new id is caught inside the closure.
    const made: { id: string | null } = { id: null };
    const ok = await attemptWrite(async () => { made.id = await svc.taskFromChecklistItem(noteId, blockId, index); });
    await loadCurrent(noteId);
    // No task, no toast: taskFromChecklistItem answers null when there was
    // nothing to promote (a blank line, or one already linked), and a failed
    // write has already said so in its own toast.
    const taskId = made.id;
    if (!ok || !taskId) return;
    showToast({
      message: "Made it a task",
      actionLabel: "Undo",
      onAction: () => void enqueue(async () => {
        await attemptWrite(async () => {
          await tasksSvc.deleteTask(taskId);
          await svc.unlinkChecklistItem(noteId, blockId, index);
        });
        await loadCurrent(noteId);
      }),
    });
  });

  const editTitle = (text: string) => enqueue(async () => {
    if (!currentId) return;
    if (text) await attemptWrite(() => svc.editTitle(currentId, text)); // ignore empty, revert on reload
    await loadCurrent(currentId);
  });
  const editBlockText = (blockId: string, text: string) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.editBlock(currentId, blockId, { text }));
    await loadCurrent(currentId);
    void maybeFind(currentId);
  });

  // C-20: JARVIS FOUND. After a blur-save, when the note's text has moved
  // by more than PASS_DELTA characters since the last pass, one structured
  // call, in the background, never awaited by the editor. Gated on AI.
  const maybeFind = async (noteId: string) => {
    if (!ai.available || passingRef.current) return;
    const d = await svc.note(noteId);
    if (!d) return;
    const len = passLength(d);
    if (passLenRef.current >= 0 && Math.abs(len - passLenRef.current) <= PASS_DELTA) return;
    passingRef.current = true;
    try {
      const [pe, pr] = await Promise.all([peopleSvc.list().catch(() => []), projSvc.list().catch(() => [])]);
      const cands = await findInNote(ai, d, pe.map((p) => ({ id: p.id, name: p.data.name })), pr.map((p) => ({ id: p.id, title: p.data.title })));
      passLenRef.current = len;
      // Keep what he already added; drop the rest for the fresh read.
      const kept = (d.found ?? []).filter((c) => c.added);
      const fresh = cands.filter((c) => !kept.some((k) => k.kind === c.kind && (k.targetId ? k.targetId === c.targetId : k.text.toLowerCase() === c.text.toLowerCase())));
      await svc.setFound(noteId, [...kept, ...fresh]);
      if (currentIdRef.current === noteId) setFound([...kept, ...fresh]);
      await loadList();
    } catch { /* silence beats a guess */ } finally {
      passingRef.current = false;
    }
  };

  // C-20: the two taps. Add writes the task or the decision with the note
  // as its source; Link writes the connection. Receipt with Undo; the
  // candidate is marked used and leaves the head.
  const foundAdd = async (index: number) => {
    if (!currentId) return;
    const c = found[index];
    if (!c) return;
    const noteId = currentId;
    if (c.kind === "task") {
      let id: string | null = null;
      const ok = await attemptWrite(async () => { id = await tasksSvc.createTask(c.text, { source: { type: "note", ref: noteId, ts: Date.now() }, fromNote: noteId }); });
      if (!ok || !id) return;
      const taskId: string = id;
      await attemptWrite(() => svc.markFoundAdded(noteId, index));
      await loadCurrent(noteId);
      showToast({ message: "Task added", actionLabel: "Undo", onAction: () => void (async () => { await attemptWrite(() => tasksSvc.deleteTask(taskId)); await attemptWrite(() => svc.markFoundAdded(noteId, index, false)); await loadCurrent(noteId); })() });
    } else if (c.kind === "decision" && decisionsSvc) {
      let id: string | null = null;
      const ok = await attemptWrite(async () => { id = await decisionsSvc.create({ decision: c.text, source: { kind: "note", entityId: noteId, at: new Date().toISOString() } }); });
      if (!ok || !id) return;
      const decId: string = id;
      await attemptWrite(() => svc.markFoundAdded(noteId, index));
      await loadCurrent(noteId);
      showToast({ message: "Decision saved", actionLabel: "Undo", onAction: () => void (async () => { await attemptWrite(() => decisionsSvc.remove(decId)); await attemptWrite(() => svc.markFoundAdded(noteId, index, false)); await loadCurrent(noteId); })() });
    }
  };
  const foundLink = async (index: number) => {
    if (!currentId) return;
    const c = found[index];
    if (!c || !c.targetId || (c.kind !== "person" && c.kind !== "project")) return;
    const noteId = currentId;
    const ok = await attemptWrite(() => svc.addConnection(noteId, c.kind, c.text, c.targetId!));
    if (!ok) return;
    await attemptWrite(() => svc.markFoundAdded(noteId, index));
    await loadCurrent(noteId);
    showToast({ message: "Linked", actionLabel: "Undo", onAction: () => void (async () => {
      const d = await svc.note(noteId);
      const conn = (d?.connections ?? []).find((x) => x.kind === c.kind && x.targetId === c.targetId);
      if (conn) await attemptWrite(() => svc.removeConnection(noteId, conn.id));
      await attemptWrite(() => svc.markFoundAdded(noteId, index, false));
      await loadCurrent(noteId);
    })() });
  };

  // C-18: pin, archive, tags. Flags, with receipts. Archive leaves the note.
  const togglePin = async () => {
    if (!currentId) return;
    const next = !noteFlags.pinned;
    const ok = await attemptWrite(() => svc.setPinned(currentId, next));
    if (!ok) return;
    setNoteFlags((f) => ({ ...f, pinned: next }));
    await loadList();
    showToast({ message: next ? "Pinned" : "Unpinned" });
  };
  const toggleArchive = async () => {
    if (!currentId) return;
    const id = currentId;
    const next = !noteFlags.archived;
    const ok = await attemptWrite(() => svc.setArchived(id, next));
    if (!ok) return;
    setNoteFlags((f) => ({ ...f, archived: next }));
    await loadList();
    if (next) {
      openCurrentId(null);
      setScreen("list");
      showToast({ message: "Archived", actionLabel: "Undo", onAction: () => void (async () => { await attemptWrite(() => svc.setArchived(id, false)); await loadList(); })() });
    } else {
      showToast({ message: "Back in your notes" });
    }
  };
  const saveTags = async (tags: string[]) => {
    if (!currentId) return;
    const ok = await attemptWrite(() => svc.setTags(currentId, tags));
    if (!ok) return;
    setNoteFlags((f) => ({ ...f, tags: [...new Set(tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean))] }));
    await loadList();
  };
  const toggleCheck = (blockId: string, index: number) => enqueue(async () => {
    if (!currentId) return;
    await attemptWrite(() => svc.toggleChecklistItem(currentId, blockId, index));
    await loadCurrent(currentId);
  });
  const editCheckItem = (blockId: string, index: number, text: string) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.setChecklistItemText(currentId, blockId, index, text));
    await loadCurrent(currentId);
  });
  const addCheckItem = (blockId: string) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.addChecklistItem(currentId, blockId));
    await loadCurrent(currentId);
  });
  const deleteCheckItem = (blockId: string, index: number) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.deleteChecklistItem(currentId, blockId, index));
    await loadCurrent(currentId);
  });
  const moveBlockDir = (blockId: string, dir: -1 | 1) => enqueue(async () => {
    if (!currentId) return;
    // Positions come from the FRESH note: an edit queued ahead of this may
    // have shifted them since the menu was drawn.
    const blocks = (await svc.note(currentId))?.blocks ?? [];
    const i = blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    await snap();
    await attemptWrite(() => svc.moveBlock(currentId, i, j));
    await loadCurrent(currentId);
  });
  const deleteBlock = (blockId: string) => enqueue(async () => {
    if (!currentId) return;
    await snap();
    // HMN-F-27: the path comes from the FRESH note, and only a delete that
    // actually happened schedules the sweep of what it pointed at.
    const path = (await svc.note(currentId))?.blocks.find((b) => b.id === blockId)?.path;
    const ok = await attemptWrite(() => svc.deleteBlock(currentId, blockId));
    await loadCurrent(currentId);
    if (ok && path) sweepPathAfter(path);
  });

  // Turn Into (deep writing pass): a text or heading block converts to any
  // simple type in place; its words become the first item where items rule.
  const turnInto = (blockId: string, type: TurnIntoType) => enqueue(async () => {
    if (!currentId) return;
    // The words come from the fresh note so a blur-save queued just ahead of
    // the menu tap is what gets converted, not the text from before it.
    const b = (await svc.note(currentId))?.blocks.find((x) => x.id === blockId);
    if (!b || (b.type !== "text" && b.type !== "heading" && b.type !== "quote" && b.type !== "callout")) return;
    const words = b.text ?? "";
    await snap();
    await attemptWrite(async () => {
      // C-17: a quote or a callout keeps its words; a divider drops them.
      if (type === "text" || type === "heading" || type === "quote" || type === "callout") await svc.editBlock(currentId, blockId, { type, text: words, items: undefined });
      else if (type === "divider") await svc.editBlock(currentId, blockId, { type, text: undefined, items: undefined });
      else if (type === "checklist") await svc.editBlock(currentId, blockId, { type, text: undefined, items: [{ text: words, done: false }] });
      else await svc.editBlock(currentId, blockId, { type, text: undefined, items: [words] });
    });
    await loadCurrent(currentId);
  });

  // The Tracker's table edits (deep template pass): cells patch in place,
  // Add Row grows downward, Add Column grows sideways. Row -1 is the header.
  // These were the first ops to run through the queue and read the FRESH
  // note inside it, because a cell's blur-save and an Add Row tap fire
  // back-to-back and two stale read-modify-writes clobbered each other
  // (found live). HMN-F-01 gave every other mutation the same treatment.
  const freshTable = async (blockId: string) => {
    if (!currentId) return null;
    const d = await svc.note(currentId);
    const b = d?.blocks.find((x) => x.id === blockId);
    if (!b || b.type !== "table") return null;
    return { columns: (b.columns ?? []).slice(), rows: (b.rows ?? []).map((r) => r.slice()) };
  };
  const tableEdit = (blockId: string, row: number, col: number, text: string) => enqueue(async () => {
    if (!currentId) return;
    const t = await freshTable(blockId);
    if (!t) return;
    await snap();
    await attemptWrite(async () => {
      if (row === -1) {
        t.columns[col] = text;
        await svc.editBlock(currentId, blockId, { columns: t.columns });
      } else {
        while (t.rows.length <= row) t.rows.push(Array<string>(t.columns.length).fill(""));
        t.rows[row]![col] = text;
        await svc.editBlock(currentId, blockId, { rows: t.rows });
      }
    });
    await loadCurrent(currentId);
  });
  const tableAddRow = (blockId: string) => enqueue(async () => {
    if (!currentId) return;
    const t = await freshTable(blockId);
    if (!t) return;
    await snap();
    await attemptWrite(() => svc.editBlock(currentId, blockId, { rows: [...t.rows, Array<string>(t.columns.length).fill("")] }));
    await loadCurrent(currentId);
  });
  const tableAddColumn = (blockId: string) => enqueue(async () => {
    if (!currentId) return;
    const t = await freshTable(blockId);
    if (!t) return;
    await snap();
    await attemptWrite(() => svc.editBlock(currentId, blockId, { columns: [...t.columns, ""], rows: t.rows.map((r) => [...r, ""]) }));
    await loadCurrent(currentId);
  });

  // Stack depth per screen: list is root, editor and templates sit above it,
  // connections above the editor, its two pickers above that.
  const NOTE_DEPTH: Record<Screen, number> = { list: 0, editor: 1, templates: 1, connections: 2, linkPicker: 3, createTasks: 3 };
  const pushCls = usePushDepth(NOTE_DEPTH[screen]);

  // BULK DELETE (Dave 2026-08-24). restoreNote is what makes the Undo whole
  // here: a note carries blocks, connections and a category, and recreating
  // one from its title would be a worse lie than not offering Undo at all.
  // Snapshots are read BEFORE anything is deleted, or by the time the toast
  // is tapped there is nothing left to read.
  const onDeleteManyNotes = async (ids: string[]) => {
    if (ids.length === 0) return;
    // HMN-F-15: each snapshot keeps its id, so Undo puts the note back under
    // it and everything that pointed at the note still opens it.
    const kept: { id: string; data: NoteData }[] = [];
    for (const id of ids) {
      const n = await svc.note(id);
      if (n) kept.push({ id, data: n });
    }
    let gone = 0;
    await attemptWrite(async () => { for (const id of ids) { await svc.deleteNote(id); gone++; } });
    await loadList();
    if (gone === 0) return;
    const n = gone;
    const sweep = sweepAfter(ids.slice(0, n));
    showToast({
      message: n === 1 ? "Note deleted" : n + " notes deleted",
      actionLabel: "Undo",
      onAction: async () => {
        sweep.cancel();
        await attemptWrite(async () => { for (const note of kept.slice(0, n)) await svc.restoreNote(note.data, note.id); });
        await loadList();
      },
    });
  };

  if (screen === "list") {
    return (
      <div className={pushCls} key="list">
      <NotesList
        notes={list}
        onOpen={openNote}
        onNewNote={() => setScreen("templates")}
        onAddFile={fileStore ? () => pickInto(null, "file") : undefined}
        uploading={uploading}
        onDeleteMany={onDeleteManyNotes}
        onDelete={(id) => void onDeleteManyNotes([id])}
        onFile={(id) => setFiling(id)}
      />
      {picker.input}
      {/* FILE UNDER (the swipe's File, 2026-09-02): the areas as rows with
          their dots, Not Filed to clear. One tap files and closes. */}
      {filing && (
        <FormSheet title="File Under" onCancel={() => setFiling(null)} onSave={() => setFiling(null)} saveLabel="Done">
          <Group label="Area">
            {[{ id: "", name: "Not Filed", color: "yellow" }, ...catList.map((c) => ({ id: c.id, name: catName(c.id), color: c.data.color as string }))].map((a) => {
              const cur = list.find((n) => n.id === filing)?.category ?? "";
              return (
                <Row key={a.id || "none"} label={a.name} onClick={() => void fileUnder(filing, a.id)}>
                  <span className={"cat-dot cat-bg-" + a.color} />
                  {cur === a.id && <Check className="ic file-under-tick" />}
                </Row>
              );
            })}
          </Group>
        </FormSheet>
      )}
      </div>
    );
  }
  if (screen === "templates") {
    return <div className={pushCls} key="templates"><Templates onSelect={pickTemplate} onBack={() => setScreen("list")} /></div>;
  }
  if (screen === "connections") {
    const cat = current?.category ?? defaultCatId;
    return (
      <div className={pushCls} key="connections">
      <Connections
        category={cat}
        // HMN-F-17 (2026-09-05): a note is born unfiled, its category is the
        // empty string, and `catName("")` is "": the Area row read "Area"
        // with nothing beside it. Unfiled is a state with a name, the one
        // the list already uses.
        categoryLabel={cat ? catName(cat) : "Not Filed"}
        connections={conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, targetId: c.targetId, gone: goneConns.has(c.id) }))}
        onBack={() => setScreen("editor")}
        onAddLink={() => void openLinkPicker("connections")}
        onRemove={(connId) => enqueue(async () => {
          if (!currentId) return;
          await attemptWrite(() => svc.removeConnection(currentId, connId));
          await loadCurrent(currentId);
        })}
        categories={catList.map((c) => ({ id: c.id, name: catName(c.id) }))}
        onChangeCategory={(categoryId) => enqueue(async () => {
          if (!currentId) return;
          // HMN-F-17: setCategory refuses "" (NotesService.ts:66-70), which
          // is exactly what the picker's Not Filed row sends. fileUnder is
          // the write that takes it, and it is the one the swipe File sheet
          // has always used for the same choice.
          await attemptWrite(() => svc.fileUnder(currentId, categoryId));
          await loadCurrent(currentId);
        })}
        onCreateTasks={() => setScreen("createTasks")}
        onOpen={(kind, targetId) => onNavigate?.(kind, targetId)}
      />
      </div>
    );
  }
  if (screen === "linkPicker") {
    return (
      <div className={pushCls} key="linkPicker">
      <LinkPicker
        events={linkEvents}
        eventsFloor="That's every event from the last 30 days on."
        tasks={linkTasks}
        projects={linkProjects}
        goals={linkGoals}
        people={linkPeople}
        notes={linkNotes}
        onPick={async (kind, label, targetId) => {
          if (currentId) {
            await enqueue(async () => {
              await attemptWrite(() => svc.addConnection(currentId, kind, label, targetId));
              await loadCurrent(currentId);
            });
          }
          setScreen(linkReturnTo);
        }}
        onCreateNew={(kind) => setQuickCreate(kind)}
        onBack={() => setScreen(linkReturnTo)}
      />
      {quickCreate && (
        <QuickCreateSheet kind={quickCreate} onCreate={(title) => void runQuickCreate(title)} onCancel={() => setQuickCreate(null)} />
      )}
      </div>
    );
  }
  if (screen === "createTasks") {
    const checklist = current?.blocks.find((b) => b.type === "checklist");
    const items =
      checklist && checklist.type === "checklist"
        ? checklist.items.filter((i) => !i.done).map((i) => ({ text: i.text, due: "", urgency: "muted" as const }))
        : [];
    const cat = current?.category ?? defaultCatId;
    return (
      <div className={pushCls} key="createTasks">
      <CreateTasks
        category={cat}
        categoryLabel={catName(cat)}
        // HMN-F-16 (2026-09-05): the flow wired only `items`, so the header
        // said From "This Week" for every note in the app.
        source={current?.title || "Untitled"}
        items={items}
        onCreate={runCreateTasks}
        onBack={() => setScreen("connections")}
      />
      </div>
    );
  }
  // editor
  return (
    <div className={pushCls} key="editor">
      {current && (
        <NoteEditor
          fileStore={fileStore}
          focusBlockId={focusBlockId}
          onEnterAt={enterAt}
          onBackspaceAt={backspaceAt}
          onTransformAt={transformAt}
          onListItems={listItems}
          onListExit={listExit}
          note={current}
          onBack={() => { setScreen("list"); loadList(); }}
          onConnections={() => setScreen("connections")}
          onDeleteNote={async () => {
            if (!currentId) return;
            // The app's one convention for destructive actions: do it, offer
            // Undo in the toast (tasks set the pattern). This was the last
            // window.confirm dialog on a destructive path; a native popup
            // asking "are you sure?" is exactly the interrogation the rest of
            // the app refuses to do (audit 2026-08-07).
            // Queued behind any block save still in flight, so the snapshot
            // Undo restores carries the last thing typed.
            let snapshot: NoteData | null = null;
            let ok = false;
            await enqueue(async () => {
              snapshot = await svc.note(currentId);
              ok = await attemptWrite(() => svc.deleteNote(currentId));
            });
            if (!ok) return;
            const kept: NoteData | null = snapshot;
            const deletedId = currentId;
            const sweep = sweepAfter([currentId]);
            openCurrentId(null);
            await loadList();
            setScreen("list");
            showToast({
              message: "Note deleted",
              actionLabel: "Undo",
              onAction: async () => {
                sweep.cancel();
                // HMN-F-15: back under the same id, so the tasks made from
                // its checklist and the Where You Were spot still open it.
                if (kept) await attemptWrite(() => svc.restoreNote(kept, deletedId));
                await loadList();
              },
            });
          }}
          onAddBlock={() => setAddBlockOpen(true)}
          onAddTyped={(t) => void addBlock(t)}
          pinned={noteFlags.pinned}
          archived={noteFlags.archived}
          tags={noteFlags.tags}
          onPin={() => void togglePin()}
          onArchive={() => void toggleArchive()}
          onTags={() => { setTagDraft(""); setTagsOpen(true); }}
          linkedFrom={linkedFrom}
          related={related}
          onOpenNote={(id) => void openNote(id)}
          found={found}
          onFoundAdd={(i) => void foundAdd(i)}
          onFoundLink={(i) => void foundLink(i)}
          onEditTitle={editTitle}
          onEditBlockText={editBlockText}
          onToggleCheck={toggleCheck}
          onEditCheckItem={editCheckItem}
          onAddCheckItem={addCheckItem}
          onDeleteCheckItem={deleteCheckItem}
          onPromoteCheckItem={promoteCheckItem}
          onMoveBlock={moveBlockDir}
          onDeleteBlock={deleteBlock}
          onTurnInto={(id, t) => void turnInto(id, t)}
          onTableEdit={(id, r, c, t) => void tableEdit(id, r, c, t)}
          onTableAddRow={(id) => void tableAddRow(id)}
          onTableAddColumn={(id) => void tableAddColumn(id)}
          onUndo={() => void undo()}
          onRedo={() => void redo()}
          canUndo={histTick >= 0 && history.current.length > 0}
          canRedo={histTick >= 0 && redoStack.current.length > 0}
          connections={conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, targetId: c.targetId, gone: goneConns.has(c.id) }))}
          onAddLink={() => void openLinkPicker("editor")}
          onRemoveConnection={(connId) => void enqueue(async () => {
            if (!currentId) return;
            await attemptWrite(() => svc.removeConnection(currentId, connId));
            await loadCurrent(currentId);
          })}
          onOpenConnection={(kind, targetId) => (kind === "note" ? void openNote(targetId) : onNavigate?.(kind, targetId))}
          onOpenTask={onNavigate ? (taskId) => onNavigate("task", taskId) : undefined}
          openSourceFor={openSourceFor}
        />
      )}
      {addBlockOpen && (
        <AddBlockSheet onSelect={addBlock} onCancel={() => setAddBlockOpen(false)} />
      )}
      {/* C-18: the tags sheet. Chips for the ones it has (tap removes), a
          line to add one. Saves on Done. */}
      {tagsOpen && (
        <FormSheet title="Tags" saveLabel="Done" onCancel={() => setTagsOpen(false)} onSave={() => { const next = tagDraft.trim() ? [...noteFlags.tags, tagDraft.trim()] : noteFlags.tags; void saveTags(next); setTagsOpen(false); }}>
          <Group label="Tags">
            {noteFlags.tags.length > 0 && (
              <Strip>
                {noteFlags.tags.map((t) => (
                  <div key={t} className="chip active" role="button" tabIndex={0} onClick={() => void saveTags(noteFlags.tags.filter((x) => x !== t))}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void saveTags(noteFlags.tags.filter((x) => x !== t)); } }}>#{t}</div>
                ))}
              </Strip>
            )}
            <FieldRow ariaLabel="New tag" placeholder="A word · Enter adds" value={tagDraft} onChange={setTagDraft}
              onEnter={() => { const t = tagDraft.trim(); if (t) { void saveTags([...noteFlags.tags, t]); setTagDraft(""); } }} />
          </Group>
        </FormSheet>
      )}
      {picker.input}
    </div>
  );
}

// seeds a few generic notes so the demo build is not empty, tagged by category id
