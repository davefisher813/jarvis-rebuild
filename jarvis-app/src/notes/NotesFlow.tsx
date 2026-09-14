import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sourceOpener } from "../shared/openSource";
import { useFreshLists } from "../data/useFreshLists";
import { ENTITY_NOTE } from "./types";
import { useNotes, useCategories, useTasks, useSchedule, useProjects, useGoals, usePeople, useOptionalProfile, useFileStore, useOptionalDecisions } from "../data/NotesProvider";
import { useAI } from "../ai/useAI";
import { findInNote, passLength, PASS_DELTA } from "./jarvisFound";
import { catName } from "../shared/categories";
import type { Category } from "../categories/types";
import type { Block, Connection, NoteData, NoteVersion, TemplateKey } from "./types";
import NotesList, { type NoteListItem } from "./screens/NotesList";
import { noteBlockText } from "../search/search";
import NoteEditor, { type EditorNote, type SaveState } from "./screens/NoteEditor";
import QuickAppendSheet from "./screens/QuickAppendSheet";
import { taskFromPassage } from "./aiActions";
import { blocksToDoc, displayTitle, firstLineOf, type Doc } from "./docModel";
import Templates from "./screens/Templates";
import { usePushDepth } from "../shared/pushNav";
import Connections from "./screens/Connections";
import LinkPicker from "./screens/LinkPicker";
import { showToast } from "../shared/toast";
import { usePickFile, PICK_ANY, PICK_IMAGE } from "../shared/usePickFile";
import { backendConfigured } from "../data/store";
import { fileStem, sizeLabel } from "../files/types";
import { FormSheet, Group, Row, FieldRow, Strip } from "../shared/FormSheet";
import { Check } from "../shared/icons";

import { attemptWrite } from "../shared/guard";
import { recordSpot } from "../restore/whereYouWere";
import CreateTasks from "./screens/CreateTasks";
import QuickCreateSheet, { nextHalfHour, type QuickCreateKind } from "./screens/QuickCreateSheet";
import { todayISO, addDays } from "../schedule/calendar";

type Screen = "list" | "editor" | "templates" | "connections" | "createTasks" | "linkPicker";

const TEMPLATE_TITLE: Record<TemplateKey, string> = {
  // A blank note has no title until one is typed; its first line names it
  // (the writing system, 2026-09-14).
  blank: "",
  meeting: "Meeting Notes",
  todo: "Checklist",
  tracker: "Tracker",
  brief: "Project Brief",
  journal: "Journal",
};

// maps a stored note into the editor's display shape: the document (built
// from the blocks for a note that predates one), the attachments beside it.
function toEditorNote(data: NoteData): EditorNote {
  const attachments = data.blocks
    .filter((b) => b.type === "photo" || b.type === "file")
    .map((b) => ({ id: b.id, type: b.type as "photo" | "file", name: b.name ?? (b.type === "photo" ? "Photo" : "File"), size: b.size ?? "", path: b.path, mime: b.mime }));
  return {
    category: data.category,
    eyebrow: catName(data.category).toUpperCase(),
    title: data.title,
    doc: data.doc ?? blocksToDoc(data.blocks),
    attachments,
    ...(data.source ? { source: data.source } : {}),
  };
}

// DRAFTS ON DEVICE (the writing system, section 7): every change is written
// to localStorage before the store hears of it, and cleared once the store
// has it, so a refresh or an evicted WebView mid-sentence loses nothing.
const DRAFT_KEY = "jarvis.notes.draft.v1";
function readDraft(id: string): Doc | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY + ":" + id);
    return raw ? (JSON.parse(raw) as Doc) : null;
  } catch { return null; }
}
function writeDraft(id: string, doc: Doc): boolean {
  try { localStorage.setItem(DRAFT_KEY + ":" + id, JSON.stringify(doc)); return true; } catch { return false; }
}
function clearDraft(id: string) {
  try { localStorage.removeItem(DRAFT_KEY + ":" + id); } catch { /* nothing to clear */ }
}

function firstLine(d: NoteData): string {
  return firstLineOf(d.doc ?? blocksToDoc(d.blocks));
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
  // ONE QUEUE FOR EVERY MUTATION (HMN-F-01, 2026-09-05). Every write to the
  // open note is read-modify-write, and two of those in flight read the same
  // stale note and the second erases the first. Every mutation on the open
  // note goes through this queue, so each runs alone against a fresh read.
  // A failed step never wedges the queue: the chain continues either way.
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    const next = writeQueue.current.then(fn, fn);
    writeQueue.current = next.catch(() => {});
    return next;
  };

  // THE DOCUMENT SAVE (the writing system, 2026-09-14). Typing never waits on
  // a write: the editor emits the document, it goes to the draft on device at
  // once, and the store write follows 600ms after the last keystroke, through
  // the queue. The line under the document says what is true: Saving while
  // the write is out, Synced when the store has it and no queue is waiting,
  // Saved on device when it is written but still to sync (or there is no
  // backend in this build), Couldn't save with Retry when the write failed
  // (the draft is still on device, so nothing typed is lost). Undo and redo
  // belong to the editor's own history now, one entry per logical action.
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pendingDoc = useRef<{ id: string; doc: Doc } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDoc = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const p = pendingDoc.current;
    if (!p) return Promise.resolve();
    pendingDoc.current = null;
    setSaveState("saving");
    return enqueue(async () => {
      const ok = await attemptWrite(() => svc.setDoc(p.id, p.doc));
      if (!ok) { pendingDoc.current = pendingDoc.current ?? p; setSaveState("failed"); return; }
      clearDraft(p.id);
      setSaveState(backendConfigured && svc.queueLen() === 0 ? "synced" : "saved");
      if (currentIdRef.current === p.id) await loadCurrent(p.id);
      void maybeFind(p.id);
      await loadList();
    });
  }, [svc]);
  const docChange = (doc: Doc) => {
    if (!currentId) return;
    pendingDoc.current = { id: currentId, doc };
    writeDraft(currentId, doc);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushDoc(), 600);
  };
  // The write goes out before the page can be lost: on unmount, when the app
  // is hidden, and when the note is left.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flushDoc(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushDoc);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushDoc);
      void flushDoc();
    };
  }, [flushDoc]);
  const [conns, setConns] = useState<Connection[]>([]);
  // C-18 / C-19 / C-20 (Astra, 2026-09-12): the open note's flags, the
  // notes around it, and what JARVIS found in it.
  const [noteFlags, setNoteFlags] = useState<{ pinned: boolean; archived: boolean; tags: string[] }>({ pinned: false, archived: false, tags: [] });
  // A TASK FROM A PASSAGE (wave 4): the first line is the task, the passage
  // its notes, the note its source; the note gets the connection back. Undo
  // takes both away.
  const createLinkedTask = async (passage: string) => {
    if (!currentId) return;
    const noteId = currentId;
    const { title, notes } = taskFromPassage(passage);
    const made: { id: string | null } = { id: null };
    const ok = await attemptWrite(async () => {
      made.id = await tasksSvc.createTask(title, { fromNote: noteId, notes, source: { type: "note", ref: noteId, ts: Date.now() } });
      if (made.id) await svc.addConnection(noteId, "task", title, made.id);
    });
    await loadCurrent(noteId);
    const taskId = made.id;
    if (!ok || !taskId) return;
    showToast({
      message: "Task made from the passage",
      actionLabel: "Undo",
      onAction: () => void enqueue(async () => {
        await attemptWrite(async () => {
          await tasksSvc.deleteTask(taskId);
          const d = await svc.note(noteId);
          const conn = (d?.connections ?? []).find((c) => c.targetId === taskId);
          if (conn) await svc.removeConnection(noteId, conn.id);
        });
        await loadCurrent(noteId);
      }),
    });
  };
  // VERSION HISTORY (wave 3b): the open note's kept versions.
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const restoreVersion = (at: number) => enqueue(async () => {
    if (!currentId) return;
    await flushDoc();
    const ok = await attemptWrite(() => svc.restoreVersion(currentId, at));
    if (!ok) return;
    await loadCurrent(currentId);
    showToast({ message: "Version restored" });
  });
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
    const items = await svc.listNotes({ includeDeleted: true });
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
          id: it.id, title: displayTitle(d), edited, category: d.category || "", first: d.title.trim() ? firstLine(d) : "", body: noteBlockText(d),
          // C-18 / C-20
          ...(d.pinned ? { pinned: true } : {}), ...(d.archived ? { archived: true } : {}), ...(d.tags?.length ? { tags: d.tags } : {}), ...(d.deletedAt ? { deleted: true } : {}),
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
      setVersions(d?.versions ?? []);
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
      if (d) recordSpot({ kind: "note", id, label: displayTitle(d) });
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
    setLinkNotes(list.filter((n) => n.id !== currentIdRef.current && !n.archived && !n.deleted).map((n) => ({ id: n.id, title: n.title })));
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
    await flushDoc();
    setSaveState("idle");
    passLenRef.current = -1;
    // A draft left on device (the app was killed mid-sentence) is newer than
    // the store: it is written first, then the note is read.
    const draft = readDraft(id);
    if (draft) {
      const stored = await svc.note(id);
      if (stored && JSON.stringify(stored.doc ?? blocksToDoc(stored.blocks)) !== JSON.stringify(draft)) {
        const ok = await attemptWrite(() => svc.setDoc(id, draft));
        if (ok) clearDraft(id);
      } else clearDraft(id);
    }
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
  // RECENTLY DELETED (wave 3b): what has sat there thirty days goes for
  // good, files and all, once per open. A failed purge tries again next time.
  useEffect(() => {
    void svc.purgeTrash().then(async (ids) => {
      for (const id of ids) void fileStore?.removeAll(id);
      if (ids.length) await loadList();
    }).catch(() => {});
  }, [svc, fileStore, loadList]);
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

  const attach = (type: "photo" | "file") => { if (currentId && fileStore) pickInto(currentId, type); };

  // QUICK APPEND (wave 3): the swipe's Add opens a small sheet; Done puts
  // the lines on the end of that note's document.
  const [appending, setAppending] = useState<string | null>(null);
  const runAppend = async (id: string, nodes: import("@tiptap/core").JSONContent[]) => {
    setAppending(null);
    if (nodes.length === 0) return;
    const ok = await attemptWrite(() => svc.appendToDoc(id, nodes));
    if (!ok) return;
    await loadList();
    const name = list.find((n) => n.id === id)?.title ?? "the note";
    showToast({ message: "Added to " + name });
  };
  // The swipe's File: an area, or "" to unfile. Closes on the pick.
  const [filing, setFiling] = useState<string | null>(null);
  const fileUnder = async (id: string, category: string) => {
    setFiling(null);
    const ok = await attemptWrite(() => svc.fileUnder(id, category));
    if (ok) await loadList();
  };


  // HMN-F-27 (2026-09-05): deleting a photo or file BLOCK took the block and
  // left its bytes in storage forever, so a note edited over a year quietly
  // grew a pile nobody could see or reach. The note delete has had this sweep
  // since the day it shipped; the block delete never got one. Same beat, same
  // reason: the editor's Undo brings the block back WITH its picture, so the
  // bytes cannot go the instant the block does.
  const sweepPathAfter = (path: string): { cancel: () => void } => {
    let undone = false;
    const t = setTimeout(() => { if (!undone) void fileStore?.remove([path]); }, 6000);
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
  // An attachment leaves the note with Undo in the toast (the app's one
  // convention for a destructive action); its bytes follow a beat later
  // (HMN-F-27), and Undo cancels that beat because Undo brings the picture
  // back.
  const deleteAttachment = (blockId: string) => enqueue(async () => {
    if (!currentId) return;
    const noteId = currentId;
    const block = (await svc.note(noteId))?.blocks.find((b) => b.id === blockId);
    if (!block) return;
    const ok = await attemptWrite(() => svc.deleteBlock(noteId, blockId));
    await loadCurrent(noteId);
    if (!ok) return;
    const sweep = block.path ? sweepPathAfter(block.path) : null;
    showToast({
      message: block.type === "photo" ? "Photo removed" : "File removed",
      actionLabel: "Undo",
      onAction: () => void enqueue(async () => {
        sweep?.cancel();
        const { id: _id, ...rest } = block;
        await attemptWrite(() => svc.addBlock(noteId, rest));
        await loadCurrent(noteId);
      }),
    });
  });

  // Stack depth per screen: list is root, editor and templates sit above it,
  // connections above the editor, its two pickers above that.
  const NOTE_DEPTH: Record<Screen, number> = { list: 0, editor: 1, templates: 1, connections: 2, linkPicker: 3, createTasks: 3 };
  const pushCls = usePushDepth(NOTE_DEPTH[screen]);

  // DELETE (Dave 2026-08-24; wave 3b). A deleted note goes to Recently
  // Deleted whole, under its own id (HMN-F-15), so Undo, Restore and every
  // link into it keep working; its files stay until it is purged or deleted
  // for good.
  const onDeleteManyNotes = async (ids: string[]) => {
    if (ids.length === 0) return;
    let gone = 0;
    await attemptWrite(async () => { for (const id of ids) { if (await svc.trashNote(id)) gone++; } });
    await loadList();
    if (gone === 0) return;
    const n = gone;
    for (const id of ids) clearDraft(id);
    showToast({
      message: n === 1 ? "Note deleted" : n + " notes deleted",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => { for (const id of ids) await svc.untrashNote(id); });
        await loadList();
      },
    });
  };
  const restoreNote = async (id: string) => {
    const ok = await attemptWrite(() => svc.untrashNote(id));
    if (!ok) return;
    await loadList();
    showToast({ message: "Back in your notes" });
  };
  const deleteForever = async (id: string) => {
    const ok = await attemptWrite(() => svc.deleteNote(id));
    if (!ok) return;
    void fileStore?.removeAll(id);
    await loadList();
    showToast({ message: "Deleted for good" });
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
        onAppend={(id) => setAppending(id)}
        onRestore={(id) => void restoreNote(id)}
        onDeleteForever={(id) => void deleteForever(id)}
      />
      {appending && (
        <QuickAppendSheet title={list.find((n) => n.id === appending)?.title ?? "Note"} onDone={(nodes) => void runAppend(appending, nodes)} onCancel={() => setAppending(null)} />
      )}
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
    const items = (current?.doc.content ?? [])
      .filter((n) => n.type === "taskList")
      .flatMap((n) => n.content ?? [])
      .filter((li) => !li.attrs?.checked)
      .map((li) => ({ text: (li.content ?? []).map((c) => (c.content ?? []).map((t) => t.text ?? "").join("")).join(" ").trim(), due: "", urgency: "muted" as const }))
      .filter((i) => i.text);
    const cat = current?.category ?? defaultCatId;
    return (
      <div className={pushCls} key="createTasks">
      <CreateTasks
        category={cat}
        categoryLabel={catName(cat)}
        // HMN-F-16 (2026-09-05): the flow wired only `items`, so the header
        // said From "This Week" for every note in the app.
        source={current ? (current.title.trim() || firstLineOf(current.doc) || "Untitled") : "Untitled"}
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
          note={current}
          saveState={saveState}
          onRetrySave={() => void flushDoc()}
          onBack={() => { void flushDoc().then(() => loadList()); setScreen("list"); }}
          onConnections={() => setScreen("connections")}
          onDeleteNote={async () => {
            if (!currentId) return;
            // The app's one convention for destructive actions: do it, offer
            // Undo in the toast (tasks set the pattern). Queued behind any
            // save still in flight, so the snapshot Undo restores carries the
            // last thing typed.
            await flushDoc();
            let ok = false;
            await enqueue(async () => { ok = await attemptWrite(() => svc.trashNote(currentId)); });
            if (!ok) return;
            const deletedId = currentId;
            clearDraft(deletedId);
            openCurrentId(null);
            await loadList();
            setScreen("list");
            showToast({
              message: "Note deleted",
              actionLabel: "Undo",
              onAction: async () => {
                await attemptWrite(() => svc.untrashNote(deletedId));
                await loadList();
              },
            });
          }}
          onDeleteAttachment={(id) => void deleteAttachment(id)}
          onInsertPhoto={fileStore ? () => attach("photo") : undefined}
          onInsertFile={fileStore ? () => attach("file") : undefined}
          onCreateTasks={() => setScreen("createTasks")}
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
          onDocChange={docChange}
          versions={versions}
          onRestoreVersion={(at) => void restoreVersion(at)}
          ai={ai.available ? ai : null}
          onCreateLinkedTask={(p) => void createLinkedTask(p)}
          connections={conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, targetId: c.targetId, gone: goneConns.has(c.id) }))}
          onAddLink={() => void openLinkPicker("editor")}
          onRemoveConnection={(connId) => void enqueue(async () => {
            if (!currentId) return;
            await attemptWrite(() => svc.removeConnection(currentId, connId));
            await loadCurrent(currentId);
          })}
          onOpenConnection={(kind, targetId) => (kind === "note" ? void openNote(targetId) : onNavigate?.(kind, targetId))}
          openSourceFor={openSourceFor}
        />
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
