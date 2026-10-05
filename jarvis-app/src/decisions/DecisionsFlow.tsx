import { useCallback, useEffect, useMemo, useState, type ReactNode, useRef } from "react";
import FiledRows from "../brain/manual/FiledRows";
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
import { dayTone } from "../messages/factsLine";
import EntityStar from "../shared/EntityStar";
import { titleCase } from "../shared/casing";
import RowActionSheet from "../shared/RowActionSheet";
import RowCtxAction from "../shared/RowCtxAction";
import SwipeDelete from "../shared/SwipeDelete";
import { MoreHorizontal } from "../shared/icons";
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

// The empty reason's invitation (renders in tx-4 through the InlineEdit
// placeholder slot). Title Case like its siblings ("What This Should Do", "The
// Longer Thinking, If There Is Any"): it was the sentence-case "No reason
// recorded", a line stating a fact the empty field already shows (catalog gate,
// Dave 2026-10-05).
const NO_REASON = "Why You Chose It";

// "Aug 12" for the list's trailing date column (shared/dateFormat: noon-local
// so a bare date never rolls back a day west of Greenwich).
const fmtShort = shortDate;

// "August 12" from a local ISO date or an ISO datetime.
export const fmtDay = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });

// THE DECISION GLYPH HAS ONE COLOUR (Dave 2026-10-05, the review: "the fork was purple, purple, blue, because it took the
// first home's area colour, while each row also had an area dot, so one decision wore a blue glyph and a blue dot"). The
// glyph says what the row IS, so it is the decision type's own tone on every row; which area it sits in is the dot's job.
const DECISION_TONE = "cat-fg-purple";

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

// What a home IS, as the one grey on its row on the record page.
const HOME_WORD: Record<string, string> = { project: "Project", goal: "Goal", org: "Area", person: "Person", task: "Task" };

// A revisit still waiting on him (pending, or shown on Today) is a due date,
// so it takes the reminder window (§AM R8): late red, today or tomorrow
// amber, later a neutral small-caps date. Once answered or expired it is no
// longer his to do, and the row falls back to the day the call was made,
// which is always a neutral date.
function whenFact(d: DecisionRecord["data"], today: string): { text: string; tone: "red" | "warn" | "date" } {
  const revisit = d.revisitOn && (d.revisitState === "pending" || d.revisitState === "shown") ? d.revisitOn : null;
  return revisit
    ? { text: "Revisit " + fmtShort(revisit), tone: dayTone(revisit, today) }
    : { text: fmtShort(d.createdAt), tone: "date" };
}

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
     
  }, [openId, openNonce]);
  const [sheet, setSheet] = useState<{ kind: "closed" } | { kind: "new" } | { kind: "supersede"; oldId: string }>({ kind: "closed" });
  const [editing, setEditing] = useState(false);
  // The record page's menu (Change It, Make It a Rule, Delete) and the confirm that stands in front of the delete.
  const [menu, setMenu] = useState<"closed" | "more" | "confirm">("closed");
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

  const goRecord = (id: string) => { setEditing(false); setMenu("closed"); setRevisitOpen(false); setView({ kind: "record", id }); };
  const goList = () => { setEditing(false); setMenu("closed"); setRevisitOpen(false); setView({ kind: "list" }); };

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
      showToast({ message: "Decision Replaced", actionLabel: "Undo", onAction: () => void (async () => {
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
    if (word === "didnt") showToast({ message: "Marked Didn't", actionLabel: "Change It", onAction: () => setSheet({ kind: "supersede", oldId: rec.id }) });
    else showToast({ message: "Marked " + OUTCOME_LABEL[word] });
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
    if (!id) { showToast({ message: "The Brain Is Full · Prune It in What JARVIS Knows" }); return; }
    await patch(rec.id, { ruleStrandId: id });
    showToast({ message: "Rule Saved to Values · Linked to This Decision" });
  };

  const deleteRecord = async (rec: DecisionRecord) => {
    const kept = rec.data;
    const ok = await attemptWrite(() => svc.remove(rec.id));
    setMenu("closed");
    if (ok) {
      goList();
      await reload();
      // BRAIN-F-14 (2026-09-05): restore, not create. create() re-dates the
      // record to now and re-arms a revisit that was already answered.
      showToast({ message: "Decision Deleted", actionLabel: "Undo", onAction: () => void (async () => {
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
          <ListScreen live={live} loading={loading} projCat={(id) => projCats[id]} onBack={onBack} onOpen={goRecord} onDelete={(r) => void deleteRecord(r)} onAdd={() => setSheet({ kind: "new" })} />
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
            actions={<>
              <BarAction label="Edit" onClick={() => setEditing(true)}>{PEN}</BarAction>
              {!newer && <BarAction label="More" onClick={() => setMenu("more")}><MoreHorizontal className="ic" /></BarAction>}
            </>}
          />

          <div className="sh2 sh2-quiet"><span className="t">Decided</span></div>
          <div className="pad-x"><div className="card pad">
            <InlineEdit
              className="dec-main"
              value={d.decision}
              display={titleCase}
              focused={editing}
              onSave={(v) => { if (v && v !== d.decision) void patch(record.id, { decision: v }); }}
            />
            {/* WHEN IT WAS RECORDED IS A CAPTION UNDER THE DECISION, not a card of its own (Dave 2026-10-05, the review: a
                titleless box at the foot holding only "RECORDED OCT 5", the same line the Replaces row already carried). */}
            <div className="facts dec-recorded"><span className="fact date">Recorded {fmtShort(d.createdAt)}</span></div>
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
          <div className="pad-x"><div className="card pad dec-notes">
            <DecisionNotes id={record.id} value={d.notes ?? ""} onSave={(v) => { if (v !== (d.notes ?? "")) void patch(record.id, { notes: v || undefined }); }} />
          </div></div>

          {/* C-53: where it came from. A row that opens the origin when the
              host can take him there; otherwise it says, and that is all.
              The kind is the row's name and the moment is a neutral date
              under it, in small caps (§AM F5): the two used to share the
              title, joined by a typed dot. */}
          {d.source && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Source</span></div>
              <div className="pad-x"><div className="card">
                {onOpenSource && d.source.entityId && SOURCE_ROUTE[d.source.kind] ? (
                  <div {...pressable(() => onOpenSource(SOURCE_ROUTE[d.source!.kind]!, d.source!.entityId!))} className="row">
                    <div className="row-grow">
                      <div className="conn-name">{SOURCE_LABEL[d.source.kind]}</div>
                      <div className="facts"><span className="fact date">{srcAt}</span></div>
                    </div>
                    <Chev />
                  </div>
                ) : (
                  <div className="row"><div className="row-grow">
                    <div className="conn-name">{SOURCE_LABEL[d.source.kind]}</div>
                    <div className="facts"><span className="fact date">{srcAt}</span></div>
                  </div></div>
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
              <div className="pad-x"><div className="card">
                {/* ROWS, NOT CHIPS (Dave 2026-10-05, locked: no pills inside a card). Each closed option is a row in its own
                    words (Title Case, stored as typed); while editing, its one quiet verb is Remove, as text. */}
                {(d.ruledOut ?? []).map((r) => (
                  <div key={r} className="row">
                    <div className="row-grow"><div className="conn-name">{titleCase(r)}</div></div>
                    <RowCtxAction when={editing} label="Remove" ariaLabel={"Remove " + titleCase(r)} onAct={() => void patch(record.id, { ruledOut: (d.ruledOut ?? []).filter((x) => x !== r) })} />
                  </div>
                ))}
                {editing && <div className="row"><RuleAdder onAdd={(v) => void patch(record.id, { ruledOut: [...(d.ruledOut ?? []), v] })} /></div>}
              </div></div>
            </>
          )}

          {(editing || d.revisitOn) && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Revisit</span></div>
              <div className="pad-x"><div className="card">
                {/* Row tap (Dave 2026-09-15, "I want all rows clickable"): the
                    whole line opens the date, as its chip does. */}
                {/* CLEAN ROWS (Dave 2026-10-05, locked: no chip on a row, and a row with nothing to say shows nothing).
                    The date was a chip at the row's edge, and "No Date" a placeholder in it. It is a fact under the
                    title now, keyed like the list's revisit (a due revisit is amber or red, a later one a neutral
                    date), and with no date the row says nothing and offers the chevron. */}
                <div className="row" {...pressable(() => setRevisitOpen(!revisitOpen))}>
                  <div className="row-grow">
                    <div className="conn-name">Shows on Today</div>
                    {d.revisitOn && (
                      <div className="facts"><span className={"fact " + (d.revisitState === "pending" || d.revisitState === "shown" ? dayTone(d.revisitOn, todayISO()) : "date")}>{fmtShort(d.revisitOn)}</span></div>
                    )}
                  </div>
                  <Chev />
                </div>
                {/* The answer takes the key (on track is green) and the day he
                    gave it is a neutral small-caps date (§AM F5); the CSS
                    draws the dot between them. */}
                {d.revisitState === "confirmed" && d.confirmedAt && (
                  <div className="row"><div className="row-stack"><div className="facts"><span className="fact good">Still Good</span><span className="fact date">Confirmed {fmtShort(d.confirmedAt)}</span></div></div></div>
                )}
                {revisitOpen && (
                  // Row tap (Dave 2026-09-15): the form row focuses its date field.
                  <div className="row" onClick={(ev) => { if (ev.target === ev.currentTarget) revisitRef.current?.focus(); }}>
                    <input ref={revisitRef} type="date" className="input" value={d.revisitOn ?? ""}
                      onChange={(e) => { void patch(record.id, { revisitOn: e.target.value || undefined }); setRevisitOpen(false); }} />
                    {/* Clear is the row's one quiet verb, as text (Dave 2026-10-05: no capsule on a row). */}
                    <RowCtxAction when={!!d.revisitOn} label="Clear" ariaLabel="Clear Revisit Date" onAct={() => { void patch(record.id, { revisitOn: undefined }); setRevisitOpen(false); }} />
                  </div>
                )}
              </div></div>
            </>
          )}

          {(editing || links.length > 0) && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Attached To</span></div>
              <div className="pad-x"><div className="card">
                {/* C-53: every home, as a row of its own: its name as the title (it wraps to two lines, never an ellipsis in
                    a card with the room), and what it IS as the line's one grey, with the area's dot where the home is an
                    area (Dave 2026-10-05, the review: "Rebuild Calder..." cut at 125px beside 200px of empty card). While
                    editing, every option is a chooser chip, the ones it holds filled. */}
                {!editing && links.map((l) => {
                  const slot = linkAreaSlot(l, (id) => projCats[id]);
                  return (
                    <div className="row" key={l.id}>
                      <div className="row-grow">
                        <div className="conn-name dec-name">{titleCase(l.label)}</div>
                        <div className="facts">
                          {slot
                            ? <span className="fact cat"><span className={"cd cat-bg-" + slot} />{HOME_WORD[l.type] ?? "Item"}</span>
                            : <span className="fact">{HOME_WORD[l.type] ?? "Item"}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {editing && (
                  <div className="pad"><div className="chip-row chip-wrap-row">
                    {[...attachOptions, ...links.filter((l) => !attachOptions.some((o) => o.id === l.id)).map((l) => ({ type: l.type, id: l.id, label: l.label }))].map((o) => (
                      <div key={o.id} className={"chip" + (links.some((l) => l.id === o.id) ? " active" : "")} role="checkbox" aria-checked={links.some((l) => l.id === o.id)} tabIndex={0}
                        onClick={() => toggleLink(o)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleLink(o); } }}>
                        {titleCase(o.label)}
                      </div>
                    ))}
                  </div></div>
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
              {/* THE CONTROL STANDS ON ITS OWN (Dave 2026-10-05, the review: a card, with a track inside it, with a pill
                  inside the track, three nested containers; and a title row that said the word the control already shows).
                  The three words are a CHOICE, one of three, so they are the app's segmented control and not three capsules.
                  The day it was marked is the caption under it. */}
              <div className="pad-x">
                <div className="segmented seg-tri" role="group" aria-label="Outcome">
                  {(["worked", "mixed", "didnt"] as OutcomeWord[]).map((w) => (
                    <button type="button" key={w} aria-pressed={d.outcome?.word === w} className={"seg" + (d.outcome?.word === w ? " active" : "")} onClick={() => void markOutcome(record, w)}>{OUTCOME_LABEL[w]}</button>
                  ))}
                </div>
                {d.outcome && (
                  <div className="dec-marked">
                    <div className="facts"><span className="fact date">Marked {fmtShort(d.outcome.at)}</span></div>
                    {/* A call that did not work usually wants a new call: its moment has come, so its one action shows as
                        text (the same Change It the toast offers), never as a capsule. */}
                    <RowCtxAction when={d.outcome.word === "didnt"} label="Change It" onAct={() => setSheet({ kind: "supersede", oldId: record.id })} />
                  </div>
                )}
              </div>
            </>
          )}

          {older && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Replaces</span></div>
              <div className="pad-x"><div className="card">
                <div {...pressable(() => goRecord(older.id))} className="row">
                  {/* THE OLD CALL IS STRUCK THROUGH IN FULL INK, AND SAYS WHAT IT IS (Dave 2026-10-05, the review: near-grey
                      strikethrough with a caps date and a lone chevron, no word that it was the one replaced). The strike is the
                      treatment; Replaced is the line's one grey. */}
                  <div className="row-stack">
                    <div className="dec-old">{titleCase(older.data.decision)}</div>
                    <div className="facts"><span className="fact">Replaced</span></div>
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
                    <div className="conn-name">{titleCase(newer.data.decision)}</div>
                  </div>
                  <Chev />
                </div>
              </div></div>
            </>
          )}


          {/* Clean cards (Dave 2026-10-05, locked): Change It, Make It a Rule and Delete are the record's actions, so they live in
              its More menu on the bar, never as rows at the foot of a card. What stays on the page is the fact that it is a rule. */}
          {!newer && d.ruleStrandId && (
            <div className="pad-x"><div className="card">
              {/* Rule is a state word (§AM, as on the Brain): its caps set it
                  apart, and it is not late, so it wears no red. The dot
                  between it and the fact is drawn by the CSS. */}
              <div className="row"><div className="row-stack"><div className="facts"><span className="fact st">Rule</span><span className="fact">Saved to Values</span></div></div></div>
            </div></div>
          )}

          <div className="screen-foot" />
        </div>
        {menu === "more" && !newer && (
          <RowActionSheet
            title="Decision"
            actions={[
              { label: "Change It", onPick: () => setSheet({ kind: "supersede", oldId: record.id }) },
              ...(strands && !d.ruleStrandId ? [{ label: "Make It a Rule", onPick: () => void makeRule(record) }] : []),
              // A decision is the reasoning nobody can rebuild, so the delete stands behind its own confirm (button audit 2026-09-19).
              { label: "Delete Decision", destructive: true, onPick: () => setMenu("confirm") },
            ]}
            onCancel={() => setMenu((m) => (m === "more" ? "closed" : m))}
          />
        )}
        {menu === "confirm" && (
          <RowActionSheet
            title="Delete This Decision?"
            actions={[{ label: "Delete Decision", destructive: true, onPick: () => void deleteRecord(record) }]}
            onCancel={() => setMenu("closed")}
          />
        )}
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
      <ListScreen live={live} loading={loading} projCat={(id) => projCats[id]} onBack={onBack} onOpen={goRecord} onDelete={(r) => void deleteRecord(r)} onAdd={() => setSheet({ kind: "new" })} />
      {sheet.kind === "new" && <DecisionCaptureSheet attachOptions={attachOptions} onSave={(d) => void saveNew(d)} onCancel={() => setSheet({ kind: "closed" })} />}
    </div>
  );
}

// The add-input for Ruled Out while editing: Enter or blur commits.
function RuleAdder({ onAdd }: { onAdd: (v: string) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => { const v = draft.trim(); if (v) { onAdd(v); setDraft(""); } };
  return (
    <input className="input field-gap" placeholder="Option You Closed" aria-label="Option You Closed" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      onBlur={commit} />
  );
}

function ListScreen({ live, loading, projCat, onBack, onOpen, onDelete, onAdd }: {
  live: DecisionRecord[];
  loading: boolean;
  projCat: (id: string) => string | undefined;
  onBack: () => void;
  onOpen: (id: string) => void;
  /** Swipe left reveals Delete (a record has nothing to complete); the Undo toast puts it back. */
  onDelete: (r: DecisionRecord) => void;
  onAdd: () => void;
}) {
  const today = todayISO();
  // Brain Manual v1: decisions filed from a task, an event or the + menu.
  const [filed, setFiled] = useState(0);
  return (
    <div className="screen ruled">
      <PageHeader
        title="Decisions"
        back="Brain"
        onBack={onBack}
        actions={<BarAction label="Add" onClick={onAdd}>{PLUS}</BarAction>}
      />
      {!loading && live.length === 0 && filed === 0 && (
        <div className="empty-state">
          <div className="empty-icon">{DECISION_ICO}</div>
          <div className="empty-title">Worth Remembering</div>
          {/* ONE LINE, LIKE EVERY OTHER EMPTY STATE (Dave 2026-09-03, pic 1:
              "too much subtext"). This ran two sentences and three lines
              while its siblings run one short line each ("A goal is what the
              work is for", "Everything you achieve lands here, dated,
              forever"). The payoff is the only fact worth keeping: the
              reason outlives the memory of it. */}
          <div className="empty-sub">The Reason Is Still Here in Six Weeks</div>
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
          {live.map((r) => {
            const when = whenFact(r.data, today);
            // Each home is its OWN area (§AM): a project's category, or the area itself, on the dot; the name stays the
            // line's grey, told apart by the dot. ONLY A HOME IN AN AREA IS ON THE ROW (lead, 2026-09-26): a person, goal or task
            // has no dot to wear, and the record page's Attached To card names every home.
            const homes = linksOf(r.data).flatMap((l) => {
              const slot = linkAreaSlot(l, projCat);
              return slot ? [<span className="fact cat fact-link" key={l.id}><span className={"cd cat-bg-" + slot} /><span className="cat-t">{titleCase(l.label)}</span></span>] : [];
            });
            return (
            <SwipeDelete key={r.id} label={titleCase(r.data.decision)} onDelete={() => onDelete(r)} menu={[{ label: "Open", onPick: () => onOpen(r.id) }]}>
            <div {...pressable(() => onOpen(r.id))} className="row dec-row">
              {/* The Remember star LEADS the row (Astra law 3) and, as everywhere since the 2026-10-05 review, draws only while
                  the decision is remembered: an empty star on every row crowded the leading edge before the words began.
                  Remember and Forget are the row's long-press menu line. */}
              <EntityStar entityType={ENTITY_DECISION} entityId={r.id} title={r.data.decision} quiet />
              <div className={"lib-ico " + DECISION_TONE}>{DECISION_ICO}</div>
              <div className="row-grow">
                <div className="conn-name dec-name">{titleCase(r.data.decision)}</div>
                {/* A row with no reason says nothing about it (§AK): the
                    "No reason recorded" line stated nothing, and it spent the
                    row's one grey doing it. The record page still offers the
                    empty field.
                    THE REASON READS WHOLE (audit leftovers, 2026-09-26). It
                    wore .truncate, one line and an ellipsis, and lost a third
                    to a half of itself on every seeded row at 390 ("Because
                    Ridgeline fields are locke…"), when the reason is the
                    row's point. It wraps now (.dec-row .conn-meta in
                    components.css), still the row's one grey: the facts line
                    under it is dots, the key and small caps. */}
                {r.data.why && <div className="conn-meta">{"Because " + r.data.why}</div>}
                {/* THE HOMES AND THE OUTCOME ARE ONE LINE, AND THE DAY IS ITS OWN (Dave 2026-10-05, the review: "Rebuild C..." cut
                    beside free space; here the dot between them was the casualty of any wrap, so the day sits on a line of its
                    own whenever the row has a home or an outcome to say). A row with neither has the day alone on its one line. */}
                {(homes.length > 0 || r.data.outcome) && (
                <div className="facts">
                  {homes}
                  {/* How it turned out takes the key: worked is done, mixed needs him, didn't is missed. */}
                  {r.data.outcome && <span className={"fact " + OUTCOME_KEY[r.data.outcome.word]}>{OUTCOME_LABEL[r.data.outcome.word]}</span>}
                </div>
                )}
                {/* A neutral date is SMALL CAPS (§AM F5, 2026-09-22). A revisit that is due takes the key instead (§AM R8,
                    whenFact): amber today or tomorrow, red once past. The recorded-on day is always the neutral date. */}
                <div className="facts"><span className={"fact " + when.tone}>{when.text}</span></div>
              </div>
              <Chev />
            </div>
            </SwipeDelete>
            );
          })}
        </div></div>
      )}
      <FiledRows categories={["decision"]} rowClass="row dec-row" onCount={setFiled} />
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
      placeholder="Add the Longer Thinking, If Any"
      ariaLabel="Decision notes"
      onChange={(v) => { draft.current = v; }}
      onBlur={() => onSave(draft.current)}
    />
  );
}
