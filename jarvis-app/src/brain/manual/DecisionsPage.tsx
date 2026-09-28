import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../shared/PageHeader";
import { pressable } from "../../shared/pressable";
import { useBrainMemory } from "../../data/NotesProvider";
import { useFreshLists } from "../../data/useFreshLists";
import {
  BRAIN_MEMORY_ENTITY,
  type BrainMemoryRow,
} from "../../ai/brainMemory";
import {
  decisionMatchesStatus,
  decisionStateLabel,
  type DecisionFilter,
} from "../../ai/brainMemoryService";
import { formatFiledDate } from "./triage";
import MemorySheet from "./MemorySheet";
import FileSheet from "./FileSheet";
import { PinStar } from "./PinStar";

const FILTERS: DecisionFilter[] = ["all", "active", "reversed", "archived"];
const FILTER_LABEL: Record<DecisionFilter, string> = {
  all: "All", active: "Active", reversed: "Reversed", archived: "Archived",
};

const SEARCH = (
  <svg className="ic search-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);

/**
 * Decisions (Brain Manual v1): what was decided, why, and when, over the
 * brain_memory decision rows. Revisit files the new call as a NEW row and
 * archives this one with the supersede link. The old value is never
 * deleted, so a reversed call keeps its history.
 */
export default function DecisionsPage({
  onBack,
  openId,
  openNonce,
  onOpenConsumed,
}: {
  onBack: () => void;
  /** A deep-linked decision row id (chat citation, search hit, the filing
   *  intake's success path). It is a one-shot like every shell intent: the
   *  nonce re-fires it when the same id arrives twice. */
  openId?: string;
  openNonce?: number;
  onOpenConsumed?: () => void;
}) {
  const svc = useBrainMemory();
  const [rows, setRows] = useState<BrainMemoryRow[]>([]);
  const [filter, setFilter] = useState<DecisionFilter>("all");
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(openId ?? null);
  const [filing, setFiling] = useState(false);

  const reload = useCallback(async () => {
    setRows(await svc.listByCategory("decision"));
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);
  useFreshLists([BRAIN_MEMORY_ENTITY], reload);

  // A deep link (chat citation, search) opens the row once, then is spent.
  useEffect(() => {
    if (openId) {
      setDetailId(openId);
      onOpenConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, openNonce]);

  const query = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => decisionMatchesStatus(r, filter))
    .filter((r) => !query
      || r.data.text.toLowerCase().includes(query)
      || (r.data.why ?? "").toLowerCase().includes(query))
    .sort((a, b) =>
      Number(!!b.data.pinned) - Number(!!a.data.pinned)
      || b.created_at.localeCompare(a.created_at));

  const detail = detailId ? rows.find((r) => r.id === detailId) ?? null : null;

  return (
    <div className="screen ruled">
      <PageHeader title="Decisions" back="Brain" onBack={onBack} />

      <div className="pad-x list-search">
        <div className="search-bar">
          {SEARCH}
          <input placeholder="Search Decisions" aria-label="Search decisions"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="pad-x"><div className="chip-row">
        {FILTERS.map((f) => (
          <button key={f} type="button" className={"chip" + (filter === f ? " active" : "")}
            aria-pressed={filter === f} onClick={() => setFilter(f)}>{FILTER_LABEL[f]}</button>
        ))}
      </div></div>

      {shown.length === 0 ? (
        <div className="empty-state empty-compact">
          <div className="empty-title">{query ? "Nothing Matches" : "No Decisions Filed"}</div>
          <div className="empty-sub">{query ? "Try a Different Search" : "Log a Call Once and You Will Never Re-Litigate It"}</div>
          {!query && (
            <button className="btn btn-primary" onClick={() => setFiling(true)}>Log a Decision</button>
          )}
        </div>
      ) : (
        <>
        <div className="sh2 sh2-quiet"><span className="t">Decisions</span><span className="n">{shown.length}</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          {shown.map((r) => (
            <div {...pressable(() => setDetailId(r.id))} className="lib-row" key={r.id}>
              <PinStar row={r} onToggled={() => void reload()} />
              <div className="row-grow">
                <div className="conn-name">{r.data.text}</div>
                {/* The separators are drawn by CSS (.fact + .fact, §AM F3),
                    never typed into the words. */}
                <div className="facts">
                  <span className="fact">{decisionStateLabel(r)}</span>
                  {r.data.why && <span className="fact">{r.data.why}</span>}
                  {r.data.date && <span className="fact">{formatFiledDate(r.data.date)}</span>}
                </div>
              </div>
            </div>
          ))}
          <button className="row row-act" onClick={() => setFiling(true)}>Log a Decision</button>
        </div></div>
        </>
      )}
      <div className="screen-foot" />

      {detail && (
        <MemorySheet row={detail} onClose={() => setDetailId(null)} onChanged={() => void reload()} />
      )}
      {filing && (
        <FileSheet category="decision" onClose={() => setFiling(false)} onFiled={() => void reload()} />
      )}
    </div>
  );
}
