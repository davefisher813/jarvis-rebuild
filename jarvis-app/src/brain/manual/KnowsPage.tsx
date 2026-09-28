import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../shared/PageHeader";
import { pressable } from "../../shared/pressable";
import { useBrainMemory } from "../../data/NotesProvider";
import { useFreshLists } from "../../data/useFreshLists";
import { attemptWrite } from "../../shared/guard";
import {
  BRAIN_MEMORY_ENTITY,
  categoryLabel,
  type BrainMemoryCategory,
  type BrainMemoryRow,
} from "../../ai/brainMemory";
import { decisionStateLabel } from "../../ai/brainMemoryService";
import MemorySheet from "./MemorySheet";
import FileSheet from "./FileSheet";
import { PinStar } from "./PinStar";

type Chip = "all" | BrainMemoryCategory;
const CHIPS: Chip[] = ["all", "decision", "philosophy", "value", "voice", "fact"];

const SEARCH = (
  <svg className="ic search-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);

function stateWord(row: BrainMemoryRow): string {
  return row.data.category === "decision" ? decisionStateLabel(row) : "Learned";
}

const EMPTY: Record<Chip, { title: string; sub: string; action: string; cat: BrainMemoryCategory }> = {
  all: { title: "Nothing Filed Yet", sub: "File the First Thing and the Brain Starts Shaping Every Answer", action: "File Something", cat: "fact" },
  decision: { title: "No Decisions Filed", sub: "Log a Call Once and You Will Never Re-Litigate It", action: "Log a Decision", cat: "decision" },
  philosophy: { title: "No Principles Yet", sub: "Write One Principle and Every Answer Is Shaped by It", action: "Add a Principle", cat: "philosophy" },
  value: { title: "No Values Listed", sub: "Name What Matters and the Brain Advises in Line With It", action: "Add a Value", cat: "value" },
  voice: { title: "No Writing Samples", sub: "Add 3 Samples and Every Draft Will Sound Like You", action: "Add a Sample", cat: "voice" },
  fact: { title: "No Facts Filed", sub: "Tell It One Thing and It Stops Asking Twice", action: "Add a Fact", cat: "fact" },
};

/**
 * What JARVIS Knows (Brain Manual v1): every filed row across the five
 * categories, with the category chips, the cross-brain search, and the pin.
 * A row opens the memory detail screen (Edit / Forget); the empty states
 * sell the payoff and carry the fastest inline action.
 */
export default function KnowsPage({ onBack }: { onBack: () => void }) {
  const svc = useBrainMemory();
  const [rows, setRows] = useState<BrainMemoryRow[]>([]);
  const [chip, setChip] = useState<Chip>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [filing, setFiling] = useState<BrainMemoryCategory | null>(null);

  const reload = useCallback(async () => {
    setRows(await svc.list());
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);
  useFreshLists([BRAIN_MEMORY_ENTITY], reload);

  const query = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => chip === "all" || r.data.category === chip)
    .filter((r) => !query
      || r.data.text.toLowerCase().includes(query)
      || (r.data.why ?? "").toLowerCase().includes(query))
    .sort((a, b) =>
      Number(!!b.data.pinned) - Number(!!a.data.pinned)
      || b.created_at.localeCompare(a.created_at));

  const open = openId ? rows.find((r) => r.id === openId) ?? null : null;
  const empty = EMPTY[chip];

  return (
    <div className="screen ruled">
      <PageHeader title="What JARVIS Knows" back="Brain" onBack={onBack} />

      <div className="pad-x list-search">
        <div className="search-bar">
          {SEARCH}
          <input placeholder="Search Everything Filed" aria-label="Search everything filed"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="pad-x"><div className="chip-row chip-wrap-row">
        {CHIPS.map((c) => (
          <button key={c} type="button" className={"chip" + (chip === c ? " active" : "")}
            aria-pressed={chip === c} onClick={() => setChip(c)}>
            {c === "all" ? "All" : categoryLabel(c)}
          </button>
        ))}
      </div></div>

      {shown.length === 0 ? (
        <div className="empty-state empty-compact">
          <div className="empty-title">{query ? "Nothing Matches" : empty.title}</div>
          <div className="empty-sub">{query ? "Try a Different Search" : empty.sub}</div>
          {!query && (
            <button className="btn btn-primary" onClick={() => setFiling(empty.cat)}>{empty.action}</button>
          )}
        </div>
      ) : (
        <>
        <div className="sh2 sh2-quiet"><span className="t">{chip === "all" ? "Everything Filed" : categoryLabel(chip)}</span><span className="n">{shown.length}</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          {shown.map((r) => (
            <div {...pressable(() => setOpenId(r.id))} className="lib-row" key={r.id}>
              <PinStar row={r} onToggled={() => void reload()} />
              <div className="row-grow">
                <div className="conn-name">{r.data.text}</div>
                {/* The separators are drawn by CSS (.fact + .fact, §AM F3),
                    never typed into the words. */}
                <div className="facts"><span className="fact">{stateWord(r)}</span><span className="fact">{categoryLabel(r.data.category)}</span></div>
              </div>
            </div>
          ))}
        </div></div>
        </>
      )}
      <div className="screen-foot" />

      {open && (
        <MemorySheet row={open} onClose={() => setOpenId(null)} onChanged={() => void reload()} />
      )}
      {filing && (
        <FileSheet category={filing} onClose={() => setFiling(null)} onFiled={() => void reload()} />
      )}
    </div>
  );
}
