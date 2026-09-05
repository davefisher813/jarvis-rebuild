import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes, useCategories, useTasks, useSchedule, useProjects, useGoals, usePeople, useOptionalProfile, useFileStore } from "../data/NotesProvider";
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
import { FormSheet, Group, Row } from "../shared/FormSheet";
import { Check } from "../shared/icons";

import { attemptWrite } from "../shared/guard";
import { recordSpot } from "../restore/whereYouWere";
import CreateTasks from "./screens/CreateTasks";
import type { BlockType } from "./types";
import QuickCreateSheet, { nextHalfHour, type QuickCreateKind } from "./screens/QuickCreateSheet";
import { todayISO } from "../schedule/calendar";

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
  };
}

// a starter block for each add-block type
function starterBlock(type: BlockType): Omit<Block, "id"> {
  switch (type) {
    // Empty starters: the placeholder does the explaining and the first
    // keystroke is the writer's, not a delete of ours (deep writing pass).
    case "heading": return { type, text: "" };
    case "text": return { type, text: "" };
    case "meta": return { type, text: "" };
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
}: {
  seed?: boolean;
  onChrome?: (chrome: { tabBar: boolean }) => void;
  onNavigate?: (kind: string, targetId: string) => void;
  openId?: string;
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
  const [currentId, setCurrentId] = useState<string | null>(null);
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
        return { id: it.id, title: d.title || "Untitled", edited, category: d.category || "", first: firstLine(d.blocks), body: noteBlockText(d) };
      }),
    );
  }, [svc]);

  const loadCurrent = useCallback(
    async (id: string) => {
      // Pull linked-task completions into the checklist first, so a task
      // checked off in Tasks shows checked here on open.
      await svc.reconcileChecklistTasks(id);
      const d = await svc.note(id);
      setCurrent(d ? toEditorNote(d) : null);
      setConns(d?.connections ?? []);
      // Where You Were (addendum item 6): the open note is the spot.
      if (d) recordSpot({ kind: "note", id, label: d.title || "Untitled" });
    },
    [svc],
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

  useEffect(() => {
    onChrome?.({ tabBar: screen === "list" });
  }, [screen, onChrome]);

  const loadLinkables = useCallback(async () => {
    const ev = await schedSvc.listEvents();
    const ts = await tasksSvc.listTasks();
    const [pr, gl, pe] = await Promise.all([
      projSvc.list().catch(() => []),
      goalSvc.list().catch(() => []),
      peopleSvc.list().catch(() => []),
    ]);
    setLinkProjects(pr.map((p) => ({ id: p.id, title: (p.data as { title?: string }).title || "Untitled" })));
    setLinkGoals(gl.map((g) => ({ id: g.id, title: (g.data as { title?: string }).title || "Untitled" })));
    setLinkPeople(pe.map((p) => ({ id: p.id, name: (p.data as { name?: string }).name || "Someone" })));
    setLinkEvents(ev.map((e) => ({ id: e.id, title: (e.data as { title?: string }).title || "Untitled" })));
    setLinkTasks(
      ts
        .filter((t) => !(t.data as { done?: boolean }).done)
        .map((t) => ({ id: t.id, text: (t.data as { text?: string }).text || "Untitled" })),
    );
  }, [schedSvc, tasksSvc, projSvc, goalSvc, peopleSvc]);

  const openNote = async (id: string) => {
    history.current = [];
    redoStack.current = [];
    setHistTick((t) => t + 1);
    setCurrentId(id);
    await loadCurrent(id);
    setScreen("editor");
  };

  // When arriving from another screen (e.g. a project's Linked Notes), open that
  // note once on mount.
  useEffect(() => {
    if (openId) openNote(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

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
    setCurrentId(id);
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
    setCurrentId(id);
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
      await snap();
      let newId: string | null = null;
      await attemptWrite(async () => { newId = await svc.addBlock(currentId, starterBlock(type)); });
      await loadCurrent(currentId);
      // Writing toolbar (V4): the caret lands in the block you just added.
      if (newId) setFocusBlockId(newId);
    });
  };

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
  });
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
    await attemptWrite(() => svc.deleteBlock(currentId, blockId));
    await loadCurrent(currentId);
  });

  // Turn Into (deep writing pass): a text or heading block converts to any
  // simple type in place; its words become the first item where items rule.
  const turnInto = (blockId: string, type: "text" | "heading" | "bulleted_list" | "checklist") => enqueue(async () => {
    if (!currentId) return;
    // The words come from the fresh note so a blur-save queued just ahead of
    // the menu tap is what gets converted, not the text from before it.
    const b = (await svc.note(currentId))?.blocks.find((x) => x.id === blockId);
    if (!b || (b.type !== "text" && b.type !== "heading")) return;
    const words = b.text ?? "";
    await snap();
    await attemptWrite(async () => {
      if (type === "text" || type === "heading") await svc.editBlock(currentId, blockId, { type, text: words, items: undefined });
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
    const kept: NoteData[] = [];
    for (const id of ids) {
      const n = await svc.note(id);
      if (n) kept.push(n);
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
        await attemptWrite(async () => { for (const note of kept.slice(0, n)) await svc.restoreNote(note); });
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
        categoryLabel={catName(cat)}
        connections={conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, targetId: c.targetId }))}
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
          await attemptWrite(() => svc.setCategory(currentId, categoryId));
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
        tasks={linkTasks}
        projects={linkProjects}
        goals={linkGoals}
        people={linkPeople}
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
            const sweep = sweepAfter([currentId]);
            setCurrentId(null);
            await loadList();
            setScreen("list");
            showToast({
              message: "Note deleted",
              actionLabel: "Undo",
              onAction: async () => {
                sweep.cancel();
                if (kept) await attemptWrite(() => svc.restoreNote(kept));
                await loadList();
              },
            });
          }}
          onAddBlock={() => setAddBlockOpen(true)}
          onAddTyped={(t) => void addBlock(t)}
          onEditTitle={editTitle}
          onEditBlockText={editBlockText}
          onToggleCheck={toggleCheck}
          onEditCheckItem={editCheckItem}
          onAddCheckItem={addCheckItem}
          onDeleteCheckItem={deleteCheckItem}
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
          connections={conns}
          onAddLink={() => void openLinkPicker("editor")}
          onRemoveConnection={(connId) => void enqueue(async () => {
            if (!currentId) return;
            await attemptWrite(() => svc.removeConnection(currentId, connId));
            await loadCurrent(currentId);
          })}
          onOpenConnection={(kind, targetId) => onNavigate?.(kind, targetId)}
          onOpenTask={onNavigate ? (taskId) => onNavigate("task", taskId) : undefined}
        />
      )}
      {addBlockOpen && (
        <AddBlockSheet onSelect={addBlock} onCancel={() => setAddBlockOpen(false)} />
      )}
      {picker.input}
    </div>
  );
}

// seeds a few generic notes so the demo build is not empty, tagged by category id
