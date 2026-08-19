import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDecisions, useProjects, useGoals, useCategories } from "../data/NotesProvider";
import PageHeader, { BarAction } from "../shared/PageHeader";
import InlineEdit from "../shared/InlineEdit";
import DecisionCaptureSheet, { type AttachOption, type DecisionDraft } from "./DecisionCaptureSheet";
import type { DecisionRecord } from "./types";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { usePushDepth } from "../shared/pushNav";
import { catColor } from "../shared/categories";
import { effectiveKind } from "../categories/kinds";

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
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

// The spec'd display copy for an empty reason (renders in tx-4 through the
// InlineEdit placeholder slot). Display copy, not a form label, so it stays
// sentence case by design.
const NO_REASON = "No reason recorded";

// "August 12" from a local ISO date or an ISO datetime.
// "Aug 12" for the list's trailing date column.
const fmtShort = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const fmtDay = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });

// The list glyph wears the linked entity's color and goes quiet when the
// decision stands alone.
function glyphClass(rec: DecisionRecord, projectCat: (id: string) => string | undefined): string {
  const t = rec.data.linkedType;
  // V4 styling pass: an unlinked decision wears the decision type color
  // (purple), never grey; nothing with an identity is grey.
  if (!t || !rec.data.linkedId) return "cat-fg-purple";
  if (t === "project") {
    const cat = projectCat(rec.data.linkedId);
    return cat ? "cat-fg-" + catColor(cat) : "cat-fg-indigo";
  }
  if (t === "org") return "cat-fg-" + catColor(rec.data.linkedId);
  if (t === "goal") return "cat-fg-purple";
  if (t === "person") return "cat-fg-teal";
  return "cat-fg-blue"; // task
}

export default function DecisionsFlow({ onBack, openId }: { onBack: () => void; openId?: string }) {
  const svc = useDecisions();
  const projects = useProjects();
  const goals = useGoals();
  const categories = useCategories();

  const [live, setLive] = useState<DecisionRecord[]>([]);
  const [all, setAll] = useState<DecisionRecord[]>([]);
  const [attachOptions, setAttachOptions] = useState<AttachOption[]>([]);
  const [projCats, setProjCats] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{ kind: "list" } | { kind: "record"; id: string }>(openId ? { kind: "record", id: openId } : { kind: "list" });
  const [sheet, setSheet] = useState<{ kind: "closed" } | { kind: "new" } | { kind: "supersede"; oldId: string }>({ kind: "closed" });
  const [editing, setEditing] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [revisitOpen, setRevisitOpen] = useState(false);

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
        ...gl.filter((g) => g.data.state !== "achieved").map((g) => ({ type: "goal" as const, id: g.id, label: g.data.title })),
        ...cats.filter((c) => effectiveKind(c.data) === "org").map((c) => ({ type: "org" as const, id: c.id, label: c.data.name })),
      ];
      setAttachOptions(opts);
      setProjCats(Object.fromEntries(pr.map((p) => [p.id, p.data.category])));
    })();
    return () => { on = false; };
  }, [projects, goals, categories]);

  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  const record = view.kind === "record" ? byId.get(view.id) ?? null : null;

  const goRecord = (id: string) => { setEditing(false); setArmedDelete(false); setAttachOpen(false); setRevisitOpen(false); setView({ kind: "record", id }); };
  const goList = () => { setEditing(false); setArmedDelete(false); setAttachOpen(false); setRevisitOpen(false); setView({ kind: "list" }); };

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

  const deleteRecord = async (rec: DecisionRecord) => {
    const kept = rec.data;
    const ok = await attemptWrite(() => svc.remove(rec.id));
    setArmedDelete(false);
    if (ok) {
      goList();
      await reload();
      showToast({ message: "Decision deleted", actionLabel: "Undo", onAction: () => void (async () => {
        await attemptWrite(() => svc.create(kept));
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
    const attachLabel = d.linkedLabel ?? attachOptions.find((o) => o.id === d.linkedId)?.label;
    return (
      <div className={pushCls} key={"r-" + record.id}>
        <div className="screen">
          <PageHeader
            title="Decision"
            back="Decisions"
            onBack={goList}
            actions={<BarAction label="Edit" onClick={() => setEditing(true)}>{PEN}</BarAction>}
          />

          <div className="grp"><div className="eyebrow">Decided</div></div>
          <div className="pad-x"><div className="card pad">
            <InlineEdit
              className="dec-main"
              value={d.decision}
              focused={editing}
              onSave={(v) => { if (v && v !== d.decision) void patch(record.id, { decision: v }); }}
            />
          </div></div>

          <div className="grp"><div className="eyebrow">Because</div></div>
          <div className="pad-x"><div className="card pad">
            <InlineEdit
              className="dec-why"
              value={d.why ?? ""}
              placeholder={NO_REASON}
              onSave={(v) => { if (v !== (d.why ?? "")) void patch(record.id, { why: v || undefined }); }}
            />
          </div></div>

          {(editing || (d.ruledOut?.length ?? 0) > 0) && (
            <>
              <div className="grp"><div className="eyebrow">Ruled Out</div></div>
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
              <div className="grp"><div className="eyebrow">Revisit</div></div>
              <div className="pad-x"><div className="card">
                <div className="row">
                  <div className="row-grow"><div className="conn-name">Shows on Today</div></div>
                  <div className="chip" role="button" tabIndex={0} onClick={() => setRevisitOpen(!revisitOpen)}>
                    {d.revisitOn ? fmtDay(d.revisitOn) : "No Date"}
                  </div>
                </div>
                {d.revisitState === "confirmed" && d.confirmedAt && (
                  <div className="row"><div className="row-stack"><div className="conn-meta"><span className="fact-good">Still good</span> · Confirmed {fmtDay(d.confirmedAt)}</div></div></div>
                )}
                {revisitOpen && (
                  <div className="row">
                    <input type="date" className="input" value={d.revisitOn ?? ""}
                      onChange={(e) => { void patch(record.id, { revisitOn: e.target.value || undefined }); setRevisitOpen(false); }} />
                    {d.revisitOn && <div className="chip" role="button" tabIndex={0} onClick={() => { void patch(record.id, { revisitOn: undefined }); setRevisitOpen(false); }}>Clear</div>}
                  </div>
                )}
              </div></div>
            </>
          )}

          {(editing || d.linkedId) && (
            <>
              <div className="grp"><div className="eyebrow">Attached To</div></div>
              <div className="pad-x"><div className="card pad">
                {!attachOpen ? (
                  <div className="chip-row">
                    <div className="chip active" role="button" tabIndex={0} onClick={() => setAttachOpen(true)}>{attachLabel ?? "None"}</div>
                  </div>
                ) : (
                  <div className="chip-row">
                    <div className={"chip" + (!d.linkedId ? " active" : "")} role="button" tabIndex={0}
                      onClick={() => { void patch(record.id, { linkedType: undefined, linkedId: undefined, linkedLabel: undefined }); setAttachOpen(false); }}>None</div>
                    {attachOptions.map((o) => (
                      <div key={o.id} className={"chip" + (o.id === d.linkedId ? " active" : "")} role="button" tabIndex={0}
                        onClick={() => { void patch(record.id, { linkedType: o.type, linkedId: o.id, linkedLabel: o.label }); setAttachOpen(false); }}>{o.label}</div>
                    ))}
                  </div>
                )}
              </div></div>
            </>
          )}

          {older && (
            <>
              <div className="grp"><div className="eyebrow">Replaces</div></div>
              <div className="pad-x"><div className="card">
                <div className="row" role="button" tabIndex={0} onClick={() => goRecord(older.id)}>
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
              <div className="grp"><div className="eyebrow">Replaced By</div></div>
              <div className="pad-x"><div className="card">
                <div className="row" role="button" tabIndex={0} onClick={() => goRecord(newer.id)}>
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
            initial={{ ruledOut: d.ruledOut, linkedType: d.linkedType, linkedId: d.linkedId, linkedLabel: d.linkedLabel }}
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
    <div className="screen">
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
          <div className="empty-sub">When you make a call worth remembering, write down why. In six weeks the reason is still here.</div>
          <button className="btn btn-primary" onClick={onAdd}>Record a Decision</button>
        </div>
      )}
      {/* Universal sectioning law: rows always sit under an sh2 head. No
          count here: a count of decisions is a guilt metric (spec law). */}
      {live.length > 0 && <div className="sh2"><span className="t">All Decisions</span></div>}
      {live.length > 0 && live.map((r) => (
        <div className="lib-row" key={r.id} role="button" tabIndex={0} onClick={() => onOpen(r.id)}>
          <div className={"lib-ico " + glyphClass(r, projCat)}>{DECISION_ICO}</div>
          <div className="lib-stack">
            <div className="msg-line">
              <span className="lib-name conn-name dec-name">{r.data.decision}</span>
              <span className="dec-when">{fmtShort(r.data.createdAt)}</span>
            </div>
            <div className="lib-sub">
              {r.data.why ? "Because " + r.data.why : NO_REASON}
              {r.data.linkedLabel && <> · <span className={"fact-link " + glyphClass(r, projCat)}>{r.data.linkedLabel}</span></>}
            </div>
          </div>
          <Chev />
        </div>
      ))}
      <div className="screen-foot" />
    </div>
  );
}
