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
    case "heading": return { type, text: "Heading" };
    case "text": return { type, text: "New text" };
    case "checklist": return { type, items: [{ text: "New item", done: false }] };
    case "bulleted_list": return { type, items: ["Item"] };
    case "numbered_list": return { type, items: ["Item"] };
    case "table": return { type, columns: ["Col 1", "Col 2"], rows: [["", ""]] };
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
  const enterAt = async (blockId: string, text: string) => {
    if (!currentId) return;
    await svc.editBlock(currentId, blockId, { text });
    const newId = await svc.insertBlockAfter(currentId, blockId, { type: "text", text: "" });
    await loadCurrent(currentId);
    setFocusBlockId(newId);
  };
  const backspaceAt = async (blockId: string) => {
    if (!currentId || !current) return;
    const idx = current.blocks.findIndex((b) => b.id === blockId);
    const prev = [...current.blocks.slice(0, idx)].reverse().find((b) => b.type === "text" || b.type === "heading");
    await svc.deleteBlock(currentId, blockId);
    await loadCurrent(currentId);
    setFocusBlockId(prev?.id ?? null);
  };
  const transformAt = async (blockId: string, prefix: "#" | "[]" | "-" | "1.", rest: string) => {
    if (!currentId) return;
    if (prefix === "#") await svc.editBlock(currentId, blockId, { type: "heading", text: rest });
    else if (prefix === "[]") await svc.editBlock(currentId, blockId, { type: "checklist", text: undefined, items: [{ text: rest, done: false }] });
    else if (prefix === "-") await svc.editBlock(currentId, blockId, { type: "bulleted_list", text: undefined, items: [rest] });
    else await svc.editBlock(currentId, blockId, { type: "numbered_list", text: undefined, items: [rest] });
    await loadCurrent(currentId);
    setFocusBlockId(prefix === "#" ? blockId : prefix === "-" || prefix === "1." ? blockId + ":0" : null);
  };
  const listItems = async (blockId: string, items: string[], focusKey: string | null) => {
    if (!currentId) return;
    await svc.editBlock(currentId, blockId, { items });
    await loadCurrent(currentId);
    setFocusBlockId(focusKey);
  };
  const listExit = async (blockId: string, remaining: string[]) => {
    if (!currentId) return;
    if (remaining.length === 0) {
      await svc.editBlock(currentId, blockId, { type: "text", text: "", items: undefined });
      await loadCurrent(currentId);
      setFocusBlockId(blockId);
    } else {
      await svc.editBlock(currentId, blockId, { items: remaining });
      const newId = await svc.insertBlockAfter(currentId, blockId, { type: "text", text: "" });
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
        if (existing.length === 0) await seedDemoNotes(svc, cl);
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
    const id = await svc.createNote(TEMPLATE_TITLE[key], defaultCatId);
    if (!id) return;
    if (key !== "blank") await svc.applyTemplate(id, key);
    setCurrentId(id);
    await loadCurrent(id);
    setScreen("editor");
  };

  const addBlock = async (type: BlockType) => {
    if (!currentId) return;
    await svc.addBlock(currentId, starterBlock(type));
    setAddBlockOpen(false);
    await loadCurrent(currentId);
  };

  const runCreateTasks = async () => {
    if (!currentId) return;
    await svc.tasksFromChecklist(currentId);
    setScreen("editor");
  };

  const editTitle = async (text: string) => {
    if (!currentId) return;
    if (text) await svc.editTitle(currentId, text); // ignore empty, revert on reload
    await loadCurrent(currentId);
  };
  const editBlockText = async (blockId: string, text: string) => {
    if (!currentId) return;
    await svc.editBlock(currentId, blockId, { text });
    await loadCurrent(currentId);
  };
  const toggleCheck = async (blockId: string, index: number) => {
    if (!currentId) return;
    await svc.toggleChecklistItem(currentId, blockId, index);
    await loadCurrent(currentId);
  };
  const editCheckItem = async (blockId: string, index: number, text: string) => {
    if (!currentId) return;
    await svc.setChecklistItemText(currentId, blockId, index, text);
    await loadCurrent(currentId);
  };
  const addCheckItem = async (blockId: string) => {
    if (!currentId) return;
    await svc.addChecklistItem(currentId, blockId);
    await loadCurrent(currentId);
  };
  const deleteCheckItem = async (blockId: string, index: number) => {
    if (!currentId) return;
    await svc.deleteChecklistItem(currentId, blockId, index);
    await loadCurrent(currentId);
  };
  const moveBlockDir = async (blockId: string, dir: -1 | 1) => {
    if (!currentId || !current) return;
    const blocks = current.blocks;
    const i = blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    await svc.moveBlock(currentId, i, j);
    await loadCurrent(currentId);
  };
  const deleteBlock = async (blockId: string) => {
    if (!currentId) return;
    await svc.deleteBlock(currentId, blockId);
    await loadCurrent(currentId);
  };

  // Stack depth per screen: list is root, editor and templates sit above it,
  // connections above the editor, its two pickers above that.
  const NOTE_DEPTH: Record<Screen, number> = { list: 0, editor: 1, templates: 1, connections: 2, linkPicker: 3, createTasks: 3 };
  const pushCls = usePushDepth(NOTE_DEPTH[screen]);

  if (screen === "list") {
    return (
      <div className={pushCls} key="list">
      <NotesList
        notes={list}
        onOpen={openNote}
        onNewNote={() => setScreen("templates")}
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
          await svc.removeConnection(currentId, connId);
          await loadCurrent(currentId);
        }}
        categories={catList.map((c) => ({ id: c.id, name: catName(c.id) }))}
        onChangeCategory={async (categoryId) => {
          if (!currentId) return;
          await svc.setCategory(currentId, categoryId);
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
            await svc.addConnection(currentId, kind, label, targetId);
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
            await svc.deleteNote(currentId);
            setCurrentId(null);
            await loadList();
            setScreen("list");
            showToast({
              message: "Note deleted",
              actionLabel: "Undo",
              onAction: async () => {
                if (snapshot) await svc.restoreNote(snapshot);
                await loadList();
              },
            });
          }}
          onAddBlock={() => setAddBlockOpen(true)}
          onEditTitle={editTitle}
          onEditBlockText={editBlockText}
          onToggleCheck={toggleCheck}
          onEditCheckItem={editCheckItem}
          onAddCheckItem={addCheckItem}
          onDeleteCheckItem={deleteCheckItem}
          onMoveBlock={moveBlockDir}
          onDeleteBlock={deleteBlock}
        />
      )}
      {addBlockOpen && (
        <AddBlockSheet onSelect={addBlock} onCancel={() => setAddBlockOpen(false)} />
      )}
    </div>
  );
}

// seeds a few generic notes so the demo build is not empty, tagged by category id
async function seedDemoNotes(svc: ReturnType<typeof useNotes>, cats: Category[]) {
  const id = (n: string) => cats.find((c) => c.data.name === n)?.id ?? cats[0]?.id ?? "";

  const plan = await svc.createNote("Quarterly Planning", id("Work"));
  if (plan) await svc.applyTemplate(plan, "meeting");

  const training = await svc.createNote("Training Plan", id("Health"));
  if (training) {
    await svc.addBlock(training, { type: "heading", text: "This Week" });
    await svc.addChecklist(training, ["Tuesday tempo run", "Thursday intervals", "Sunday long run"]);
  }

  const home = await svc.createNote("Home Projects", id("Family"));
  if (home) await svc.applyTemplate(home, "todo");

  const outreach = await svc.createNote("Outreach List", id("Friends"));
  if (outreach) await svc.applyTemplate(outreach, "brief");

  await svc.createNote("Standup Notes", id("Work"));
}
