import { createPortal } from "react-dom";
import { useState } from "react";
import { useTasks, useSchedule, useNotes, useCategories, useOptionalRules, useOptionalStrands, useOptionalDecisions, usePeople, useProjects } from "../data/NotesProvider";
import { STRAND_CATEGORY_LABEL, type StrandCategory } from "../brain/strands/types";
import { aliasTrigger } from "../rules/triggers";
import { useAIContext, todayISO } from "../ai/useAIContext";
import type { AIService } from "../ai/AIService";
import type { Category } from "../categories/types";
import { smartPasteSave, undoSaved, refileSaved, recategorizeSaved, recategorizeFact, type SavedEntity } from "../paste/smartPaste";
import { parseSetPhrase } from "../gym/parseSet";
import { readLive, writeLive, logSet, setLoggedSets, skipExercise, isStillActive } from "../gym/liveSession";
import { newSetId, duplicateEntry } from "../gym/strip";
import { formatSet } from "../gym/measures";
import type { SetEntry } from "../gym/types";
import { pasteSeenAge, readRecentCaptures, dropCapture, type RecentCapture } from "../paste/captureLog";
import { attemptWrite, WRITE_FAILED_MESSAGE } from "../shared/guard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { weekdayLongDate, shortDateFromMs } from "../shared/dateFormat";
import { formatMoney } from "../money/types";

// "Fact" is Quick Add's lane (Brain handoff 5.0): a standing truth about the
// user, filed into the Brain rather than onto a list. It is a chip like the
// others, so a sentence read the wrong way is one tap from right in either
// direction.
// UP-MIND-08 (2026-09-05): two more kinds a capture can BE. They are not
// refile targets (KINDS below): a decision record and a person's card are
// not things a task can be turned into by a chip, and offering it would be a
// control that promises a move nobody built.
const KIND_LABEL: Record<SavedEntity["kind"], string> = { task: "Task", event: "Event", note: "Note", fact: "Fact", decision: "Decision", person: "Person" };
const KINDS: SavedEntity["kind"][] = ["task", "event", "note", "fact"];
const FACT_CATEGORIES = Object.keys(STRAND_CATEGORY_LABEL) as StrandCategory[];

// "Thursday Aug 20 · 7:00 PM" on the receipt: the resolved date is shown so a
// wrong read is visible the moment it happens (Smart Paste law: resolved
// dates on receipt).
function fmtWhen(s: SavedEntity): string {
  const parts: string[] = [];
  if (s.date) {
    parts.push(weekdayLongDate(s.date));
  }
  if (s.start) {
    const [h, m] = s.start.split(":").map((x) => parseInt(x, 10));
    const d = new Date();
    d.setHours(h ?? 9, m ?? 0);
    parts.push(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }
  return parts.join(" · ");
}

// UP-CORE-01 (2026-09-05): WHAT IT READ, IN WORDS. A capture that quietly
// became a reminder, a repeating task or a bill has to say so on the
// receipt, or the read is invisible until it pings at nine at night. Same
// rule the resolved date has followed since Smart Paste shipped: show the
// read so a wrong one is visible the moment it happens.
const REPEAT_WORD: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", weekdays: "Weekdays" };

function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const d = new Date();
  d.setHours(h ?? 9, m ?? 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function readWord(s: SavedEntity): string {
  if (s.reminder) return "Reminder";
  if (s.bill) return "Bill";
  return KIND_LABEL[s.kind];
}

function readFacts(s: SavedEntity, names: { person?: string; project?: string }): string[] {
  const out: string[] = [];
  if (s.reminder) out.push(fmtClock(s.reminder.time));
  if (s.bill) out.push(formatMoney(s.bill.amount));
  if (s.kind === "fact") {
    if (s.factCategory) out.push(STRAND_CATEGORY_LABEL[s.factCategory]);
  } else {
    const when = fmtWhen(s);
    if (when) out.push(when);
  }
  // A reminder with no repeat runs every day: that is what an absent `days`
  // MEANS in ReminderInfo, so the receipt says it rather than leaving the
  // person to find out tomorrow morning.
  if (s.recurrence) out.push(REPEAT_WORD[s.recurrence] ?? s.recurrence);
  else if (s.reminder) out.push(s.reminder.days ? "Weekdays" : "Daily");
  if (names.person) out.push(names.person);
  if (names.project) out.push(names.project);
  return out;
}

function fmtRecent(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yd = new Date(today.getTime() - 86400000);
  if (d.toDateString() === yd.toDateString()) return "Yesterday";
  return shortDateFromMs(ts);
}

// Smart Paste (addendum item 1). Type or paste; JARVIS saves INSTANTLY,
// deterministic rules first, AI only for what they could not read. The
// receipt carries refile chips and undo; correction is post-action, never a
// confirm gate. Recent Captures shows the last ten so a mis-capture from
// earlier is one tap away.
export default function QuickCapture({ ai, onClose, onOpen }: { ai: AIService; onClose: () => void; onOpen?: (kind: RecentCapture["kind"], id: string) => void }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const categoriesSvc = useCategories();
  const gather = useAIContext();
  // Optional: QuickCapture renders in surfaces that may sit outside the rules
  // provider, and a missing store must mean "learn nothing", not a crash.
  const rules = useOptionalRules();
  // Same seam for the genome: no strand store means the fact lane is closed
  // and a self-fact lands as a task, exactly as it did before Quick Add.
  const strands = useOptionalStrands();
  // UP-CORE-01 reads Contacts and Projects to match names against; UP-MIND-08
  // WRITES to Contacts when a line states a fact about somebody. One reader
  // of the store either way, passed to the pipeline as `peopleSvc`.
  const peopleSvc = usePeople();
  const projectsSvc = useProjects();
  const decisions = useOptionalDecisions();

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"input" | "saving" | "saved">("input");
  const [saved, setSaved] = useState<SavedEntity[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [recents, setRecents] = useState<RecentCapture[]>([]);
  const [error, setError] = useState("");
  const [dupAge, setDupAge] = useState<number | null>(null);
  // UP-CORE-01 (2026-09-05): the bounded lists the capture matches people and
  // projects against, and the receipt names them from. Read once with the
  // categories; a failure leaves both lanes closed rather than blocking the
  // save.
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);

  // rules is passed IN, not reached for inside smartPaste: the pipeline stays
  // a pure function of its deps, and a surface that has no rules store simply
  // does not learn rather than crashing or reaching for a global.
  // UP-MIND-08 (2026-09-05): the Decisions log joins the same optional seam
  // every other store here rides, and the contact store rides in beside it as
  // peopleSvc. Absent means the lane is closed and the line lands exactly as
  // it did before.
  const deps = (categories: Category[], who: { people?: { id: string; name: string }[]; projects?: { id: string; title: string }[] } = { people, projects }) =>
    ({ ai, gather, tasks, schedule, notes, categories, today: todayISO(), ...who, ...(rules ? { rules } : {}), ...(strands ? { strands } : {}),
      ...(decisions ? { decisions } : {}), peopleSvc });

  // UP-ATH-18 (2026-09-06, option A): THE SET GOES TO THE SESSION, NOT TO A
  // LIST. While a session is live the bar is standing right next to the
  // athlete, and "225 for 5" typed into it used to become a task called "225
  // For 5". Deterministic and first, before any AI call: gym/parseSet.ts
  // reads the shapes people type against the exercise they are actually on,
  // and answers null for everything else, so a note that happens to start
  // with a number is still a note. The whole branch is skipped when nothing
  // is live, which is most of the time.
  const logToSession = (t: string): boolean => {
    const live = readLive();
    if (!live || !isStillActive(live, todayISO())) return false;
    const entry = live.exercises[live.idx];
    if (!entry || entry.skipped) return false;
    const hit = parseSetPhrase(t, { kind: entry.kind, ...(entry.unit ? { unit: entry.unit } : {}), ...(entry.timeUnit ? { timeUnit: entry.timeUnit } : {}) });
    if (!hit) return false;
    const before = entry.sets;
    if (hit.kind === "skip") {
      writeLive(skipExercise(live, live.idx));
      showToast({
        message: `${entry.name} skipped`,
        actionLabel: "Undo",
        onAction: () => { const cur = readLive(); if (cur) writeLive({ ...cur, exercises: cur.exercises.map((e, i) => (i === live.idx ? { ...e, skipped: false } : e)) }); },
      });
      onClose();
      return true;
    }
    // "same" repeats the last WORKING set: a warm-up is not what "same"
    // means, and with nothing logged yet there is nothing to repeat.
    let set: SetEntry;
    if (hit.kind === "same") {
      const last = [...before].reverse().find((x) => !x.warmup);
      if (!last) return false;
      set = duplicateEntry(last);
    } else if (hit.kind === "done") {
      set = { id: newSetId(), done: true };
    } else {
      // A rep count on its own inherits the weight from the last set, which
      // is what "8 reps" means standing at a loaded bar. With nothing to
      // inherit from, the entry is exactly what was typed.
      const last = [...before].reverse().find((x) => !x.warmup);
      const filled = hit.entry.w === undefined && last?.w !== undefined ? { ...hit.entry, w: last.w } : hit.entry;
      set = { id: newSetId(), ...filled };
    }
    writeLive(logSet(live, live.idx, set));
    showToast({
      message: `Logged ${formatSet(entry, set)}`,
      actionLabel: "Undo",
      onAction: () => { const cur = readLive(); if (cur) writeLive(setLoggedSets(cur, live.idx, before)); },
    });
    onClose();
    return true;
  };

  const capture = async (force = false) => {
    const t = text.trim();
    if (!t || phase === "saving") return;
    setError("");
    if (logToSession(t)) return;
    // Exact-text 7-day dedupe: a fact and a choice, never a silent block.
    if (!force) {
      const age = pasteSeenAge(t);
      if (age !== null) { setDupAge(age); return; }
    }
    setDupAge(null);
    setPhase("saving");
    const categories = await categoriesSvc.list().catch(() => []);
    setCats(categories);
    // UP-CORE-01: who and which project, read fresh with the categories so a
    // contact added a minute ago is matchable now.
    const ps = (await peopleSvc.list().catch(() => [])).map((p) => ({ id: p.id, name: p.data.name }));
    const prs = (await projectsSvc.list().catch(() => [])).map((p) => ({ id: p.id, title: p.data.title }));
    setPeople(ps);
    setProjects(prs);
    let out: SavedEntity[] = [];
    // A full genome refuses a fact, and that refusal has a reason worth
    // stating: "Nothing to save in that" would be false, since the sentence
    // was read perfectly and there was simply nowhere to put it.
    let refused = false;
    const ok = await attemptWrite(async () => {
      out = await smartPasteSave(t, { ...deps(categories, { people: ps, projects: prs }), onFactRefused: () => { refused = true; } });
    });
    if (!ok || out.length === 0) {
      // The middle dot, not a full stop: the short-copy law forbids a
      // sentence boundary in rendered copy, and this is the exact string
      // TodaySuggestions already says for the identical refusal.
      if (ok) setError(refused ? "The Brain is full · Prune it in What JARVIS Knows" : "Nothing to save in that.");
      setPhase("input");
      return;
    }
    haptics.selection();
    setSaved(out);
    setRecents(readRecentCaptures().filter((r) => !out.some((s) => s.id === r.id)));
    setPhase("saved");
  };

  const onUndo = async (s: SavedEntity) => {
    const ok = await attemptWrite(() => undoSaved(s, deps(cats)));
    if (!ok) return;
    dropCapture(s.id);
    const left = saved.filter((x) => x.id !== s.id);
    setSaved(left);
    if (left.length === 0) setPhase("input");
  };

  // SHELL-F-02 (2026-09-05): a null from refileSaved is a REFUSAL by the
  // target lane (the Brain at its cap), and the original is untouched. It
  // used to be swallowed here, on top of the pipeline having already
  // deleted the original, so the chip did nothing and the task was gone.
  // Now the same honest line onFactCat says for the same refusal.
  const onKind = async (s: SavedEntity, kind: SavedEntity["kind"]) => {
    if (kind === s.kind) return;
    let next: SavedEntity | null = null;
    const ok = await attemptWrite(async () => { next = await refileSaved(s, kind, deps(cats)); });
    if (!ok) return;
    if (!next) {
      showToast({ message: kind === "fact" ? "The Brain is full · Prune it in What JARVIS Knows" : WRITE_FAILED_MESSAGE });
      return;
    }
    dropCapture(s.id);
    setSaved(saved.map((x) => (x.id === s.id ? next! : x)));
  };

  // A CORRECTION, RECORDED (2026-08-24). Smart Paste read the text and chose
  // a category; changing it here is the user saying that choice was wrong.
  // That is the exact signal the learned-rules engine was built for and had
  // never been given: recordCorrection had zero callers, so no rule was ever
  // created and What JARVIS Learned could only ever be empty.
  //
  // RECORDING ONLY, by Dave's decision. Nothing calls resolve(), so no
  // capture is ever categorised by a rule. The page fills with what JARVIS
  // noticed so the rules can be judged before they are allowed to act.
  //
  // Three guards, all of them refusals:
  //   - only when the category actually CHANGED, so re-tapping the current
  //     chip is not evidence of anything
  //   - only when the text carries a proper noun (see rules/triggers.ts); a
  //     capture with no name in it teaches nothing
  //   - after the write succeeds, never before, because a correction that
  //     failed to save is not a correction
  const onCat = async (s: SavedEntity, categoryId: string) => {
    const was = s.category;
    const ok = await attemptWrite(() => recategorizeSaved(s, categoryId, deps(cats)));
    if (!ok) return;
    setSaved(saved.map((x) => (x.id === s.id ? { ...x, category: categoryId } : x)));
    if (was === categoryId) return;
    // s.raw, not s.title: title has been through titleCase, which capitalises
    // every meaningful word, so the proper-noun heuristic run over it returns
    // the whole title. The apply side in smartPaste keys on raw too, and the
    // two must agree or no correction ever matches its own lookup.
    const trigger = s.raw ? aliasTrigger(s.raw) : null;
    if (!trigger || !rules) return;
    const to = cats.find((c) => c.id === categoryId)?.data.name ?? categoryId;
    // Never throws into the tap: learning is a side effect of the correction,
    // and a storage failure must not make the recategorise look like it lost.
    //
    // `to` here is a display name, used only in the evidence string. The
    // rule's stored `to` stays the real categoryId: smartPaste.ts's
    // categoryFromRule matches it against live category ids and writes it
    // straight onto a new capture's category field, so it has to stay a real
    // id. What JARVIS Learned resolves ids to names for display instead (B4,
    // 2026-09-04) rather than storing a name here and breaking that apply.
    void rules.recordCorrection("alias", "capture.category", trigger, categoryId, `"${s.title}" moved to ${to}`)
      .catch(() => { /* the next identical correction re-observes it */ });
  };

  // S4-Q22 (2026-09-04): a fact's bucket is a guess the same way a task's
  // category is, but nothing on this receipt could change one -- the chip
  // row hid app categories for a fact (a strand does not use that
  // taxonomy) and offered no strand-category chips in their place. This is
  // that missing control. The cap is a real, expected outcome here (twelve
  // per bucket), not a write failure, so it gets its own honest line rather
  // than the generic "couldn't save" toast.
  // UP-CORE-01 (2026-09-05): TWO MARCOS. When more than one real contact
  // answers to the line, nothing is filed and the receipt asks, which is the
  // Uncertainty Protocol in one row of chips: JARVIS says what it is unsure
  // about and the person decides in one tap. Only a task carries a person,
  // so this never appears on an event or a note.
  const onPerson = async (s: SavedEntity, personId: string) => {
    if (s.kind !== "task" || personId === s.personId) return;
    const ok = await attemptWrite(() => tasks.setPerson(s.id, personId));
    if (!ok) return;
    setSaved(saved.map((x) => (x.id === s.id ? { ...x, personId } : x)));
  };

  const onFactCat = async (s: SavedEntity, category: StrandCategory) => {
    if (category === s.factCategory) return;
    let moved = false;
    const ok = await attemptWrite(async () => { moved = await recategorizeFact(s, category, deps(cats)); });
    if (!ok) return;
    if (!moved) { showToast({ message: "The Brain is full · Prune it in What JARVIS Knows" }); return; }
    setSaved(saved.map((x) => (x.id === s.id ? { ...x, factCategory: category } : x)));
  };

  return createPortal(
    // SHELL-F-24 (2026-09-05): the scrim and Cancel used to close the sheet
    // mid-write. The save is a promise this sheet cannot abort, so the task
    // or event was created anyway, with no receipt, no toast and no undo: the
    // one capture in the app that could land invisibly. Neither exit is
    // offered while a save is in flight, exactly as the Capture button is
    // already disabled there. The wait is one write long.
    <div className="sheet-scrim" onClick={() => { if (phase !== "saving") onClose(); }}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{phase === "saved" ? "Saved" : "Smart Paste"}</div></div>

        {phase !== "saved" && (
          <div className="pad-x sheet-form">
            <textarea
              className="input input-multiline"
              placeholder="Paste or type · dinner with Marco Thursday 7pm"
              value={text}
              onChange={(e) => { setText(e.target.value); setDupAge(null); }}
              autoFocus
            />
            {error && <div className="input-error">{error}</div>}
            {dupAge !== null && (
              <div className="input-note">You captured this exact text {Math.max(1, Math.round(dupAge / 86400000))} {dupAge < 86400000 * 1.5 ? "day" : "days"} ago.</div>
            )}
            <div className="sheet-actions">
              {dupAge === null ? (
                <button className="btn btn-primary btn-block" onClick={() => void capture()} disabled={!text.trim() || phase === "saving"}>
                  {phase === "saving" ? "Saving..." : "Capture"}
                </button>
              ) : (
                // B12: the sibling Capture button already disables while
                // saving; this branch could still double-fire.
                <button className="btn btn-primary btn-block" disabled={phase === "saving"} onClick={() => void capture(true)}>{phase === "saving" ? "Saving..." : "Save Anyway"}</button>
              )}
              <button className="btn btn-secondary btn-block" onClick={onClose} disabled={phase === "saving"}>Cancel</button>
            </div>
          </div>
        )}

        {phase === "saved" && (
          <div className="pad-x sheet-form">
            <div className="capture-saved-list">
              {saved.map((s) => (
                <div key={s.id} className="capture-saved">
                  <div className="row">
                    <div className="row-stack">
                      <div className="conn-name">{s.title}</div>
                      {/* A fact says where in the Brain it landed instead of
                          a date it does not have: "Fact · Values". */}
                      <div className="conn-meta">{[readWord(s), ...readFacts(s, {
                        person: people.find((p) => p.id === s.personId)?.name,
                        project: projects.find((p) => p.id === s.projectId)?.title,
                      })].filter(Boolean).join(" · ")} · From your paste</div>
                    </div>
                    <button className="btn-sm" onClick={() => void onUndo(s)}>Undo</button>
                  </div>
                  {/* SHELL-F-16 (2026-09-05): a wrapping row, because the
                      category chips below used to be cats.slice(0, 4) for
                      row width. Every template seeds six areas, so a capture
                      filed under the fifth or sixth showed no active chip
                      and could not be moved there from the receipt at all,
                      which also meant the learned-rules loop could never be
                      taught those areas. Same wrap the gym sheets use. */}
                  <div className="chip-row chip-wrap-row">
                    {/* SHELL-F-02: no Brain, no Fact chip. Offering a lane
                        that cannot take the record is a chip that can only
                        refuse. */}
                    {KINDS.filter((k) => k !== "fact" || strands).map((k) => (
                      <div key={k} className={"chip" + (s.kind === k ? " active" : "")} role="radio" aria-checked={s.kind === k} tabIndex={0} onClick={() => void onKind(s, k)}>{KIND_LABEL[k]}</div>
                    ))}
                    {/* A strand does not use the app's category taxonomy, so
                        a fact's row gets its own six buckets here instead
                        (S4-Q22): the category is a guess same as any other
                        capture, and selfFact.ts has always said the receipt
                        lets it be changed. */}
                    {s.kind === "fact"
                      ? FACT_CATEGORIES.map((c) => (
                          <div key={c} className={"chip" + (s.factCategory === c ? " active" : "")} role="radio" aria-checked={s.factCategory === c} tabIndex={0} onClick={() => void onFactCat(s, c)}>
                            {STRAND_CATEGORY_LABEL[c]}
                          </div>
                        ))
                      : cats.map((c) => (
                          <div key={c.id} className={"chip" + (s.category === c.id ? " active" : "")} role="radio" aria-checked={s.category === c.id} tabIndex={0} onClick={() => void onCat(s, c.id)}>
                            <span className={"cat-dot cat-bg-" + c.data.color} />
                            {c.data.name}
                          </div>
                        ))}
                  </div>
                  {/* UP-CORE-01: who, when the line named more than one real
                      contact. Nobody was filed; these chips are the ask. */}
                  {s.kind === "task" && (s.personChoices?.length ?? 0) > 1 && (
                    <div className="chip-row chip-wrap-row">
                      {s.personChoices!.map((id) => {
                        const p = people.find((x) => x.id === id);
                        return p ? (
                          <div key={id} className={"chip" + (s.personId === id ? " active" : "")} role="radio" aria-checked={s.personId === id} tabIndex={0} onClick={() => void onPerson(s, id)}>
                            {p.name}
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {recents.length > 0 && (
              <>
                <div className="grp"><div className="eyebrow">Recent Captures</div></div>
                <div className="capture-recents">
                  {recents.map((r) => (
                    <div
                      key={r.id}
                      className="row"
                      role={onOpen ? "button" : undefined}
                      tabIndex={onOpen ? 0 : undefined}
                      // S6-Q35: "Recent Captures rows do nothing." A row is
                      // the receipt for something that already exists
                      // somewhere real (a task, an event, a note, a fact in
                      // the Brain) -- tapping it opens THAT, the same thing
                      // every other "recent" strip in the app already does.
                      // No onOpen (a caller that has not wired navigation
                      // yet) leaves the row exactly as inert as it was.
                      onClick={onOpen ? () => { onOpen(r.kind, r.id); onClose(); } : undefined}
                    >
                      <div className="row-stack">
                        <div className="conn-name truncate">{r.title}</div>
                        <div className="conn-meta">{KIND_LABEL[r.kind]} · {fmtRecent(r.ts)}</div>
                      </div>
                      {onOpen && <div className="chev" />}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="sheet-actions">
              <button className="btn btn-primary btn-block" onClick={() => { setText(""); setSaved([]); onClose(); showToast({ message: saved.length === 1 ? "Saved" : `Saved ${saved.length} items` }); }}>Done</button>
              <button className="btn btn-secondary btn-block" onClick={() => { setText(""); setSaved([]); setPhase("input"); }}>Capture Another</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
