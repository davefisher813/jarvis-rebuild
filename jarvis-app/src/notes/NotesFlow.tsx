import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes, useCategories, useTasks, useSchedule } from "../data/NotesProvider";
import { catName } from "../shared/categories";
import type { Category } from "../categories/types";
import type { Block, Connection, NoteData, TemplateKey } from "./types";
import NotesList, { type NoteListItem } from "./screens/NotesList";
import NoteEditor, { type EditorNote } from "./screens/NoteEditor";
import Templates from "./screens/Templates";
import AddBlockSheet from "./screens/AddBlockSheet";
import Connections from "./screens/Connections";
import LinkPicker from "./screens/LinkPicker";
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
    case "photo": return { type, name: "Photo", size: "\u2014" };
    case "file": return { type, name: "Attachment", size: "\u2014" };
  }
}

export default function NotesFlow({
  seed = false,
  onChrome,
  onExit,
}: {
  seed?: boolean;
  onChrome?: (chrome: { tabBar: boolean }) => void;
  onExit?: () => void;
}) {
  const svc = useNotes();
  const cats = useCategories();
  const tasksSvc = useTasks();
  const schedSvc = useSchedule();
  const [catList, setCatList] = useState<Category[]>([]);
  const defaultCatId = catList[0]?.id ?? "";
  const [screen, setScreen] = useState<Screen>("list");
  const [list, setList] = useState<NoteListItem[]>([]);
  const [current, setCurrent] = useState<EditorNote | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [conns, setConns] = useState<Connection[]>([]);
  const [linkEvents, setLinkEvents] = useState<{ id: string; title: string }[]>([]);
  const [linkTasks, setLinkTasks] = useState<{ id: string; text: string }[]>([]);
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
    setLinkEvents(ev.map((e) => ({ id: e.id, title: (e.data as { title?: string }).title || "Untitled" })));
    setLinkTasks(
      ts
        .filter((t) => !(t.data as { done?: boolean }).done)
        .map((t) => ({ id: t.id, text: (t.data as { text?: string }).text || "Untitled" })),
    );
  }, [schedSvc, tasksSvc]);

  const openNote = async (id: string) => {
    setCurrentId(id);
    await loadCurrent(id);
    setScreen("editor");
  };

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

  if (screen === "list") {
    return (
      <NotesList
        notes={list}
        onOpen={openNote}
        onNewNote={() => setScreen("templates")}
        onBack={onExit}
      />
    );
  }
  if (screen === "templates") {
    return <Templates onSelect={pickTemplate} onBack={() => setScreen("list")} />;
  }
  if (screen === "connections") {
    const cat = current?.category ?? defaultCatId;
    return (
      <Connections
        category={cat}
        categoryLabel={catName(cat)}
        connections={conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label }))}
        onBack={() => setScreen("editor")}
        onAddLink={async () => { await loadLinkables(); setScreen("linkPicker"); }}
        onRemove={async (connId) => {
          if (!currentId) return;
          await svc.removeConnection(currentId, connId);
          await loadCurrent(currentId);
        }}
        onCreateTasks={() => setScreen("createTasks")}
      />
    );
  }
  if (screen === "linkPicker") {
    return (
      <LinkPicker
        events={linkEvents}
        tasks={linkTasks}
        onPick={async (kind, label, targetId) => {
          if (currentId) {
            await svc.addConnection(currentId, kind, label, null, targetId);
            await loadCurrent(currentId);
          }
          setScreen("connections");
        }}
        onBack={() => setScreen("connections")}
      />
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
      <CreateTasks
        category={cat}
        categoryLabel={catName(cat)}
        items={items}
        onCreate={runCreateTasks}
        onBack={() => setScreen("connections")}
      />
    );
  }
  // editor
  return (
    <>
      {current && (
        <NoteEditor
          note={current}
          onBack={() => { setScreen("list"); loadList(); }}
          onConnections={() => setScreen("connections")}
          onAddBlock={() => setAddBlockOpen(true)}
          onEditTitle={editTitle}
          onEditBlockText={editBlockText}
          onToggleCheck={toggleCheck}
          onEditCheckItem={editCheckItem}
        />
      )}
      {addBlockOpen && (
        <AddBlockSheet onSelect={addBlock} onCancel={() => setAddBlockOpen(false)} />
      )}
    </>
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
