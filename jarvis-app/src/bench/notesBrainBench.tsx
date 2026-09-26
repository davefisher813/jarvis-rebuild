import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import NotesList, { type NoteListItem } from "../notes/screens/NotesList";
import { listTitle } from "../notes/docModel";
import BrainTop from "../brain/BrainTop";
import { NotesProvider, useStrands } from "../data/NotesProvider";
import { setCategoryRegistry } from "../shared/categories";
import "../styles/jarvis-design-system.css";
import "../styles/uniformity.css";
import "../styles/components.css";
import "../styles/editor.css";
import "../styles/ruled.css";

// SCRATCH BENCH (pass-off 2026-09-26, items 3 and 4). Renders the real
// NotesList and the real BrainTop through the real stylesheets with the
// fixtures the demo cannot seed: a note with finds and tags, an unfiled
// tagged note, a legacy event note with the date in its stored title, a
// typed-date note, the Pinned / Today / Yesterday / Earlier heads; and a
// Known, a Known + Rule and a Fading fact on the hub. Deleted before commit.

setCategoryRegistry([
  { id: "c-work", name: "Work", color: "orange" },
  { id: "c-jarvis", name: "Javris", color: "purple" },
  { id: "c-personal", name: "Personal", color: "mint" },
  { id: "c-bridge", name: "Bridge", color: "blue" },
]);

const now = new Date();
const at = (daysAgo: number, hour = 9) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour).getTime();

const NOTES: NoteListItem[] = [
  { id: "n1", title: "jarvis updates", edited: at(0, 8), category: "c-jarvis", first: "", body: "", found: 6 },
  { id: "n2", title: "offsite ideas for q3", edited: at(0, 7), category: "c-work", first: "", body: "", tags: ["ideas", "q3"], found: 3 },
  { id: "n3", title: "Meeting Notes", edited: at(1, 22), category: "", first: "", body: "", tags: ["gym"] },
  { id: "n4", title: listTitle({ title: "Set up everything on jarvis · Sep 17", blocks: [], source: { type: "event" } }), edited: at(9), category: "c-personal", first: "", body: "" },
  { id: "n5", title: "Standup · Sep 17", edited: at(9, 10), category: "c-work", first: "", body: "" },
  { id: "n6", title: "convo with berto", edited: at(23), category: "c-work", first: "", body: "" },
  { id: "n7", title: "Rob Bridge", edited: at(23, 8), category: "c-bridge", first: "", body: "" },
  { id: "n8", title: "packing list", edited: at(0, 6), category: "", first: "", body: "", pinned: true },
];

function NotesBench() {
  return <NotesList notes={NOTES} onDelete={() => {}} onFile={() => {}} onOpen={() => {}} />;
}

function BrainRows() {
  const svc = useStrands();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const today = new Date().toISOString().slice(0, 10);
      await svc.add("Brainstorms best at night", "work_style", today);
      await svc.add("Bridge wins ties over optional Jarvis work", "values", today, "rule");
      const id = await svc.add("Admin happens Friday afternoons", "routine", today);
      const s = (await svc.list()).find((x) => x.id === id);
      if (s) await svc.confirm(s, "2026-01-05");
      setReady(true);
    })();
  }, [svc]);
  if (!ready) return null;
  return (
    <div className="screen ruled">
      <div className="nav-large" style={{ padding: "24px 16px 8px" }}>Brain</div>
      <BrainTop onOpenFact={() => {}} onOpenWatching={() => {}} />
    </div>
  );
}

function Bench() {
  const page = new URLSearchParams(location.search).get("page") ?? "notes";
  return (
    <div className="app-shell"><div className="app-scroll">
      {page === "brain"
        ? <NotesProvider userId="bench"><BrainRows /></NotesProvider>
        : <NotesBench />}
    </div></div>
  );
}

createRoot(document.getElementById("root")!).render(<Bench />);
