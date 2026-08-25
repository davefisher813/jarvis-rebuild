import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes, useCategories, useTasks, useSchedule, useProjects, useGoals, usePeople } from "../data/NotesProvider";
import { catName } from "../shared/categories";
import type { Category } from "../categories/types";
import type { Block, Connection, NoteData, TemplateKey } from "./types";
import NotesList, { type NoteListItem } from "./screens/NotesList";
import NoteEditor, { type EditorNote } from "./screens/NoteEditor";
import Templates from "./screens/Templates";
import { usePushDepth } from "../shared/pushNav";
import AddBlockSheet from "./screens/AddBlockSheet";
import Connections from "./screens/Connections";
import LinkPicker from "./screens/LinkPicker";
import { showToast } from "../shared/toast";

import { attemptWrite } from "../shared/guard";
import { recordSpot } from "../restore/whereYouWere";
import CreateTasks from "./screens/CreateTasks";
import type { BlockType } from "./types";

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
              typeof it === "string" ? { text: it, done: false } : it),
          };
        case "bulleted_list":
          return { id: b.id, type: "bulleted_list", items: (b.items ?? []).map((it) => typeof it === "string" ? it : it.text) };
        case "numbered_list":
          return { id: b.id, type: "numbered_list", items: (b.items ?? []).map((it) => typeof it === "string" ? it : it.text) };
        case "table": return { id: b.id, type: "table", header: b.columns ?? [], rows: b.rows ?? [] };
        case "file": return { id: b.id, type: "file", name: b.name ?? "File", size: b.size ?? "" };
        case "photo": return { id: b.id, type: "photo", name: b.name ?? "Photo", size: b.size ?? "" };
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
  const snap = async () => {
    if (!currentId) return;
    const d = await svc.note(currentId);
    if (!d) return;
    history.current.push(JSON.parse(JSON.stringify(d.blocks)) as Block[]);
    if (history.current.length > 50) history.current.shift();
    redoStack.current = [];
    setHistTick((t) => t + 1);
  };
  const undo = async () => {
    if (!currentId) return;
    const prev = history.current.pop();
    if (!prev) return;
    const d = await svc.note(currentId);
    if (d) redoStack.current.push(JSON.parse(JSON.stringify(d.blocks)) as Block[]);
    await attemptWrite(() => svc.setBlocks(currentId, prev));
    await loadCurrent(currentId);
    setHistTick((t) => t + 1);
  };
  const redo = async () => {
    if (!currentId) return;
    const next = redoStack.current.pop();
    if (!next) return;
    const d = await svc.note(currentId);
    if (d) history.current.push(JSON.parse(JSON.stringify(d.blocks)) as Block[]);
    await attemptWrite(() => svc.setBlocks(currentId, next));
    await loadCurrent(currentId);
    setHistTick((t) => t + 1);
  };
  const enterAt = async (blockId: string, text: string) => {
    if (!currentId) return;
    await snap();
    let newId: string | null = null;
    await attemptWrite(async () => {
      await svc.editBlock(currentId, blockId, { text });
      newId = await svc.insertBlockAfter(currentId, blockId, { type: "text", text: "" });
    });
    await loadCurrent(currentId);
    setFocusBlockId(newId);
  };
  const backspaceAt = async (blockId: string) => {
    if (!currentId || !current) return;
    await snap();
    const idx = current.blocks.findIndex((b) => b.id === blockId);
    const prev = [...current.blocks.slice(0, idx)].reverse().find((b) => b.type === "text" || b.type === "heading" || b.type === "meta");
    await attemptWrite(() => svc.deleteBlock(currentId, blockId));
    await loadCurrent(currentId);
    setFocusBlockId(prev?.id ?? null);
  };
  const transformAt = async (blockId: string, prefix: "#" | "[]" | "-" | "1.", rest: string) => {
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
  };
  const listItems = async (blockId: string, items: string[], focusKey: string | null) => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.editBlock(currentId, blockId, { items }));
    await loadCurrent(currentId);
    setFocusBlockId(focusKey);
  };
  const listExit = async (blockId: string, remaining: string[]) => {
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
  };
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [conns, setConns] = useState<Connection[]>([]);
  const [linkEvents, setLinkEvents] = useState<{ id: string; title: string }[]>([]);
  const [linkTasks, setLinkTasks] = useState<{ id: string; text: string }[]>([]);
  // The picker has always been able to render these; nothing ever loaded them,
  // so "Add Link" could only ever reach events and tasks.
  const [linkProjects, setLinkProjects] = useState<{ id: string; title: string }[]>([]);
  const [linkGoals, setLinkGoals] = useState<{ id: string; title: string }[]>([]);
  const [linkPeople, setLinkPeople] = useState<{ id: string; name: string }[]>([]);
  const seeded = useRef(false);

  const loadList = useCallback(async () => {
    const items = await svc.listNotes();
    setList(
      items.map((it) => {
        const d = it.data as unknown as NoteData;
        return { id: it.id, title: d.title || "Untitled", date: "", category: d.category || "" };
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
      await loadList();
    })();
  }, [seed, svc, cats, loadList]);

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
      id = await svc.createNote(TEMPLATE_TITLE[key], defaultCatId);
      if (id && key !== "blank") await svc.applyTemplate(id, key);
    });
    if (!id) return;
    setCurrentId(id);
    await loadCurrent(id);
    setScreen("editor");
  };

  const addBlock = async (type: BlockType) => {
    if (!currentId) return;
    await snap();
    let newId: string | null = null;
    await attemptWrite(async () => { newId = await svc.addBlock(currentId, starterBlock(type)); });
    setAddBlockOpen(false);
    await loadCurrent(currentId);
    // Writing toolbar (V4): the caret lands in the block you just added.
    if (newId) setFocusBlockId(newId);
  };

  const runCreateTasks = async () => {
    if (!currentId) return;
    await attemptWrite(() => svc.tasksFromChecklist(currentId));
    setScreen("editor");
  };

  const editTitle = async (text: string) => {
    if (!currentId) return;
    if (text) await attemptWrite(() => svc.editTitle(currentId, text)); // ignore empty, revert on reload
    await loadCurrent(currentId);
  };
  const editBlockText = async (blockId: string, text: string) => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.editBlock(currentId, blockId, { text }));
    await loadCurrent(currentId);
  };
  const toggleCheck = async (blockId: string, index: number) => {
    if (!currentId) return;
    await attemptWrite(() => svc.toggleChecklistItem(currentId, blockId, index));
    await loadCurrent(currentId);
  };
  const editCheckItem = async (blockId: string, index: number, text: string) => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.setChecklistItemText(currentId, blockId, index, text));
    await loadCurrent(currentId);
  };
  const addCheckItem = async (blockId: string) => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.addChecklistItem(currentId, blockId));
    await loadCurrent(currentId);
  };
  const deleteCheckItem = async (blockId: string, index: number) => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.deleteChecklistItem(currentId, blockId, index));
    await loadCurrent(currentId);
  };
  const moveBlockDir = async (blockId: string, dir: -1 | 1) => {
    if (!currentId || !current) return;
    await snap();
    const blocks = current.blocks;
    const i = blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    await attemptWrite(() => svc.moveBlock(currentId, i, j));
    await loadCurrent(currentId);
  };
  const deleteBlock = async (blockId: string) => {
    if (!currentId) return;
    await snap();
    await attemptWrite(() => svc.deleteBlock(currentId, blockId));
    await loadCurrent(currentId);
  };

  // Turn Into (deep writing pass): a text or heading block converts to any
  // simple type in place; its words become the first item where items rule.
  const turnInto = async (blockId: string, type: "text" | "heading" | "bulleted_list" | "checklist") => {
    if (!currentId || !current) return;
    const b = current.blocks.find((x) => x.id === blockId);
    if (!b || (b.type !== "text" && b.type !== "heading")) return;
    const words = ("text" in b ? b.text : "") ?? "";
    await snap();
    await attemptWrite(async () => {
      if (type === "text" || type === "heading") await svc.editBlock(currentId, blockId, { type, text: words, items: undefined });
      else if (type === "checklist") await svc.editBlock(currentId, blockId, { type, text: undefined, items: [{ text: words, done: false }] });
      else await svc.editBlock(currentId, blockId, { type, text: undefined, items: [words] });
    });
    await loadCurrent(currentId);
  };

  // The Tracker's table edits (deep template pass): cells patch in place,
  // Add Row grows downward, Add Column grows sideways. Row -1 is the header.
  // Every table op runs through one queue and reads the FRESH note inside
  // it, because a cell's blur-save and an Add Row tap fire back-to-back and
  // two stale read-modify-writes would clobber each other (found live).
  const tableQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueTable = (fn: () => Promise<void>): Promise<void> => {
    const next = tableQueue.current.then(fn, fn);
    tableQueue.current = next.catch(() => {});
    return next;
  };
  const freshTable = async (blockId: string) => {
    if (!currentId) return null;
    const d = await svc.note(currentId);
    const b = d?.blocks.find((x) => x.id === blockId);
    if (!b || b.type !== "table") return null;
    return { columns: (b.columns ?? []).slice(), rows: (b.rows ?? []).map((r) => r.slice()) };
  };
  const tableEdit = (blockId: string, row: number, col: number, text: string) => enqueueTable(async () => {
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
  const tableAddRow = (blockId: string) => enqueueTable(async () => {
    if (!currentId) return;
    const t = await freshTable(blockId);
    if (!t) return;
    await snap();
    await attemptWrite(() => svc.editBlock(currentId, blockId, { rows: [...t.rows, Array<string>(t.columns.length).fill("")] }));
    await loadCurrent(currentId);
  });
  const tableAddColumn = (blockId: string) => enqueueTable(async () => {
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
    showToast({
      message: n === 1 ? "Note deleted" : n + " notes deleted",
      actionLabel: "Undo",
      onAction: async () => {
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
        onDeleteMany={onDeleteManyNotes}
      />
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
        onAddLink={async () => { await loadLinkables(); setScreen("linkPicker"); }}
        onRemove={async (connId) => {
          if (!currentId) return;
          await attemptWrite(() => svc.removeConnection(currentId, connId));
          await loadCurrent(currentId);
        }}
        categories={catList.map((c) => ({ id: c.id, name: catName(c.id) }))}
        onChangeCategory={async (categoryId) => {
          if (!currentId) return;
          await attemptWrite(() => svc.setCategory(currentId, categoryId));
          await loadCurrent(currentId);
        }}
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
            await attemptWrite(() => svc.addConnection(currentId, kind, label, targetId));
            await loadCurrent(currentId);
          }
          setScreen("connections");
        }}
        onBack={() => setScreen("connections")}
      />
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
            const snapshot = await svc.note(currentId);
            const ok = await attemptWrite(() => svc.deleteNote(currentId));
            if (!ok) return;
            setCurrentId(null);
            await loadList();
            setScreen("list");
            showToast({
              message: "Note deleted",
              actionLabel: "Undo",
              onAction: async () => {
                if (snapshot) await attemptWrite(() => svc.restoreNote(snapshot));
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
        />
      )}
      {addBlockOpen && (
        <AddBlockSheet onSelect={addBlock} onCancel={() => setAddBlockOpen(false)} />
      )}
    </div>
  );
}

// seeds a few generic notes so the demo build is not empty, tagged by category id
