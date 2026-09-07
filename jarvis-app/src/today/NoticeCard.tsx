import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSwipe } from "../shared/useSwipe";
import { useLongPress } from "../shared/useLongPress";
import { haptics } from "../shared/haptics";
import { Quiet, type Heat } from "./quiet";

// THE NOTICE LAW (A1, 2026-08-20), extended by FORM FOLLOWS DECISION
// (Law 3E, approved 2026-08-22).
//
// Every notice is still built exactly one way -- colored glyph, the words,
// exactly one visible control -- but it now renders in one of two FORMS,
// and the STREAM decides which, never the producer:
//
//   card       the classic anatomy (default; used outside ranked streams)
//   row        every other actionable notice: ONE line, fact plus capsule
//
// TODAY-F-18 (2026-09-05): there were three. The headliner (big type, verbs
// as capsules on their own line) was retired in the stream on 2026-08-22
// (see stream.ts, which returns headliner: null unconditionally) and its
// branch lived on here, reachable only by a test passing form="headliner".
// A form nothing can ask for is a form nobody maintains; it went, with its
// CSS. stream.ts's own comment records why the promotion stopped.
//
// A row is a fact wearing its verb, not a paragraph wearing a pill. Tapping
// a row's body expands it to the full card in place (progressive
// disclosure), which is where alt actions, feet, and onOpen live. Dismiss
// stays a swipe in every form: on a one-line row a corner x and the capsule
// are the same place.
//
// Subs render through the quiet line: words whisper, data pops, heat only
// where the producer says so.

// THE DEFAULT TONE IS NOT RED (Dave 2026-08-29, the notice audit, Wave 3).
//
// This component fell back to `cat-fg-red` when a producer passed no tone,
// which made ALARM the thing you got by forgetting. Every current caller
// happens to pass a tone, so nothing on screen was wrong -- and that is
// exactly the shape of a landmine: the next notice anybody adds is red until
// somebody notices, and the person noticing is Dave, on his phone, being
// told a pleasant thing in the colour of a fire.
//
// Slate is the fallback because it says "a notice" and nothing more. A
// notice that wants to shout has to say so.
const DEFAULT_TONE = "cat-fg-slate";

export interface NoticeAction {
  label: string;
  onClick: () => void;
}

export default function NoticeCard({
  icon,
  tone,
  title,
  sub,
  heat = null,
  action,
  alt,
  onDismiss,
  onDelete,
  onOpen,
  foot,
  form = "card",
  uniform = true,
  stack = false,
  // Read by the stream's ranker, not by this component; declared so the
  // props are typed at every call site.
  weight,
  receipt,
  anchor,
  automation,
  onTune,
}: {
  icon: ReactNode;
  // UP-CORE-14 (2026-09-05): which producer made this card ("gap-fill",
  // "goal-nudge"), and what to do with a tuning choice. Both or neither: a
  // card nobody names is a thing the person did themselves, and holding it
  // offers nothing. The write is the caller's, so this component still owns
  // no services.
  automation?: string;
  onTune?: (choice: "more" | "less" | "never") => void;
  // A cat-fg-* class. Color is the notice's category, never decoration.
  tone?: string;
  title: ReactNode;
  sub?: ReactNode;
  // Heat on the sub's data, when the producer's own thresholds say so.
  heat?: Heat;
  // The one visible control. Omit it and the row opens (chevron) instead.
  action?: NoticeAction;
  // The second path: a capsule beside the primary on a headliner, on the
  // swipe reveal elsewhere.
  alt?: NoticeAction;
  onDismiss?: () => void;
  // Trashes the underlying mail, not just this card (2026-08-26, Dave: "I
  // should be able to delete from here"). Separate from onDismiss, which
  // only ever hid the notice and left the email exactly where it was, a
  // distinction the swipe reveal never surfaced, so he read "Dismiss" as
  // "make it go away" and found the email still sitting in his inbox.
  onDelete?: () => void;
  onOpen?: () => void;
  // Extra rows below the main line, inside the same card (the email stack).
  foot?: ReactNode;
  form?: "card" | "row";
  // ONE HEIGHT FOR THE WHOLE STREAM (Dave 2026-08-25: "Why are the heads up
  // containers different sizes? They should all be the size of update workout
  // feature"). A card's title takes up to two lines and its sub takes up to
  // two more, so the same component rendered anything from one line to four
  // and the stream looked like three different components.
  //
  // Uniform clamps both to exactly one line. Default ON, because he asked for
  // all of them and an opt-in default would have left the stream as it was.
  //
  // Mail opts OUT, and that is his call too (2026-08-25, "mail stays"). A
  // mail notice's title is a SENDER, which is whatever length the world
  // chooses; the 22 Aug screenshot of "nikestrength H… Missi…" is what the
  // one-line form does to one. Everything else here is a phrase this app
  // wrote itself and can be trusted to fit.
  uniform?: boolean;
  /* THE VERB MOVES UNDER THE WORDS WHEN THE WORDS ARE THE POINT (2026-09-07).
     Measured at 390x844: the right slot's capsule takes 139px of a 326px row,
     which leaves the text 133px. That is fine for a card whose words are a
     label and whose verb is the point ("Nadia Brandt" / Reply). It is wrong
     for a card that states a CLAIM and asks him to accept it forever: "You
     train between 5 PM and 8 PM" over "14 Sessions there, out of your last
     14" came out as "You train between 5 P..." over "14 Sessions there, out
     of yo...", both halves destroyed, with Remember This sitting in clean
     space beside them.
     Stacked, the words get the whole width and the capsule sits under them.
     It is still a capsule (contract 4.4, always a capsule), and stacking an
     action that does not fit beside its neighbours is the move 4.12 already
     rules for sheets. Only a producer that knows its words carry the decision
     asks for this; every other notice keeps the row it has. */
  stack?: boolean;
  weight?: number;
  receipt?: boolean;
  // Read only by rankStream (2026-08-26): marks the one element the stream
  // should never wedge between two others. See stream.ts for the rule.
  anchor?: boolean;
}) {
  void weight; void receipt; void anchor;
  const [expanded, setExpanded] = useState(false);
  const effForm = form === "row" && expanded ? "card" : form;

  // A SHREDDED SUB IS WORSE THAN NO SUB (Dave 2026-08-22, measured off his
  // screenshot). On a verb row the line is whatever the button leaves: with
  // a 13-character verb that is 143px for fact AND sub together, so both
  // ellipsed and "2 Blocks Slip... Behi..." told him nothing twice. The
  // FACT is the row's reason for existing and the sub only supports it, so
  // the sub is what yields. The law is the STREAM's, not the row's: a sub
  // renders whole or not at all.
  //
  // ONE LAW, TWO FORMS (2026-09-06, Dave photographed What JARVIS Knows at
  // 390x844: "You train bet... / 14 Sessions th..."). This latch used to
  // exempt every card form, on the reasoning that "there the sub owns a
  // full line under the title and wrapping to two lines is the design".
  // That is true of the NON-UNIFORM card and of nothing else. A uniform
  // card is clamped to one nowrap line each by .notice-card-uniform
  // .conn-name / .conn-meta (components.css), so the comment described a
  // card the stream had not rendered since 2026-08-25 while the CSS
  // shredded the one it did. The CSS is what Dave sees, so the CSS is what
  // the law has to answer: measured, the offer's title asked 296px of the
  // 133px the pill left it, and lost 55% of the sentence that is the whole
  // reason the card exists.
  //
  // The sub yields the room the title needs, and each form says "room" in
  // its own geometry:
  //   row     one shared line. The fact is clipped (the sub is stealing
  //           room the fact needs), OR the sub itself cannot finish (a mail
  //           gist ending at "...starts Mon" is furniture pretending to be
  //           information). Either one, and the sub goes.
  //   uniform the two lines are stacked, not shared, so the sub holds
  //   card    nothing the title is short of until the title needs a second
  //           line. Only a clipped TITLE drops it; a sub that ellipses
  //           beside a title that fits keeps its line, because dropping it
  //           would buy the title a line it does not want and cost the card
  //           a fact it had. That is why Dental Cleaning's "Looks like
  //           tuesday 2:00 PM - 45 Min" still renders.
  // Dropping the sub is what turns .notice-card-solo on (it keys on a sub
  // RENDERED, not passed), and solo is what hands the title both lines at
  // the same 72px card height.
  //
  // AND ONLY WHERE THERE IS A SECOND LINE TO HAND IT. The trade is free
  // because a uniform card is a TWO-LINE BOX: min-height 72 is two lines of
  // title type, so the sub's line becomes the title's and the card does not
  // move. The grouped Heads Up band stands that box down on purpose (.ruled
  // .stream-grouped .notice-card-uniform is 56, one line, the density it
  // chose), and there the same trade costs a fact and buys 4.5px of extra
  // height: measured, "Complete Your Enrollment" went 61.05 to 65.59 beside
  // neighbours still at 61.05, which is the ragged stream Dave asked us to
  // stop making in the first place. So the card form reads its own box
  // before it spends it, rather than assuming the 72.
  //
  // The non-uniform card stays exempt, and now for the stated reason: mail
  // opts out of the clamp, so its sub really does own a full line and
  // really does wrap.
  //
  // Measured, not predicted: a character budget would have to guess the
  // font, and Dynamic Type moves it. The latch is one-way per mounted
  // notice -- dropping the sub only ever gives the fact more room, so it
  // cannot oscillate -- and producers key their notices, so new content
  // arrives as a new instance with a fresh measurement.
  const factRef = useRef<HTMLElement | null>(null);
  const subRef = useRef<HTMLElement | null>(null);
  const [subDropped, setSubDropped] = useState(false);
  useLayoutEffect(() => {
    if (subDropped) return;
    // The one form with no clamp to answer to.
    if (effForm !== "row" && !uniform) return;
    // ZERO TOLERANCE, measured live (probe 2026-08-26): Rent's sub sat at
    // scrollWidth 146 vs clientWidth 145, the old +1 grace called that
    // "fits", and text-overflow answered a 1px deficit by eating "ay" and
    // three more characters to seat the ellipsis. One pixel over is not a
    // pixel of loss; it is a word of loss. The law says whole or not at
    // all, so the comparison is exactly that.
    const over = (el: HTMLElement | null) => !!el && el.scrollWidth > el.clientWidth;
    // Does this card's box already hold two lines of its title? Read, never
    // assumed: the 72 is a base rule and a band is allowed to override it,
    // so the question is asked of the rendered card and not of the number.
    const twoLineBox = (fact: HTMLElement) => {
      const card = fact.closest(".notice-card");
      const line = fact.closest(".row");
      if (!card || !line) return false;
      const ls = getComputedStyle(line);
      const lh = parseFloat(getComputedStyle(fact).lineHeight);
      const pad = parseFloat(ls.paddingTop) + parseFloat(ls.paddingBottom);
      if (!Number.isFinite(lh) || !Number.isFinite(pad)) return false;
      return card.getBoundingClientRect().height >= 2 * lh + pad;
    };
    const check = () => {
      const fact = factRef.current;
      if (fact && over(fact) && (effForm === "row" || twoLineBox(fact))) { setSubDropped(true); return; }
      if (effForm === "row" && over(subRef.current)) setSubDropped(true);
    };
    check();
    // A LATCH THAT LOOKS ONLY AT MOUNT CAN MISS (Dave's 9:57 screenshot,
    // 2026-08-26: "All 1 do..." shipped mid-word). The mount-time
    // measurement runs before layout fully settles on a real phone, and if
    // no re-render follows, a sub that later loses room stays shredded on
    // screen with the latch still open. The observer re-measures whenever
    // the line's box actually changes, so the law holds after the moment
    // this effect happened to look.
    const line = factRef.current?.parentElement;
    if (!line || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(line);
    return () => ro.disconnect();
  });
  // Both forms keep alt on the swipe reveal.
  const altOnReveal = alt;
  const acts = (altOnReveal ? 1 : 0) + (onDismiss ? 1 : 0) + (onDelete ? 1 : 0);
  const swipe = useSwipe({ revealW: acts * 88, enabled: acts > 0 });
  // UP-CORE-14: the hold that opens the tuning sheet. Only on a card that
  // names its producer, so an ordinary notice keeps every gesture it had.
  const [tuneOpen, setTuneOpen] = useState(false);
  const hold = useLongPress({ onLongPress: () => { haptics.selection(); setTuneOpen(true); }, enabled: !!onTune && !!automation });

  const subNode = sub != null && (typeof sub === "string" ? <Quiet s={sub} heat={heat} /> : sub);

  const inner =
    effForm === "row" ? (
      <div
        className="row notice-vrow"
        // B3-6 (2026-09-04): this used to set role/tabIndex unconditionally,
        // so a row with none of foot, alt or onOpen (the bill card, Fresh
        // Start, Resume, the finished-project offer, the goal nudge, the
        // monthly report card) announced itself as a button to a screen
        // reader and took focus in the tab order for a tap that did nothing.
        // The card form just below already gates the same way; this matches it.
        role={(foot || alt || onOpen) ? "button" : undefined}
        tabIndex={(foot || alt || onOpen) ? 0 : undefined}
        onClick={() => { if (foot || alt) setExpanded(true); else if (onOpen) onOpen(); }}
      >
        <div className={"row-glyph notice-disc " + (tone ?? DEFAULT_TONE).replace("cat-fg-", "cat-bg-")}>{icon}</div>
        <div className="row-grow vrow-line">
          <span className="conn-name vrow-fact" ref={(el) => { factRef.current = el; }}>{title}</span>
          {subNode && !subDropped && <span className="conn-meta vrow-sub" ref={(el) => { subRef.current = el; }}>{subNode}</span>}
        </div>
        {action ? (
          <button className="pill-act" onClick={(e) => { e.stopPropagation(); action.onClick(); }}>
            {action.label}
          </button>
        ) : (
          <div className="chev" />
        )}
      </div>
    ) : (
      <>
        <div
          className="row"
          role={onOpen ? "button" : undefined}
          tabIndex={onOpen ? 0 : undefined}
          onClick={onOpen}
        >
          <div className={"row-glyph notice-disc " + (tone ?? DEFAULT_TONE).replace("cat-fg-", "cat-bg-")}>{icon}</div>
          <div className="row-grow">
            {/* Same refs the verb row uses: the latch above is one law and
                it measures whichever form is on screen. */}
            <div className="conn-name" ref={(el) => { factRef.current = el; }}>{title}</div>
            {subNode && !subDropped && <div className="conn-meta" ref={(el) => { subRef.current = el; }}>{subNode}</div>}
          </div>
          {action && !stack ? (
            <button
              className="pill-act"
              onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            >
              {action.label}
            </button>
          ) : onOpen ? (
            <div className="chev" />
          ) : null}
        </div>
        {action && stack && (
          <div className="notice-stack">
            <button className="pill-act" onClick={(e) => { e.stopPropagation(); action.onClick(); }}>
              {action.label}
            </button>
          </div>
        )}
        {alt && effForm === "card" && form === "row" && (
          /* An expanded row surfaces its alt as a visible second capsule:
             the swipe reveal exists, but the whole point of expanding was
             to see the rest. */
          <div className="hl-acts">
            <button className="btn btn-sm" onClick={alt.onClick}>{alt.label}</button>
          </div>
        )}
        {foot}
      </>
    );

  // Slot order matches MailSwipe's own reveal (Delete outermost, at the
  // edge you meet first): a swipe should feel the same wherever it fires.
  // Offsets are computed rather than hardcoded because a notice can carry
  // any subset of the three (a plain reminder has only Dismiss; a mail
  // notice can carry all three), and a fixed "beside-dismiss"-style class
  // per pair does not scale past two.
  let slot = 0;
  const deleteRight = onDelete ? slot++ * 88 : 0;
  const dismissRight = onDismiss ? slot++ * 88 : 0;
  const altRight = altOnReveal ? slot++ * 88 : 0;

  return (
    <div className="pad-x">
      {/* TODAY-F-23 (2026-09-05): tabbing into one of the revealed buttons
          opens the rail around it, so a keyboard or switch user is never
          pressing a control parked underneath the card. */}
      <div className="notice-swipe" onFocus={swipe.revealFocus}>
        {altOnReveal && (
          <button
            className="notice-alt"
            data-reveal
            style={altRight ? { right: altRight } : undefined}
            onClick={() => swipe.closeThen(altOnReveal.onClick)}
          >
            {altOnReveal.label}
          </button>
        )}
        {onDismiss && (
          <button
            className="notice-dismiss"
            data-reveal
            style={dismissRight ? { right: dismissRight } : undefined}
            onClick={() => swipe.closeThen(onDismiss)}
          >
            Dismiss
          </button>
        )}
        {onDelete && (
          <button
            className="notice-delete"
            data-reveal
            style={deleteRight ? { right: deleteRight } : undefined}
            onClick={() => swipe.closeThen(onDelete)}
          >
            Delete
          </button>
        )}
        <div
          className={"card notice-card"
            + (effForm === "row" ? " notice-card-row" : "")
            /* ROWS JOIN THE CARDS (2026-08-25, second pass). The first pass
               clamped only the card form, which is the rare pinned one, so
               Dave's stream was a retired headliner plus rows at 55px plus
               one card at 66px: still three heights.
               His pick was two fixed lines, and 66px IS that. Measured at
               55px the lead notice lost 26% of "Student template ships
               first" to a single line. A uniform height that throws away a
               quarter of the sentence is the wrong uniform height. */
            + (uniform && (effForm === "card" || effForm === "row") ? " notice-card-uniform" : "")
            + (stack ? " notice-card-stack" : "")
            /* A UNIFORM CARD IS TWO LINES TALL, and how it spends them is
               its own business. With a sub, that is one line each. WITHOUT
               one, the title takes both, which costs nothing: the card is
               the same height either way.
               Found by the page sweep, which measured "Run three times a
               week" losing 34% of itself to a clamp it did not need. Fixed
               height was the ask; throwing away words was not. */
            /* Solo means no sub is RENDERED, not no sub was passed. The row
               form measures and DROPS a sub it cannot finish (the "shredded
               sub" rule), and reading the prop instead of the outcome left
               the lead notice with a dropped sub, an unused second line, and
               a title still truncated to fit one. */
            + (uniform && (effForm === "card" || effForm === "row") && !(subNode && !subDropped) ? " notice-card-solo" : "")
            + (swipe.dragging ? " swiping" : "")}
          style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
          {...swipe.handlers}
          {...(onTune ? hold : {})}
        >
          {inner}
        </div>
        {/* UP-CORE-14 (2026-09-05): HOLD AN AUTOMATED CARD AND TUNE IT. This
            is how the paid AI tier stays welcome: the person tunes it where
            it happens, without a settings trip, and every tuning is a
            visible, deletable rule in What JARVIS Learned. The sheet is
            three rows and nothing else, because there are exactly three
            things to say to a producer. */}
        {tuneOpen && onTune && (
          <>
            <div className="block-menu-scrim" onClick={() => setTuneOpen(false)} />
            <div className="block-menu notice-tune">
              <button className="block-menu-item" onClick={() => { setTuneOpen(false); onTune("more"); }}>More Like This</button>
              <button className="block-menu-item" onClick={() => { setTuneOpen(false); onTune("less"); }}>Less of This</button>
              <button className="block-menu-item danger" onClick={() => { setTuneOpen(false); onTune("never"); }}>Never</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
