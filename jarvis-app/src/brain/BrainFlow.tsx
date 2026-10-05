import { useCallback, useEffect, useRef, useState } from "react";
import BrainPage, { type BrainCategory } from "./BrainPage";
import type { TopMemo } from "./BrainTop";
import { useCategories } from "../data/NotesProvider";
import { useFreshLists } from "../data/useFreshLists";
import { ENTITY_CATEGORY } from "../categories/types";
import PeopleFlow from "../people/PeopleFlow";
import BrainDocPage from "./docs/BrainDocPage";
import CategoryDetail from "./CategoryDetail";
import RoutineFlow from "../routine/RoutineFlow";
import DecisionsFlow from "../decisions/DecisionsFlow";
import InsightsFlow from "../review/InsightsFlow";
import HubFlow from "../hub/HubFlow";
import StrandsPage from "./strands/StrandsPage";
// Brain Manual v1: the contacts triage screen, opened from Contacts'
// Continue Sorting row. The hub rows keep their own pages (Dave 2026-09-28:
// nothing already saved goes invisible, and no screen looks new).
import TriageScreen from "./manual/TriageScreen";
import { usePushDepth } from "../shared/pushNav";
import { useNavOrigin } from "../shell/navOrigin";
import { effectiveKind } from "../categories/kinds";

const DOC_TOPIC: Record<string, string> = {
  philosophy: "philosophy",
  writing: "writing",
  values: "values",
};

// The Brain tab. The hub is built. Contacts opens the one people list (the
// Inner Circle / Adversarial rows were cut 2026-08-03); the doc rows open a
// lightweight placeholder for now. "Your Categories" is populated live.
export default function BrainFlow({ openKey, openNonce, onKeyConsumed, routineBlockId, onRoutineBlockConsumed, personOpenId, personNonce, onPersonConsumed, decisionOpenId, decisionNonce, onDecisionConsumed, factOpenId, factNonce, onFactConsumed, onOpenNote, onOpenProject, onOpenMoney, onOpenEntity, autoOpenGym, gymNonce, onGymConsumed, healthLogKey, healthLogNonce, onHealthLogConsumed }: { openKey?: string;
  // BRAIN-F-03 (2026-09-05): the nonce and the callback, the shape
  // shell/intents.ts describes. Without them openKey was read once in the
  // useState below, so a deep link that arrived while the Brain tab was
  // already open (a fact from Quick Add, a search hit, a decision from Chat)
  // changed nothing at all: setActive("brain") on the active tab remounts
  // nothing, and a prop nobody re-reads is not a navigation.
  openNonce?: number; onKeyConsumed?: () => void;
  routineBlockId?: string; onRoutineBlockConsumed?: () => void;
  // BRAIN-F-04 (2026-09-05): each of these is a one-shot the screen behind
  // this hub consumes for itself (shell/intents.ts). BrainFlow only forwards
  // them: the id has to survive until Contacts, Decisions or What JARVIS
  // Knows is actually mounted, which is one render after this flow opens.
  personOpenId?: string; personNonce?: number; onPersonConsumed?: () => void;
  decisionOpenId?: string; decisionNonce?: number; onDecisionConsumed?: () => void;
  factOpenId?: string; factNonce?: number; onFactConsumed?: () => void;
  onOpenNote?: (id: string) => void; onOpenProject?: (id: string) => void; onOpenMoney?: () => void; onOpenEntity?: (kind: string, id: string) => void;
  autoOpenGym?: boolean; gymNonce?: number; onGymConsumed?: () => void;
  /** Push D: open the health area with this log (a ShortcutKey) already open. */
  healthLogKey?: string; healthLogNonce?: number; onHealthLogConsumed?: () => void } = {}) {
  const cats = useCategories();
  // The hub's last read, kept here because the hub itself is unmounted while a page is open over it.
  const topMemo = useRef<TopMemo>({}).current;
  const [categories, setCategories] = useState<BrainCategory[]>([]);
  const [open, setOpen] = useState<{ key: string; name: string } | null>(
    openKey ? { key: openKey, name: "" } : null,
  );

  // A person tapped through from an area page, kept separately from the
  // shell's intent so an explicit tap always wins over a stale link.
  const [personId, setPersonId] = useState<string | undefined>(undefined);
  // C-38 (Astra, 2026-09-12): a strand tapped in the hub's top bands, and the
  // filter What JARVIS Knows opens under. Same one-shot shape as the shell's
  // intents: the id is spent when the page consumes it, the filter when the
  // page closes.
  const [topFact, setTopFact] = useState<{ id: string; nonce: number } | null>(null);
  const [knowsFilter, setKnowsFilter] = useState<"watching" | undefined>(undefined);
  // C-38 fix (2026-09-13): which readiness detector the tapped row named, so
  // the Watching filter it opens under can land on and highlight that one
  // row instead of the same generic screen every watching row used to share.
  const [knowsFocusKey, setKnowsFocusKey] = useState<string | undefined>(undefined);

  // BRAIN-F-03: the deep link, every time it fires, not just at mount. The
  // nonce is in the deps because the shell can ask for the SAME door twice
  // (tap the same search hit, capture a second fact) and that is a real
  // navigation. onKeyConsumed clears it, so backing out to the hub and
  // tapping Contacts later opens the list, not the last thing linked.
  useEffect(() => {
    if (!openKey) return;
    setOpen({ key: openKey, name: "" });
    setPersonId(undefined);
    markJumped();
    onKeyConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, openNonce]);

  // Whether the category list has ARRIVED, which is not the same question as
  // whether it is empty. Without this the fallback below cannot tell "no such
  // area" from "not loaded yet", and a category opened by deep link would
  // flash a dead end on its way to rendering.
  const [catsLoaded, setCatsLoaded] = useState(false);
  const loadCats = useCallback(async () => {
    const list = await cats.list();
    setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color, icon: c.data.icon, kind: effectiveKind(c.data) })));
    setCatsLoaded(true);
  }, [cats]);
  useEffect(() => { void loadCats(); }, [loadCats]);
  // UP-PLAT-06 (2026-09-06): an area renamed on another device repaints here.
  useFreshLists([ENTITY_CATEGORY], loadCats);

  // AN AREA THAT DOES NOT EXIST IS NOT AN AREA (2026-08-26). This used to
  // fall through to a screen reading "This area is coming soon.", which was
  // unreachable in practice (every key BrainPage offers is handled above)
  // but not harmless: it was read as an App Store blocker twice, once by a
  // session doc and once by me, because a grep for placeholder copy finds it
  // and nothing in the file says it is dead. Shipped code that lies about
  // what the app does costs more than the line it saves.
  //
  // A key with nothing behind it now closes back to the hub, which is the
  // only honest thing an unknown area can do.
  useEffect(() => {
    if (!open || !catsLoaded) return;
    const known = open.key in DOC_TOPIC
      // "aihub" joined this list in slice 09's QA (2026-10-04): the row set the key and this guard
      // closed it back to the hub a frame later, so the AI Hub read as a dead button.
      || ["knows", "month", "routine", "decisions", "contacts", "triage", "aihub"].includes(open.key)
      || categories.some((c) => c.id === open.key);
    if (!known) setOpen(null);
  }, [open, catsLoaded, categories]);

  // The app had two "Money"s (2026-08-10, Dave: "there should only be one
  // money category with all of its features"): this category, which opened a
  // generic skeleton page with no financial data on it, and the real Money
  // tab (accounts, bills, budget). Whichever way a money category is opened
  // here, click or a search deep-link, it now lands on the one real Money
  // feature instead of the dead end. The category itself still exists (it's
  // still a legitimate task/note tag and still groups under "Money" in the
  // list above); tapping it just goes somewhere real now.
  useEffect(() => {
    if (!open || !onOpenMoney) return;
    const cat = categories.find((c) => c.id === open.key);
    if (cat && cat.kind === "money") {
      onOpenMoney();
      setOpen(null);
    }
  }, [open, categories, onOpenMoney]);

  // A health log asked for by a reminder: the health area is whichever
  // category is of that kind; the page opens the logger and says consumed.
  useEffect(() => {
    if (!healthLogKey || !catsLoaded) return;
    const cat = categories.find((c) => c.kind === "health");
    if (cat) { setOpen({ key: cat.id, name: cat.name }); markJumped(); }
    else onHealthLogConsumed?.();
  }, [healthLogKey, healthLogNonce, catsLoaded, categories, onHealthLogConsumed]);

  const pushCls = usePushDepth(open ? 1 : 0);

  // THE WAY HOME FROM A PAGE A JUMP OPENED (Alfred 2026-10-04: a floating "< Life" over Your Routine on the hub).
  // Life > Areas > Health, a search hit, a notice's Open: each is a cross-tab jump, and the shell keeps where it came
  // from (shell/navOrigin) and draws a return pill above the dock for as long as that page is open. That is the design,
  // and it is right ON the page the jump opened. The fault was after it: the page's own back closes to the hub and the
  // origin stayed live, so the pill floated over the hub's last row with no page left for it to be the way home from.
  // The root fix is that a page the jump opened RELEASES the origin when it closes to the hub (nav.clear), rather than
  // hiding it while this flow is mounted. A page opened by a tap inside the hub never marks itself jumped, so it can
  // never end an origin it did not open.
  const nav = useNavOrigin();
  const jumpedRef = useRef(false);
  const markJumped = () => { jumpedRef.current = true; };
  const { clear: clearOrigin } = nav;
  const closeToHub = () => {
    setOpen(null);
    if (!jumpedRef.current) return;
    jumpedRef.current = false;
    clearOrigin();
  };

  const detail = (() => {
    if (!open) return null;
    if (open.key === "knows") {
      return (
        <StrandsPage
          openId={topFact?.id ?? factOpenId}
          openNonce={topFact ? topFact.nonce : factNonce}
          onOpenConsumed={() => { setTopFact(null); onFactConsumed?.(); }}
          initialFilter={knowsFilter}
          focusReadinessKey={knowsFocusKey}
          onBack={() => { setKnowsFilter(undefined); setKnowsFocusKey(undefined); closeToHub(); }}
        />
      );
    }
    if (open.key === "month") {
      // The report's cards exit to the places they count (2026-09-26, the
      // pass-off): a person, a category, Money, Email. Same doors the rest
      // of Brain already hands its pages.
      return <InsightsFlow onBack={() => closeToHub()} onOpenTask={onOpenEntity ? (id) => onOpenEntity("task", id) : undefined}
        onOpenEntity={onOpenEntity} onOpenMoney={onOpenMoney} onOpenEmail={onOpenEntity ? () => onOpenEntity("email", "") : undefined} />;
    }
    if (open.key === "routine") {
      return <RoutineFlow onBack={() => closeToHub()} focusId={routineBlockId} onFocusConsumed={onRoutineBlockConsumed} />;
    }
    if (open.key === "aihub") {
      // THE AI HUB (docs/jarvis-unified, slice 04). Its Email door is the
      // shell's own email entity route; its records open their owning module.
      return <HubFlow onBack={() => closeToHub()} onOpenEntity={onOpenEntity} onOpenEmail={onOpenEntity ? () => onOpenEntity("email", "") : undefined} />;
    }
    if (open.key === "decisions") {
      return <DecisionsFlow openId={decisionOpenId} openNonce={decisionNonce} onOpenConsumed={onDecisionConsumed}
        onOpenSource={onOpenEntity} onBack={() => closeToHub()} />;
    }
    if (open.key === "contacts") {
      // BRAIN-F-04: an explicit tap (personId, set by a person row on an area
      // page) wins over a link, which is spent the moment PeopleFlow opens it.
      return <PeopleFlow openId={personId ?? personOpenId} openNonce={personNonce} onOpenConsumed={onPersonConsumed} onOpenNote={onOpenNote} onOpenItem={onOpenEntity}
        onOpenTriage={() => setOpen({ key: "triage", name: "Sort Your Contacts" })} onBack={() => { setPersonId(undefined); closeToHub(); }} />;
    }
    if (open.key === "triage") {
      return <TriageScreen onBack={() => setOpen({ key: "contacts", name: "Contacts" })} />;
    }
    const topic = DOC_TOPIC[open.key];
    if (topic) {
      return <BrainDocPage topic={topic} onBack={() => closeToHub()} />;
    }
    const cat = categories.find((c) => c.id === open.key);
    if (cat) {
      // The page loads its own live record (name/colour/kind survive edits);
      // onChanged keeps this hub's list fresh after a rename or delete.
      return (
        <CategoryDetail
          categoryId={cat.id}
          onBack={() => closeToHub()}
          onOpenNote={onOpenNote}
          onOpenProject={onOpenProject}
          onOpenPerson={(id) => { setPersonId(id); setOpen({ key: "contacts", name: "Contacts" }); }}
          onOpenContacts={() => { setPersonId(undefined); setOpen({ key: "contacts", name: "Contacts" }); }}
          onOpenTask={onOpenEntity ? (id) => onOpenEntity("task", id) : undefined}
          onOpenGoal={onOpenEntity ? (id) => onOpenEntity("goal", id) : undefined}
          onChanged={() => void loadCats()}
          autoOpenGym={autoOpenGym}
          gymNonce={gymNonce}
          onGymConsumed={onGymConsumed}
          autoOpenLog={healthLogKey}
          logNonce={healthLogNonce}
          onLogConsumed={onHealthLogConsumed}
        />
      );
    }
    // Nothing matched. While the categories are still loading this is simply
    // "not yet", so hold an empty screen for a frame rather than asserting
    // anything; once they have loaded, the effect above has already sent us
    // back to the hub.
    return catsLoaded ? null : <div className="screen" />;
  })();

  if (detail) return <div className={pushCls} key={"d-" + open!.key}>{detail}</div>;
  return (
    <div className={pushCls} key="base">
      <BrainPage
        onOpen={(key, name) => setOpen({ key, name })}
        onOpenFact={(id) => { setTopFact((t) => ({ id, nonce: (t?.nonce ?? 0) + 1 })); setOpen({ key: "knows", name: "What JARVIS Knows" }); }}
        onOpenWatching={(key) => { setKnowsFilter("watching"); setKnowsFocusKey(key); setOpen({ key: "knows", name: "What JARVIS Knows" }); }}
        categories={categories}
        memo={topMemo}
      />
    </div>
  );
}
