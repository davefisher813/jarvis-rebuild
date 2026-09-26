import { useCallback, useEffect, useMemo, useState, type ReactNode, useRef } from "react";
import { useDecisions, useProjects, useGoals, useCategories, useOptionalStrands } from "../data/NotesProvider";
import PageHeader, { BarAction } from "../shared/PageHeader";
import InlineEdit from "../shared/InlineEdit";
import MarkdownField from "../shared/MarkdownField";
import DecisionCaptureSheet, { type AttachOption, type DecisionDraft } from "./DecisionCaptureSheet";
import { ENTITY_DECISION, linksOf, OUTCOME_LABEL, SOURCE_LABEL, type DecisionLink, type DecisionRecord, type OutcomeWord } from "./types";
import type { DecisionSourceKind } from "./types";

// WHERE A DECISION'S SOURCE ACTUALLY GOES (button audit, 2026-09-16; Dave:
// "wire it"). The row below has been built to open its origin since C-53 and
// nothing ever passed the handler, so "Email · Aug 12" under a decision was a
// line you could tap forever.
//
// Only the two kinds the shell can land on are listed. A decision made in
// Chat or entered by hand has nowhere to go, so its row stays the plain fact
// it already was -- opening a door onto nothing is the same bug wearing the
// other costume.
const SOURCE_ROUTE: Partial<Record<DecisionSourceKind, string>> = { note: "note", email: "email" };
import { todayISO } from "../schedule/calendar";
import EntityStar from "../shared/EntityStar";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { usePushDepth } from "../shared/pushNav";
import { catColor } from "../shared/categories";
import { effectiveKind } from "../categories/kinds";
import { shortDate } from "../shared/dateFormat";
import { pressable } from "../shared/pressable";

// Decision Record (brainstorm shipment 1). It answers one question six weeks
// later: why did I choose this? No AI anywhere in this folder: the record is
// deterministic, written by the user, surfaced by lookup. No counts anywhere:
// a count of decisions is a guilt metric waiting to happen.

const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const DECISION_ICO = svg(<><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>);
const PLUS = svg(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>);
const PEN = svg(<><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>);
const Chev = () => (
  <div className="chev" />
);

// The spec'd display copy for an empty reason (renders in tx-4 through the
// InlineEdit placeholder slot). Display copy, not a form label, so it stays
// sentence case by design.
const NO_REASON = "No reason recorded";

// "Aug 12" for the list's trailing date column (shared/dateFormat: noon-local
// so a bare date never rolls back a day west of Greenwich).
const fmtShort = shortDate;

// "August 12" from a local ISO date or an ISO datetime.
export const fmtDay = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });

// The list glyph wears the first linked entity's color and goes quiet when
// the decision stands alone. The glyph only: it reads the record's legacy
// first link, so the homes' dots are worked out per link (linkAreaSlot).
function glyphSlot(rec: DecisionRecord, projectCat: (id: string) => string | undefined): string {
  const t = rec.data.linkedType;
  // V4 styling pass: an unlinked decision wears the decision type color
  // (purple), never grey; nothing with an identity is grey.
  if (!t || !rec.data.linkedId) return "purple";
  if (t === "project") {
    const cat = projectCat(rec.data.linkedId);
    return cat ? catColor(cat) : "indigo";
  }
  if (t === "org") return catColor(rec.data.linkedId);
  if (t === "goal") return "purple";
  if (t === "person") return "teal";
  return "blue"; // task
}
const glyphClass = (rec: DecisionRecord, projectCat: (id: string) => string | undefined) => "cat-fg-" + glyphSlot(rec, projectCat);

// The area of life ONE home sits in, for its dot (§AM: a category colour on
// a dot means which area). A project is in its category, an org IS an area;
// a person, goal or task is not an area, and neither is a project with no
// category, so those return null and draw no dot.
function linkAreaSlot(l: DecisionLink, projectCat: (id: string) => string | undefined): string | null {
  if (l.type === "project") {
    const cat = projectCat(l.id);
    return cat ? catColor(cat) : null;
  }
  if (l.type === "org") return catColor(l.id);
  return null;
}

// The outcome word in the Colour Key (§AM): worked is done, mixed needs him
// soon, didn't is missed.
const OUTCOME_KEY: Record<OutcomeWord, "good" | "warn" | "red"> = { worked: "good", mixed: "warn", didnt: "red" };

export default function DecisionsFlow({ onBack, openId, openNonce, onOpenConsumed, onOpenSource }: { onBack: () => void; openId?: string;
  // BRAIN-F-04 (2026-09-05): the shell's one-shot shape (shell/intents.ts).
  // Read once per mount and cleared only by a tab tap, this id reopened the
  // same record every later visit to Decisions.
  openNonce?: number; onOpenConsumed?: () => void;
  // C-53: the Source row opens where the decision came from, when the host
  // can take it there (a chat message, a note, a thread).
  onOpenSource?: (kind: string, id: string) => void }) {
  const svc = useDecisions();
  // C-54: Make It a Rule writes a strand; no strand store, no row-act.
  const strands = useOptionalStrands();
  const projects = useProjects();
  const goals = useGoals();
  const categories = useCategories();

  const [live, setLive] = useState<DecisionRecord[]>([]);
  const [all, setAll] = useState<DecisionRecord[]>([]);
  const [attachOptions, setAttachOptions] = useState<AttachOption[]>([]);
  const [projCats, setProjCats] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{ kind: "list" } | { kind: "record"; id: string }>(openId ? { kind: "record", id: openId } : { kind: "list" });
  useEffect(() => {
    if (!openId) return;
    setView({ kind: "record", id: openId });
    onOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, openNonce]);
  const [sheet, setSheet] = useState<{ kind: "closed" } | { kind: "new" } | { kind: "supersede"; oldId: string }>({ kind: "closed" });
  const [editing, setEditing] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [revisitOpen, setRevisitOpen] = useState(false);
  const revisitRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [rows, everything] = await Promise.all([svc.list(), svc.listAll()]);
    setLive(rows);
    setAll(everything);
    setLoading(false);
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);

  // Attach options: active projects, active goals, org categories. The data
  // model carries person and task links too; capture offers the common homes.
  useEffect(() => {
    let on = true;
    void (async () => {
      const [pr, gl, cats] = await Promise.all([projects.list(), goals.list(), categories.list()]);
      if (!on) return;
      const opts: AttachOption[] = [
        ...pr.filter((p) => p.data.status !== "done").map((p) => ({ type: "project" as const, id: p.id, label: p.data.title })),
        // A dropped goal is not something to attach a new decision to: it
        // already HAS the decision that ended it (pick 17).
        ...gl.filter((g) => g.data.state !== "achieved" && !g.data.dropped).map((g) => ({ type: "goal" as const, id: g.id, label: g.data.title })),
        ...cats.filter((c) => effectiveKind(c.data) === "org").map((c) => ({ type: "org" as const, id: c.id, label: c.data.name })),
      ];
      setAttachOptions(opts);
      setProjCats(Object.fromEntries(pr.map((p) => [p.id, p.data.category])));
    })();
    return () => { on = false; };
  }, [projects, goals, categories]);

  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  const record = view.kind === "record" ? byId.get(view.id) ?? null : null;

  const goRecord = (id: string) => { setEditing(false); setArmedDelete(false); setRevisitOpen(false); setView({ kind: "record", id }); };
  const goList = () => { setEditing(false); setArmedDelete(false); setRevisitOpen(false); setView({ kind: "list" }); };

  const pushCls = usePushDepth(view.kind === "record" ? 1 : 0);

  const saveNew = async (draft: DecisionDraft) => {
    const ok = await attemptWrite(async () => {
      const id = await svc.create(draft);
      if (id) goRecord(id);
    });
    setSheet({ kind: "closed" });
    if (ok) await reload();
  };

  const saveSupersede = async (oldId: string, draft: DecisionDraft) => {
    let newId: string | null = null;
    const ok = await attemptWrite(async () => { newId = await svc.supersede(oldId, draft); });
    setSheet({ kind: "closed" });
    if (ok && newId) {
      goRecord(newId);
      await reload();
      const created = newId;
      showToast({ message: "Decision replaced", actionLabel: "Undo", onAction: () => void (async () => {
        await attemptWrite(() => svc.undoSupersede(created));
        goRecord(oldId);
        await reload();
      })() });
    }
  };

  const patch = async (id: string, p: Parameters<typeof svc.update>[1]) => {
    const ok = await attemptWrite(() => svc.update(id, p));
    if (ok) await reload();
  };

  // C-55: how it turned out. Three words, one tap, the record keeps the
  // word and the day. "Didn't" offers Change It, which is the supersede
  // path, because a call that did not work usually wants a new call.
  const markOutcome = async (rec: DecisionRecord, word: OutcomeWord) => {
    const ok = await attemptWrite(() => svc.markOutcome(rec.id, word));
    if (!ok) return;
    await reload();
    if (word === "didnt") showToast({ message: "Outcome · Didn't", actionLabel: "Change It", onAction: () => setSheet({ kind: "supersede", oldId: rec.id }) });
    else showToast({ message: "Outcome · " + OUTCOME_LABEL[word] });
  };

  // C-54: one memory, two relationships. The strand carries the decision as
  // its link, the decision carries the strand id. Rules are only ever
  // user-stated, and this is the person stating one from a call he made.
  const makeRule = async (rec: DecisionRecord) => {
    if (!strands) return;
    let id: string | null = null;
    const ok = await attemptWrite(async () => {
      id = await strands.add(rec.data.decision, "values", todayISO(), "rule", "principle", { entityType: ENTITY_DECISION, entityId: rec.id });
    });
    if (!ok) return;
    if (!id) { showToast({ message: "The Brain is full · Prune it in What JARVIS Knows" }); return; }
    await patch(rec.id, { ruleStrandId: id });
    showToast({ message: "Rule saved to Values · Linked to this decision" });
  };

  const deleteRecord = async (rec: DecisionRecord) => {
    const kept = rec.data;
    const ok = await attemptWrite(() => svc.remove(rec.id));
    setArmedDelete(false);
    if (ok) {
      goList();
      await reload();
      // BRAIN-F-14 (2026-09-05): restore, not create. create() re-dates the
      // record to now and re-arms a revisit that was already answered.
      showToast({ message: "Decision deleted", actionLabel: "Undo", onAction: () => void (async () => {
        await attemptWrite(() => svc.restore(rec.id, kept));
        await reload();
      })() });
    }
  };

  // ---- Screen 02: the record --------------------------------------------
  if (view.kind === "record") {
    if (!record) {
      // Deleted or unknown id: land on the list instead of a dead screen.
      return (
        <div className={pushCls} key="gone">
          <ListScreen live={live} loading={loading} projCat={(id) => projCats[id]} onBack={onBack} onOpen={goRecord} onAdd={() => setSheet({ kind: "new" })} />
          {sheet.kind === "new" && <DecisionCaptureSheet attachOptions={attachOptions} onSave={(d) => void saveNew(d)} onCancel={() => setSheet({ kind: "closed" })} />}
        </div>
      );
    }
    const d = record.data;
    const older = d.supersedesId ? byId.get(d.supersedesId) : undefined;
    const newer = d.supersededById ? byId.get(d.supersededById) : undefined;
    const links = linksOf(d);
    const toggleLink = (opt: AttachOption) => {
      const next = links.some((l) => l.id === opt.id)
        ? links.filter((l) => l.id !== opt.id)
        : [...links, { type: opt.type, id: opt.id, label: opt.label }];
      const first = next[0];
      void patch(record.id, {
        links: next.length ? next : undefined,
        linkedType: first?.type, linkedId: first?.id, linkedLabel: first?.label,
      });
    };
    const srcAt = d.source ? new Date(d.source.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    return (
      <div className={pushCls} key={"r-" + record.id}>
        <div className="screen ruled">
          <PageHeader
            title="Decision"
            back="Decisions"
            onBack={goList}
            actions={<BarAction label="Edit" onClick={() => setEditing(true)}>{PEN}</BarAction>}
          />

          <div className="sh2 sh2-quiet"><span className="t">Decided</span></div>
          <div className="pad-x"><div className="card pad">
            <InlineEdit
              className="dec-main"
              value={d.decision}
              focused={editing}
              onSave={(v) => { if (v && v !== d.decision) void patch(record.id, { decision: v }); }}
            />
          </div></div>

          <div className="sh2 sh2-quiet"><span className="t">Because</span></div>
          <div className="pad-x"><div className="card pad">
            <InlineEdit
              className="dec-why"
              value={d.why ?? ""}
              placeholder={NO_REASON}
              onSave={(v) => { if (v !== (d.why ?? "")) void patch(record.id, { why: v || undefined }); }}
            />
          </div></div>

          {/* THE NOTES (the writing system, wave 3c): the longer thinking,
              on the shared editor's compact level, saved when it loses
              focus. Optional: a decision that is one line stays one line. */}
          <div className="sh2 sh2-quiet"><span className="t">Notes</span></div>
          <div className="pad-x"><div className="card pad">
            <DecisionNotes id={record.id} value={d.notes ?? ""} onSave={(v) => { if (v !== (d.notes ?? "")) void patch(record.id, { notes: v || undefined }); }} />
          </div></div>

          {/* C-53: where it came from. A row that opens the origin when the
              host can take him there; otherwise it says, and that is all. */}
          {d.source && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Source</span></div>
              <div className="pad-x"><div className="card">
                {onOpenSource && d.source.entityId && SOURCE_ROUTE[d.source.kind] ? (
                  <div {...pressable(() => onOpenSource(SOURCE_ROUTE[d.source!.kind]!, d.source!.entityId!))} className="row">
                    <div className="row-grow"><div className="conn-name">{SOURCE_LABEL[d.source.kind]} · {srcAt}</div></div>
                    <Chev />
                  </div>
                ) : (
                  <div className="row"><div className="row-grow"><div className="conn-name">{SOURCE_LABEL[d.source.kind]} · {srcAt}</div></div></div>
                )}
              </div></div>
            </>
          )}

          {(editing || d.expected) && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Expected</span></div>
              <div className="pad-x"><div className="card pad">
                <InlineEdit
                  className="dec-why"
                  value={d.expected ?? ""}
                  placeholder="What This Should Do"
                  onSave={(v) => { if (v !== (d.expected ?? "")) void patch(record.id, { expected: v || undefined }); }}
                />
              </div></div>
            </>
          )}

          {(editing || (d.ruledOut?.length ?? 0) > 0) && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Ruled Out</span></div>
              <div className="pad-x"><div className="card pad">
                {(d.ruledOut?.length ?? 0) > 0 && (
                  <div className="chip-row">
                    {(d.ruledOut ?? []).map((r) => (
                      <div key={r} className="chip" role={editing ? "button" : undefined} tabIndex={editing ? 0 : undefined}
                        onClick={editing ? () => void patch(record.id, { ruledOut: (d.ruledOut ?? []).filter((x) => x !== r) }) : undefined}>
                        {r}
                      </div>
                    ))}
                  </div>
                )}
                {editing && <RuleAdder onAdd={(v) => void patch(record.id, { ruledOut: [...(d.ruledOut ?? []), v] })} />}
              </div></div>
            </>
          )}

          {(editing || d.revisitOn) && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Revisit</span></div>
              <div className="pad-x"><div className="card">
                {/* Row tap (Dave 2026-09-15, "I want all rows clickable"): the
                    whole line opens the date, as its chip does. */}
                <div className="row" {...pressable(() => setRevisitOpen(!revisitOpen))}>
                  <div className="row-grow"><div className="conn-name">Shows on Today</div></div>
                  <div {...pressable(() => setRevisitOpen(!revisitOpen))} onClick={(ev) => { ev.stopPropagation(); setRevisitOpen(!revisitOpen); }} className="chip">
                    {d.revisitOn ? fmtDay(d.revisitOn) : "No Date"}
                  </div>
                </div>
                {d.revisitState === "confirmed" && d.confirmedAt && (
                  <div className="row"><div className="row-stack"><div className="conn-meta"><span className="fact-good">Still good</span> · Confirmed {fmtDay(d.confirmedAt)}</div></div></div>
                )}
                {revisitOpen && (
                  // Row tap (Dave 2026-09-15): the form row focuses its date field.
                  <div className="row" onClick={(ev) => { if (ev.target === ev.currentTarget) revisitRef.current?.focus(); }}>
                    <input ref={revisitRef} type="date" className="input" value={d.revisitOn ?? ""}
                      onChange={(e) => { void patch(record.id, { revisitOn: e.target.value || undefined }); setRevisitOpen(false); }} />
                    {d.revisitOn && <div {...pressable(() => { void patch(record.id, { revisitOn: undefined }); setRevisitOpen(false); })} onClick={(ev) => { ev.stopPropagation(); void patch(record.id, { revisitOn: undefined }); setRevisitOpen(false); }} className="chip">Clear</div>}
                  </div>
                )}
              </div></div>
            </>
          )}

          {(editing || links.length > 0) && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Attached To</span></div>
              <div className="pad-x"><div className="card pad">
                {/* C-53: every home, as facts; while editing, every option as
                    a chooser chip, the ones it holds filled. */}
                {!editing && (
                  <div className="facts">{links.map((l) => <span className="fact" key={l.id}>{l.label}</span>)}</div>
                )}
                {editing && (
                  <div className="chip-row chip-wrap-row">
                    {[...attachOptions, ...links.filter((l) => !attachOptions.some((o) => o.id === l.id)).map((l) => ({ type: l.type, id: l.id, label: l.label }))].map((o) => (
                      <div key={o.id} className={"chip" + (links.some((l) => l.id === o.id) ? " active" : "")} role="checkbox" aria-checked={links.some((l) => l.id === o.id)} tabIndex={0}
                        onClick={() => toggleLink(o)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleLink(o); } }}>
                        {o.label}
                      </div>
                    ))}
                  </div>
                )}
              </div></div>
            </>
          )}

          {/* C-55: how it turned out. The card is the harness's: the word
              and three capsules. Not offered on a superseded record, whose
              outcome is the call that replaced it. */}
          {!newer && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Outcome</span></div>
              <div className="pad-x"><div className="card">
                <div className="row">
                  <div className="row-grow">
                    <div className="conn-name">{d.outcome ? OUTCOME_LABEL[d.outcome.word] : "Mark Outcome"}</div>
                    {d.outcome && <div className="conn-meta">Marked {fmtDay(d.outcome.at)}</div>}
                  </div>
                </div>
                {/* row-tap: the three outcome capsules fill this line; it is a verb strip, not an item */}
                <div className="row dec-outcome-acts">
                  {(["worked", "mixed", "didnt"] as OutcomeWord[]).map((w) => (
                    <button type="button" key={w} className={"pill-act" + (d.outcome?.word === w ? " on" : "")} aria-pressed={d.outcome?.word === w} onClick={() => void markOutcome(record, w)}>{OUTCOME_LABEL[w]}</button>
                  ))}
                </div>
              </div></div>
            </>
          )}

          {older && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Replaces</span></div>
              <div className="pad-x"><div className="card">
                <div {...pressable(() => goRecord(older.id))} className="row">
                  <div className="row-stack">
                    <div className="dec-old">{older.data.decision}</div>
                    <div className="dec-meta">Recorded {fmtDay(older.data.createdAt)}</div>
                  </div>
                  <Chev />
                </div>
              </div></div>
            </>
          )}

          {newer && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Replaced By</span></div>
              <div className="pad-x"><div className="card">
                <div {...pressable(() => goRecord(newer.id))} className="row">
                  <div className="row-stack">
                    <div className="conn-name">{newer.data.decision}</div>
                    <div className="dec-meta">Recorded {fmtDay(newer.data.createdAt)}</div>
                  </div>
                  <Chev />
                </div>
              </div></div>
            </>
          )}

          <div className="pad-x"><div className="card">
            <div className="row"><div className="row-stack"><div className="conn-meta">Recorded {fmtDay(d.createdAt)}</div></div></div>
          </div></div>

          {!newer && (
            <div className="pad-x"><div className="card">
              {/* C-54: a call becomes a standing rule, by his hand only. */}
              {strands && !d.ruleStrandId && (
                <button className="row row-act" onClick={() => void makeRule(record)}>Make It a Rule</button>
              )}
              {d.ruleStrandId && (
                <div className="row"><div className="row-stack"><div className="conn-meta"><span className="fact st red">Rule</span> · Saved to Values</div></div></div>
              )}
              <button className="row row-act" onClick={() => setSheet({ kind: "supersede", oldId: record.id })}>Change It</button>
              {!armedDelete
                ? <button className="row row-signout" onClick={() => setArmedDelete(true)}>Delete Decision</button>
                : <button className="row row-signout" onClick={() => void deleteRecord(record)}>Tap to Confirm</button>}
            </div></div>
          )}

          <div className="screen-foot" />
        </div>
        {sheet.kind === "supersede" && (
          <DecisionCaptureSheet
            mode="supersede"
            initial={{ ruledOut: d.ruledOut, linkedType: d.linkedType, linkedId: d.linkedId, linkedLabel: d.linkedLabel, links: d.links }}
            attachOptions={attachOptions}
            onSave={(draft) => void saveSupersede(record.id, draft)}
            onCancel={() => setSheet({ kind: "closed" })}
          />
        )}
      </div>
    );
  }

  // ---- Screen 01 / 06: the list and its empty state ----------------------
  return (
    <div className={pushCls} key="base">
      <ListScreen live={live} loading={loading} projCat={(id) => projCats[id]} onBack={onBack} onOpen={goRecord} onAdd={() => setSheet({ kind: "new" })} />
      {sheet.kind === "new" && <DecisionCaptureSheet attachOptions={attachOptions} onSave={(d) => void saveNew(d)} onCancel={() => setSheet({ kind: "closed" })} />}
    </div>
  );
}

// The add-input for Ruled Out while editing: Enter or blur commits.
function RuleAdder({ onAdd }: { onAdd: (v: string) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => { const v = draft.trim(); if (v) { onAdd(v); setDraft(""); } };
  return (
    <input className="input field-gap" placeholder="Option you closed · Enter adds" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      onBlur={commit} />
  );
}

function ListScreen({ live, loading, projCat, onBack, onOpen, onAdd }: {
  live: DecisionRecord[];
  loading: boolean;
  projCat: (id: string) => string | undefined;
  onBack: () => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="screen ruled">
      <PageHeader
        title="Decisions"
        back="Brain"
        onBack={onBack}
        actions={<BarAction label="Add" onClick={onAdd}>{PLUS}</BarAction>}
      />
      {!loading && live.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">{DECISION_ICO}</div>
          <div className="empty-title">Worth Remembering</div>
          {/* ONE LINE, LIKE EVERY OTHER EMPTY STATE (Dave 2026-09-03, pic 1:
              "too much subtext"). This ran two sentences and three lines
              while its siblings run one short line each ("A goal is what the
              work is for", "Everything you achieve lands here, dated,
              forever"). The payoff is the only fact worth keeping: the
              reason outlives the memory of it. */}
          <div className="empty-sub">The reason is still here in six weeks</div>
          <button className="btn btn-primary" onClick={onAdd}>Record a Decision</button>
        </div>
      )}
      {/* Universal sectioning law: rows always sit under an sh2 head. No
          count here: a count of decisions is a guilt metric (spec law). */}
      {live.length > 0 && <div className="sh2 sh2-quiet"><span className="t">All Decisions</span></div>}
      {/* THE DECISION ROW (Astra, 2026-09-12; C-50, C-53). The star leads,
          the glyph wears the first home's colour, the call, the reason when
          there is one, and one facts line: its homes that sit in an area,
          its outcome, and the revisit day or the day it was recorded. */}
      {live.length > 0 && (
        <div className="pad-x"><div className="card list-card-ruled">
          {live.map((r) => (
            <div {...pressable(() => onOpen(r.id))} className="row dec-row" key={r.id}>
              <EntityStar entityType={ENTITY_DECISION} entityId={r.id} title={r.data.decision} />
              <div className={"lib-ico " + glyphClass(r, projCat)}>{DECISION_ICO}</div>
              <div className="row-grow">
                <div className="conn-name dec-name">{r.data.decision}</div>
                {/* A row with no reason says nothing about it (§AK): the
                    "No reason recorded" line stated nothing, and it spent the
                    row's one grey doing it. The record page still offers the
                    empty field. */}
                {r.data.why && <div className="conn-meta truncate">{"Because " + r.data.why}</div>}
                <div className="facts">
                  {/* Where it came from is on the record page, not here: the
                      row already spends its grey on the reason.
                      Each home is its OWN area (§AM): a project's category,
                      or the area itself, on the dot; the name stays the
                      line's grey, told apart by the dot.
                      ONLY A HOME IN AN AREA IS ON THE ROW (lead, 2026-09-26).
                      A person, goal or task, or a project with no category,
                      has no dot to wear, so its name was a second bare grey
                      beside the reason (§AK). The record page's Attached To
                      card names every home, the same move that took the
                      source off the row. */}
                  {linksOf(r.data).map((l) => {
                    const slot = linkAreaSlot(l, projCat);
                    return slot
                      ? <span className="fact cat fact-link" key={l.id}><span className={"cd cat-bg-" + slot} /><span className="cat-t">{l.label}</span></span>
                      : null;
                  })}
                  {/* How it turned out takes the key: worked is done, mixed
                      needs him, didn't is missed. */}
                  {r.data.outcome && <span className={"fact " + OUTCOME_KEY[r.data.outcome.word]}>{OUTCOME_LABEL[r.data.outcome.word]}</span>}
                  {/* A date is SMALL CAPS (§AM F5, 2026-09-22). This asked
                      for cyan and never got it -- .fact.cyan is scoped to
                      .ruled.health-ruled and this screen is plain .ruled --
                      so the date drew as a second plain grey beside the
                      reason on every decision row. Caps is told apart by its
                      letterforms, so the row keeps its one grey for the
                      words. The dead .cyan is gone with it, and the date is
                      the shared .fact.date primitive, not a class of its own. */}
                  <span className="fact date">{r.data.revisitOn && (r.data.revisitState === "pending" || r.data.revisitState === "shown") ? "Revisit " + fmtShort(r.data.revisitOn) : fmtShort(r.data.createdAt)}</span>
                </div>
              </div>
              <Chev />
            </div>
          ))}
        </div></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}

// The decision's notes field: the string is held here while it is typed and
// written once, when the editor loses focus.
function DecisionNotes({ id, value, onSave }: { id: string; value: string; onSave: (v: string) => void }) {
  const draft = useRef(value);
  useEffect(() => { draft.current = value; }, [value, id]);
  return (
    <MarkdownField
      value={value}
      docKey={"decision:" + id}
      level="compact"
      placeholder="The Longer Thinking, If There Is Any"
      ariaLabel="Decision notes"
      onChange={(v) => { draft.current = v; }}
      onBlur={() => onSave(draft.current)}
    />
  );
}
