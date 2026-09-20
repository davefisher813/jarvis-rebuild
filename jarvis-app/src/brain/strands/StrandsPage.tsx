import { useCallback, useEffect, useState } from "react";
import { useStrands } from "../../data/NotesProvider";
import { useAI } from "../../ai/useAI";
import TodaySuggestions from "../../today/TodaySuggestions";
import { todayISO } from "../../ai/useAIContext";
import { haptics } from "../../shared/haptics";
import { showToast } from "../../shared/toast";
import { attemptWrite } from "../../shared/guard";
import PageHeader from "../../shared/PageHeader";
import { Switch } from "../../settings/kit";
import {
  STRAND_CATEGORY_LABEL, STRAND_TYPE_LABEL, WRITING_CHANNEL_LABEL, NO_PATTERN_TWIN,
  type Strand, type StrandCategory, type StrandEvidence, type DerivationKey, type StrandType, type WritingChannel,
} from "./types";
import { pressable } from "../../shared/pressable";
import ReadinessPanel, { useReadiness } from "./ReadinessPanel";
import { stateForStrand, toneForStrandState, STRAND_STATE_LABEL, bucketFor, confidenceWord, isWatching, type StrandBucket } from "./state";
import { usedBy } from "./usedBy";
import { daysSince } from "../recall";
import { watchingCount } from "../readiness";
import RowStar from "../../shared/RowStar";

// C-40: the filter chips. Choosers, so filled chips. Watching is not a
// strand bucket: it lists the readiness rows past CLOSE_SHARE of their gate.
type Filter = "all" | StrandBucket | "watching";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" }, { key: "known", label: "Known" }, { key: "learned", label: "Learned" },
  { key: "watching", label: "Watching" }, { key: "needs", label: "Needs Confirmation" },
];
const TYPES = Object.keys(STRAND_TYPE_LABEL) as StrandType[];
const CHANNELS = Object.keys(WRITING_CHANNEL_LABEL) as WritingChannel[];

// What JARVIS Knows (Brain Layer 2). The genome made visible: every strand,
// its category, where it came from, and its receipts. Wrongness has an exit
// on every row: Edit, Pause, Delete, no burial. Approved preview 2026-08-21;
// lives behind one Brain row so the hub keeps its one flat list (V4 law).

const CATS = Object.keys(STRAND_CATEGORY_LABEL) as StrandCategory[];

const SOURCE_LABEL: Record<string, string> = {
  watched: "Watched", asked: "Asked", told: "Told", uploaded: "Uploaded",
};

function hour12(h: number): string {
  const ap = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12} ${ap}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthDay(iso: string): string {
  const p = iso.split("-");
  const m = MONTHS[Number(p[1]) - 1];
  return m ? `${m} ${Number(p[2])}` : iso;
}

// Receipts render from numbers at display time; the meaning of a/b belongs
// to the derivation (same law as the event log: no free text stored).
export function receiptLine(derivation: DerivationKey | undefined, e: StrandEvidence): string {
  if (derivation === "completion_window" && typeof e.a === "number") {
    return `Finished in the ${hour12(e.a)} window`;
  }
  if (derivation === "slip_category") return "Pushed to a later day";
  if (derivation === "plan_rate" && typeof e.a === "number" && typeof e.b === "number") {
    return `${e.a} of ${e.b} picks done`;
  }
  if (derivation === "task_timing" && typeof e.a === "number") {
    return e.a > 0 ? `Ran ${e.a} min past the estimate` : `Wrapped ${-e.a} min early`;
  }
  // B5 (2026-09-04): derive.ts's two newest detectors (training_window,
  // email_window) have written the band hour as evidence.a since they
  // launched, same shape as completion_window; nothing here had a case for
  // either, so every row under "You train between 6 PM and 9 PM" fell
  // through to "Seen".
  if (derivation === "training_window" && typeof e.a === "number") {
    return `Trained in the ${hour12(e.a)} window`;
  }
  if (derivation === "email_window" && typeof e.a === "number") {
    return `Handled email in the ${hour12(e.a)} window`;
  }
  return "Seen";
}

// S6-Q35 (2026-09-04): "Recent Captures rows do nothing." A fact captured
// through Quick Add is one of the things that strip can now open, and this
// is where it lands: the same async-safe deep-link shape PeopleFlow and
// DecisionsFlow already use for a person or a decision record. openId names
// the target; the actual Strand is DERIVED from strands on every render
// (never captured once at mount), so it resolves correctly whichever finishes
// loading first, the deep link or the list itself.
// Which bucket a told fact about a readiness row belongs in, so Tell JARVIS
// opens the sheet already filed where the detector would have filed it.
function categoryForReadiness(key: string): StrandCategory {
  if (key === "training_window" || key === "email_window") return "routine";
  if (key === "people_rhythm" || key === "gone_quiet") return "people";
  return "work_style";
}

export default function StrandsPage({ onBack, openId: initialOpenId, openNonce, onOpenConsumed, initialFilter, focusReadinessKey }: { onBack: () => void; openId?: string;
  // BRAIN-F-04 (2026-09-05): the shell's one-shot shape (shell/intents.ts).
  // Without it a fact opened from Quick Add reopened its sheet on every later
  // visit to What JARVIS Knows.
  openNonce?: number; onOpenConsumed?: () => void;
  // C-38: the Brain hub's Needs You opens this page under Watching.
  initialFilter?: "watching";
  // C-38 fix (2026-09-13): which readiness row the Needs You tap named, so
  // the Readiness list can scroll to and mark that specific row instead of
  // landing on the same generic screen every watching row used to share.
  focusReadinessKey?: string }) {
  const svc = useStrands();
  const ai = useAI();
  const today = todayISO();
  const [strands, setStrands] = useState<Strand[]>([]);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  useEffect(() => {
    if (!initialOpenId) return;
    setOpenId(initialOpenId);
    onOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenId, openNonce]);
  const open = openId ? strands.find((s) => s.id === openId) ?? null : null;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [cat, setCat] = useState<StrandCategory>("work_style");
  // S4-Q24 (2026-09-04): "a rule and a preference carry the same weight."
  // types.ts's own doctrine comment says strength distinguishes them, and
  // add() has always accepted a fourth strength argument -- nothing on this
  // page ever passed anything but its default. Rules are only ever
  // user-stated (never promoted here from evidence), so this is the one
  // and only place that can set it.
  const [rule, setRule] = useState(false);
  // C-42: the kind, a chooser on the sheet. null is "not said".
  const [kind, setKind] = useState<StrandType | null>(null);
  // C-57: the channel, writing facts only.
  const [channel, setChannel] = useState<WritingChannel | null>(null);
  const [filter, setFilter] = useState<Filter>(initialFilter ?? "all");

  const reload = useCallback(async () => setStrands(await svc.list()), [svc]);
  useEffect(() => { void reload(); }, [reload]);

  // C-39 / C-41: one read, for the panel's words and the rows' confidence.
  const read = useReadiness(strands);
  const watching = read.rows.filter((r) => isWatching(r.state));
  const visible = filter === "all" ? strands : filter === "watching" ? [] : strands.filter((s) => bucketFor(s, today) === filter);
  // The readiness row a watched strand came from, through the twin map, so a
  // no-pattern fact reads its count off the question it answered.
  const readinessFor = (s: Strand) => {
    const d = s.data.derivation;
    if (!d) return undefined;
    return read.rows.find((r) => r.key === d || NO_PATTERN_TWIN[r.key] === d);
  };
  const openRow = (s: Strand) => () => {
    setOpenId(s.id); setEditing(false); setText(s.data.text); setCat(s.data.category);
    setRule(s.data.strength === "rule"); setKind(s.data.type ?? null); setChannel(s.data.channel ?? null);
  };

  // B12 (2026-08-24): the Brain is capped, so a double-tapped Save used to
  // burn a slot on a duplicate belief.
  const [saving, setSaving] = useState(false);
  const doAdd = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    haptics.success();
    // BRAIN-F-12 (2026-09-05): unguarded, a dropped connection threw right
    // here and left the button reading "Saving..." for good, with the typing
    // trapped behind it. attemptWrite says so instead, the latch lets go, and
    // the sheet stays open on what was written.
    const ok = await attemptWrite(async () => {
      // Only ever pass the fourth argument when it says something other than
      // add()'s own default, so an ordinary fact (the common case) reaches the
      // service exactly as it always did.
      // C-42: the kind rides as a fifth argument only when he chose one.
      const id = kind
        ? await svc.add(text, cat, today, rule ? "rule" : "influence", kind)
        : rule ? await svc.add(text, cat, today, "rule") : await svc.add(text, cat, today);
      // C-57: a writing fact says which channel, when he chose one.
      if (id && cat === "writing" && channel) {
        const made = (await svc.list()).find((s) => s.id === id);
        if (made) await svc.setChannel(made, channel);
      }
      showToast({ message: id ? "JARVIS will remember that" : "The Brain is full · Delete one first" });
    });
    setSaving(false);
    if (!ok) return;
    setAdding(false); setText("");
    await reload();
  };

  // S4-Q22 (2026-09-04): "no control anywhere moves a fact's category,"
  // and the edit sheet is the only exit for one already filed wrong -- the
  // receipt only ever catches it at capture time. A refused move (the
  // target bucket already at its cap) still lets the text edit through:
  // the two are independent facts about the strand, and a full bucket is a
  // real, expected outcome, not a reason to lose an unrelated correction.
  const doEdit = async () => {
    if (!open || !text.trim() || saving) return;
    setSaving(true);
    haptics.selection();
    // BRAIN-F-12 (2026-09-05): same latch, same fix as doAdd above.
    const ok = await attemptWrite(async () => {
      await svc.edit(open, text, today);
      if (cat !== open.data.category) {
        const moved = await svc.recategorize(open, cat);
        if (!moved) showToast({ message: "The Brain is full · Prune it in What JARVIS Knows" });
      }
      // S4-Q24: the only writer of strength, and only when it actually
      // changed -- re-saving an unchanged edit is not a rule declaration.
      if (rule !== (open.data.strength === "rule")) {
        await svc.setStrength(open, rule ? "rule" : "influence");
      }
      // C-42: same rule as strength, only when it actually changed.
      if (kind !== (open.data.type ?? null)) {
        await svc.setType(open, kind);
      }
      // C-57: same again for the channel; a fact leaving Writing drops it.
      const nextChannel = cat === "writing" ? channel : null;
      if (nextChannel !== (open.data.channel ?? null)) {
        await svc.setChannel(open, nextChannel);
      }
    });
    setSaving(false);
    if (!ok) return;
    setEditing(false); setOpenId(null); setText("");
    await reload();
  };

  // STILL TRUE (Dave's call, 2026-08-24). The sheet has always PRINTED
  // "Confirmed 12 Aug" and offered no way to confirm, so that date could only
  // ever be the day the strand was created or last re-derived, and
  // StrandsService.confirm() sat written and uncalled.
  //
  // A strand is a claim about him. Being able to say "yes, still" is the
  // cheapest possible way to keep the Brain honest without deleting anything,
  // and it is the only control on this sheet that is not a retreat: Edit says
  // the words are wrong, Pause says not now, Delete says never. This one says
  // right.
  //
  // Guarded, because an unguarded write that silently failed would leave the
  // date unchanged under a toast saying it had been confirmed.
  const doConfirm = async (s: Strand) => {
    haptics.selection();
    const ok = await attemptWrite(() => svc.confirm(s, today));
    if (!ok) return;
    setOpenId(null);
    await reload();
    showToast({ message: "Confirmed" });
  };

  // C-47: a fading row carries its own Still True, so the answer is one tap
  // from the list. The row stops fading and keeps its place.
  const confirmRow = async (s: Strand) => {
    haptics.selection();
    const ok = await attemptWrite(() => svc.confirm(s, today));
    if (!ok) return;
    await reload();
    showToast({ message: "Confirmed" });
  };

  const doPause = async (s: Strand) => {
    haptics.selection();
    // BRAIN-F-12 (2026-09-05): a failed pause used to close the sheet over a
    // strand that was still active, which is the app claiming a write it
    // never made. It says so now and leaves the sheet where it was.
    const ok = await attemptWrite(() => svc.setStatus(s, s.data.status === "active" ? "paused" : "active"));
    if (!ok) return;
    setOpenId(null);
    await reload();
  };

  // B10/B12 (2026-08-23): the write was unguarded, so a failed delete still
  // said "Forgotten" and closed the row. It is guarded now, and it offers the
  // way back.
  //
  // HONEST ABOUT WHAT UNDO RESTORES: `add` rebuilds the strand's text,
  // category and strength, which is the belief itself. It cannot rebuild the
  // evidence array or the derivation key, because those were observed over
  // time and cannot be re-derived on demand. So JARVIS remembers the thing
  // again but not why it first believed it. That is a real restore of the
  // fact and a partial one of its history, which is the same honest-but-weak
  // shape CategoryDetail already documents for its own undo.
  const doDelete = async (s: Strand) => {
    haptics.selection();
    const kept = s.data;
    const ok = await attemptWrite(() => svc.remove(s));
    if (!ok) return;
    setOpenId(null);
    await reload();
    showToast({
      message: "Forgotten",
      actionLabel: "Undo",
      onAction: () => void (async () => {
        await attemptWrite(() => svc.add(kept.text, kept.category, today, kept.strength));
        await reload();
      })(),
    });
  };

  const tellAbout = (key: string) => {
    setAdding(true); setText(""); setCat(categoryForReadiness(key)); setRule(false); setKind(null); setChannel(null);
  };

  return (
    <div className="screen ruled">
      <PageHeader title="What JARVIS Knows" back="Brain" onBack={onBack} />

      {/* PICK 29 (Dave 2026-08-22): the Noticed offer moved here off Today.
          It renders NOTHING most days, exactly as it did before, so this adds
          no furniture to the page. When there is something, this is where it
          belongs: an observation waiting to become a strand, sitting above
          the strands it would join. */}
      {/* NOT WHEN HE CAME FOR ONE ROW (Dave 2026-09-13, from his phone: he
          tapped When You Train and the first thing on the page was a Noticed
          offer about a different fact, which read as the tap opening the
          wrong thing). The offer steps aside when the page was opened on a
          readiness row; it is back on the next plain visit. */}
      {!focusReadinessKey && <TodaySuggestions ai={ai} always />}

      {/* WHY IS THIS LIST NOT GROWING (Dave 2026-09-06: "i dont see any trace
          of jarvis learning anything"). Above the facts, below the offers,
          because it is the answer to the question this screen makes him ask.
          It reports; it proposes nothing and writes nothing. */}
      {/* C-40: the choosers. Filled chips, because these filter. */}
      <div className="chip-row chip-wrap-row strand-filters">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={"chip" + (filter === f.key ? " active" : "")} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      <ReadinessPanel read={read} today={today} focusKey={focusReadinessKey} onTell={tellAbout} />

      {filter === "watching" && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Watching</span><span className="n">{watching.length}</span></div>
          {watching.length === 0 && <div className="empty-state">Nothing is close to its gate yet. The Learning Lab under Settings shows every count.</div>}
          {watching.length > 0 && (
            <div className="pad-x"><div className="card list-card-ruled">
              {watching.map((r) => (
                // Row tap (Dave 2026-09-15): a watched detector is not a fact
                // yet, so the row does its pill's verb, Tell JARVIS.
                <div {...pressable(() => tellAbout(r.key))} className={"row strand-row" + (r.key === focusReadinessKey ? " rdy-row-focus" : "")} key={r.key}>
                  <div className="row-grow">
                    <div className="conn-name">{r.label}</div>
                    <div className="facts">
                      <span className="fact st warn">Watching</span>
                      <span className="fact">{watchingCount(r)}</span>
                    </div>
                  </div>
                  <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); tellAbout(r.key); }}>Tell JARVIS</button>
                </div>
              ))}
            </div></div>
          )}
        </>
      )}

      {filter !== "watching" && visible.length > 0 && (
        <div className="sh2 sh2-quiet"><span className="t">What It Knows</span><span className="n">{visible.length}</span></div>
      )}

      {/* RAW JSX TEXT IS INVISIBLE TO THE SHORT-COPY LAW (states sweep,
          2026-09-20). That law reads string LITERALS, and these two wrote
          their copy as bare text between tags, so a three-sentence paragraph
          shipped on the one screen about what JARVIS has noticed: "Nothing
          yet. JARVIS only writes here what it has watched you do, or what you
          tell it. Add one thing below, or just live in the app and let it
          notice." It also pointed at a control -- "add one thing below" --
          that is already on screen and says so itself.
          Title and sub, as fragments, like every other empty state. */}
      {strands.length === 0 && filter !== "watching" && (
        <div className="empty-state">
          <div className="empty-title">Nothing Noticed Yet</div>
          <div className="empty-sub">What JARVIS watches you do lands here, and so does anything you tell it</div>
        </div>
      )}
      {strands.length > 0 && filter !== "all" && filter !== "watching" && visible.length === 0 && (
        <div className="empty-state"><div className="empty-title">Nothing Under This One</div></div>
      )}

      {/* THE STRAND ROW (C-40, C-41, C-43, C-47, C-50; Astra, 2026-09-12).
          The star leads, then the fact, then one facts line: the state word,
          Rule when he made it one, the confidence word with its count where
          the derivation owns one, days unconfirmed when it is fading, Paused
          when it is, and the bucket. A fading row carries Still True in the
          trailing slot instead of the chevron; the sheet still opens from the
          row itself. The eyebrow that said "Energy · Watched" is gone: the
          state word says who said it, the bucket says where it lives. */}
      {visible.length > 0 && (
        <div className="pad-x"><div className="card list-card-ruled">
          {visible.map((s) => {
            const st = stateForStrand(s, today);
            const rr = s.data.source === "watched" || s.data.source === "uploaded" ? readinessFor(s) : undefined;
            const conf = rr ? confidenceWord(rr.have, rr.need) : null;
            const fading = st === "FADING";
            return (
              <div {...pressable(openRow(s))}
                className={"row strand-row" + (s.data.status === "paused" ? " paused" : "")}
                key={s.id}
              >
                <RowStar on={!!s.data.link} />
                <div className="row-grow">
                  <div className="conn-name">{s.data.text}</div>
                  <div className="facts">
                    {st && <span className={"fact st " + toneForStrandState(st)}>{STRAND_STATE_LABEL[st]}</span>}
                    {s.data.strength === "rule" && <span className="fact st red">Rule</span>}
                    {conf && <span className={"fact " + (conf === "High" ? "good" : "warn")}>{conf}</span>}
                    {rr && conf && <span className="fact">{rr.have} {rr.unit}</span>}
                    {fading && <span className="fact">{daysSince(s.data.lastConfirmed, today)} days unconfirmed</span>}
                    {s.data.status === "paused" && <span className="fact">Paused</span>}
                    <span className="fact">{STRAND_CATEGORY_LABEL[s.data.category]}</span>
                  </div>
                </div>
                {fading
                  ? <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); void confirmRow(s); }}>Still True</button>
                  : <div className="chev" />}
              </div>
            );
          })}
        </div></div>
      )}

      <div className="pad-x">
        <button className="row row-act" onClick={() => { setAdding(true); setText(""); setCat("work_style"); setRule(false); setKind(null); setChannel(null); }}>Add One Thing</button>
      </div>
      <div className="screen-foot" />

      {open && !editing && (
        <div className="sheet-scrim" onClick={() => setOpenId(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="grp"><div className="eyebrow">{STRAND_CATEGORY_LABEL[open.data.category]} &middot; {SOURCE_LABEL[open.data.source]}{open.data.strength === "rule" ? " · Rule" : ""}</div></div>
            <div className="pad-x sheet-form">
              <div className="strand-head">{open.data.text}</div>
              <div className="conn-meta">Confirmed {monthDay(open.data.lastConfirmed)}</div>
              {(open.data.evidence ?? []).map((e, i) => (
                <div className="strand-receipt" key={i}>
                  <div className="r-what conn-meta">{receiptLine(open.data.derivation, e)}</div>
                  <div className="conn-meta">{monthDay(e.day)}</div>
                </div>
              ))}
              {/* C-43: where this fact is read. Plain facts, from the static
                  map, the same words the row wears on the Brain hub. */}
              <div className="strand-used">
                <div className="input-label">Used By</div>
                <div className="facts">{usedBy(open.data.category).map((u) => <span className="fact" key={u}>{u}</span>)}</div>
              </div>
            </div>
            <div className="pad-x sheet-actions">
              {/* First, and above Edit, because it is the affirmative one and
                  the other three are all ways of taking something back. */}
              <button className="btn btn-secondary btn-block" onClick={() => void doConfirm(open)}>Still True</button>
              <button className="btn btn-secondary btn-block" onClick={() => { setEditing(true); setText(open.data.text); }}>Edit</button>
              <button className="btn btn-secondary btn-block" onClick={() => void doPause(open)}>{open.data.status === "active" ? "Pause" : "Resume"}</button>
              <button className="btn btn-secondary btn-block btn-danger-text" onClick={() => void doDelete(open)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {(adding || (open && editing)) && (
        <div className="sheet-scrim" onClick={() => { setAdding(false); setEditing(false); setOpenId(null); }}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="grp"><div className="eyebrow">{adding ? "One True Thing" : "Say It Right"}</div></div>
            <div className="pad-x sheet-form">
              <div className="field">
                <label className="input-label">{adding ? "Something JARVIS should know about you" : "The fact, in your words"}</label>
                <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Brainstorms best at night" />
              </div>
              {/* S4-Q22: the edit sheet is the only exit for a fact already
                  filed under the wrong bucket, so it gets the same chips
                  the add flow already has, not just a text field. */}
              {(adding || (open && editing)) && (
                <div className="field"><div className="input-label">Where It Belongs</div>
                  <div className="chip-row">{CATS.map((c) => (
                    <button key={c} className={"chip" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{STRAND_CATEGORY_LABEL[c]}</button>
                  ))}</div>
                </div>
              )}
              {/* C-57: which channel a writing fact is about. Only offered
                  in Writing; a chooser, so filled chips. */}
              {(adding || (open && editing)) && cat === "writing" && (
                <div className="field"><div className="input-label">Channel</div>
                  <div className="chip-row">{CHANNELS.map((c) => (
                    <button key={c} type="button" className={"chip" + (channel === c ? " active" : "")} aria-pressed={channel === c} onClick={() => setChannel((k) => (k === c ? null : c))}>{WRITING_CHANNEL_LABEL[c]}</button>
                  ))}</div>
                </div>
              )}
              {/* C-42: what kind of thing it is. A chooser, so filled chips;
                  tapping the chosen one again clears it. */}
              {(adding || (open && editing)) && (
                <div className="field"><div className="input-label">What Kind</div>
                  <div className="chip-row">{TYPES.map((t) => (
                    <button key={t} type="button" className={"chip" + (kind === t ? " active" : "")} aria-pressed={kind === t} onClick={() => setKind((k) => (k === t ? null : t))}>{STRAND_TYPE_LABEL[t]}</button>
                  ))}</div>
                </div>
              )}
              {/* S4-Q24: rules are only ever user-stated, so this toggle is
                  the one and only place strength can change. Off is an
                  ordinary fact, exactly what every strand has always been. */}
              <Switch
                label="Make It a Rule"
                meta="A rule binds the plan; an ordinary fact only biases it."
                on={rule}
                onToggle={() => setRule((r) => !r)}
              />
            </div>
            <div className="pad-x sheet-actions">
              <button className="btn btn-primary btn-block" disabled={saving} onClick={() => void (adding ? doAdd() : doEdit())}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
