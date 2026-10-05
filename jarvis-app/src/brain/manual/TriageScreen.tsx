import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../shared/PageHeader";
import { useBrainMemory, usePeople } from "../../data/NotesProvider";
import { useFreshLists } from "../../data/useFreshLists";
import { pressable } from "../../shared/pressable";
import { attemptWrite } from "../../shared/guard";
import { showToast } from "../../shared/toast";
import { PERSON_ENTITY, BRAIN_ROLES, UNDO_MS } from "../../ai/brainMemory";
import RowActionSheet from "../../shared/RowActionSheet";
import type { Person } from "../../people/types";
import { personInitials, avatarClass } from "../../people/types";
import {
  brainRoleLabel,
  brainRolesOf,
  isUnsorted,
  personSourceLabel,
  readTriageCursor,
  triageSource,
  writeTriageCursor,
} from "./triage";
import { duplicatesOf, mergedPersonData } from "./merge";
import { restorePatch, type Relinked } from "../../people/relink";
import type { PersonData } from "../../people/types";

/**
 * Contact triage (Brain Manual v1): one card at a time, each unsorted
 * contact with their source, the fixed role multi-select, and an optional
 * one-line note. Next files the card (roles + note, triageState "sorted");
 * Skip leaves it unsorted for later. The cursor persists in localStorage,
 * so leaving and coming back resumes where the card left off.
 *
 * A card with a likely duplicate (a shared email or phone, never a name
 * alone) shows the merge view first: both rows, the user picks the one to
 * keep and confirms. The kept row takes every field the other held, every
 * task, note, decision and strand that pointed at the other now points at
 * the kept one, the other row is deleted, and Undo puts all of it back.
 */
export default function TriageScreen({ onBack }: { onBack: () => void }) {
  const peopleSvc = usePeople();
  const brainSvc = useBrainMemory();
  const [people, setPeople] = useState<Person[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Cards judged "not duplicates" this session, by id: the merge view stays
  // down for them even though the duplicate still matches.
  const [notDups, setNotDups] = useState<Set<string>>(new Set());
  // The merge waiting on its confirm: which row stays, which goes.
  const [confirming, setConfirming] = useState<{ survivor: Person; loser: Person } | null>(null);

  const reload = useCallback(async () => {
    const all = await peopleSvc.list();
    setPeople(all);
    return all;
  }, [peopleSvc]);
  useEffect(() => { void reload().then((all) => {
    const queue = all.filter(isUnsorted);
    const ids = queue.map((p) => p.id);
    const cursor = readTriageCursor();
    const at = cursor ? ids.indexOf(cursor) : 0;
    setOrder(ids);
    setIdx(at >= 0 ? at : 0);
  }); }, [reload]);
  useFreshLists([PERSON_ENTITY], reload);

  const current = order.length > 0 ? people.find((p) => p.id === order[Math.min(idx, order.length - 1)]) ?? null : null;
  const dups = current && !notDups.has(current.id) ? duplicatesOf(current, people) : [];

  // A new card starts with its already-filed roles picked, so re-sorting a
  // card keeps what was there.
  useEffect(() => {
    if (current) {
      setPicked(brainRolesOf(current));
      setNote(typeof current.data.roleNote === "string" ? current.data.roleNote : "");
    }
  }, [current?.id]);  

  const remaining = order.length - Math.min(idx, order.length);

  const advanceAfter = (nextOrder: string[], nextIdx: number) => {
    const at = Math.min(nextIdx, Math.max(0, nextOrder.length - 1));
    setOrder(nextOrder);
    setIdx(at);
    writeTriageCursor(nextOrder.length > 0 ? nextOrder[at]! : null);
  };

  const doNext = async () => {
    if (!current || busy) return;
    setBusy(true);
    const ok = await attemptWrite(() =>
      brainSvc.triagePerson(current.id, picked, note.trim() || undefined, triageSource(current)),
    );
    setBusy(false);
    if (!ok) return;
    const all = await reload();
    const nextOrder = all.filter(isUnsorted).map((p) => p.id);
    advanceAfter(nextOrder, idx);
  };

  const doSkip = () => {
    if (!current || busy) return;
    const nextIdx = idx + 1;
    if (nextIdx >= order.length) {
      // Skipped the last card: wrap to the first unsorted card.
      advanceAfter(order, 0);
    } else {
      advanceAfter(order, nextIdx);
    }
  };

  const doMerge = async (survivor: Person, loser: Person) => {
    if (busy) return;
    setBusy(true);
    const before = survivor.data as unknown as Record<string, unknown>;
    const merged = mergedPersonData(survivor, loser) as unknown as Record<string, unknown>;
    const patch = (p: Record<string, unknown>) => p as unknown as Partial<PersonData>;
    let relinked: Relinked[] = [];
    const ok = await attemptWrite(async () => {
      // Kept row first, links second, the other row last: a failure part way
      // leaves both contacts in place, never a link pointing at nothing.
      await peopleSvc.update(survivor.id, patch(restorePatch(merged, before)));
      relinked = await peopleSvc.relink(loser.id, survivor.id);
      await peopleSvc.remove(loser.id);
    });
    setBusy(false);
    if (!ok) return;
    const undo = () => void (async () => {
      const back = await attemptWrite(async () => {
        await peopleSvc.create(loser.data, loser.id);
        await peopleSvc.unrelink(relinked);
        await peopleSvc.update(survivor.id, patch(restorePatch(before, merged)));
      });
      if (back) await reload();
    })();
    showToast({ message: "Merged ✓", actionLabel: "Undo", onAction: undo }, UNDO_MS);
    const all = await reload();
    const nextOrder = all.filter(isUnsorted).map((p) => p.id);
    // Stay on the survivor when it still needs sorting.
    const at = nextOrder.indexOf(survivor.id);
    advanceAfter(nextOrder, at >= 0 ? at : idx);
  };

  const toggleRole = (role: string) =>
    setPicked((p) => (p.includes(role) ? p.filter((r) => r !== role) : [...p, role]));

  return (
    <div className="screen ruled">
      <PageHeader title="Sort Your Contacts" back="Brain" onBack={onBack} />

      {!current ? (
        <div className="empty-state empty-compact">
          <div className="empty-title">All Sorted</div>
          <div className="empty-sub">Every Contact Has a Role</div>
          <button className="btn btn-primary" onClick={onBack}>Done</button>
        </div>
      ) : (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Who Is This</span><span className="n">{remaining}</span></div>

          {dups.length > 0 ? (
            <div className="pad-x"><div className="card list-card-ruled pad">
              <div className="eyebrow">Possible Duplicate</div>
              <div className="conn-meta">Same Person Twice? Keep One.</div>
              {[current, ...dups.slice(0, 1)].map((p) => {
                // CLEAN ROWS (Dave 2026-10-05, locked): the row ASKS and nothing else. The pill that said Keep This One is
                // the row itself now (it was already the row's tap): nothing merges until the confirm, so a stray tap while
                // scrolling deletes nobody.
                const keep = () => {
                  const other = p.id === current.id ? dups[0]! : current;
                  setConfirming({ survivor: p, loser: other });
                };
                return (
                <div {...pressable(keep, { disabled: busy })} className="offer-row" key={p.id} aria-label={"Keep " + p.data.name}>
                  <div className={"av av-32 " + avatarClass(p.data.color)}>{personInitials(p.data.name)}</div>
                  <div className="row-grow">
                    <div className="conn-name truncate">{p.data.name}</div>
                    <div className="facts"><span className="fact">{personSourceLabel(triageSource(p))}</span></div>
                  </div>
                  <div className="chev" />
                </div>
                );
              })}
            </div></div>
          ) : (
            <div className="pad-x"><div className="card list-card-ruled pad">
              <div className="offer-row">
                <div className={"av av-40 " + avatarClass(current.data.color)}>{personInitials(current.data.name)}</div>
                <div className="row-grow">
                  <div className="conn-name">{current.data.name}</div>
                  <div className="facts"><span className="fact">From {personSourceLabel(triageSource(current))}</span></div>
                </div>
              </div>
              <div className="field">
                <div className="input-label">Who Are They to You</div>
                <div className="chip-row chip-wrap-row">
                  {BRAIN_ROLES.map((r) => (
                    <button key={r} type="button"
                      className={"chip" + (picked.includes(r) ? " active" : "")}
                      aria-pressed={picked.includes(r)}
                      onClick={() => toggleRole(r)}>
                      {brainRoleLabel(r)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label className="input-label">One Line (Optional)</label>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. John's Brother, Met at Tucci" />
              </div>
            </div></div>
          )}

          {dups.length > 0 && (
            <div className="pad-x sheet-actions">
              <button type="button" className="btn btn-secondary btn-block" onClick={() => setNotDups((s) => new Set(s).add(current.id))}>
                Not Duplicates, Sort Anyway
              </button>
            </div>
          )}
          {dups.length === 0 && (
            <div className="pad-x sheet-actions">
              <button className="btn btn-primary btn-block" disabled={busy}
                onClick={() => void doNext()}>{busy ? "Saving..." : "Next"}</button>
              <button className="btn btn-secondary btn-block" disabled={busy} onClick={doSkip}>Skip</button>
            </div>
          )}
          <div className="screen-foot" />
        </>
      )}
      {confirming && (
        <RowActionSheet
          title={`Keep ${confirming.survivor.data.name}? ${confirming.loser.data.name} Merges Into Them`}
          actions={[{ label: "Merge", destructive: true, onPick: () => { const c = confirming; setConfirming(null); void doMerge(c.survivor, c.loser); } }]}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
