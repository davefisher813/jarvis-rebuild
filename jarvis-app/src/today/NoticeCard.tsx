import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSwipe } from "../shared/useSwipe";
import { Quiet, type Heat } from "./quiet";

// THE NOTICE LAW (A1, 2026-08-20), extended by FORM FOLLOWS DECISION
// (Law 3E, approved 2026-08-22).
//
// Every notice is still built exactly one way -- colored glyph, the words,
// exactly one visible control -- but it now renders in one of three FORMS,
// and the STREAM decides which, never the producer:
//
//   card       the classic anatomy (default; used outside ranked streams)
//   headliner  the one notice most worth the next tap: big type, its verbs
//              as real capsules on their own line
//   row        every other actionable notice: ONE line, fact plus capsule
//
// A row is a fact wearing its verb, not a paragraph wearing a pill. Tapping
// a row's body expands it to the full card in place (progressive
// disclosure), which is where alt actions, feet, and onOpen live. Dismiss
// stays a swipe in every form: on a one-line row a corner x and the capsule
// are the same place.
//
// Subs render through the quiet line: words whisper, data pops, heat only
// where the producer says so.

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
  onOpen,
  foot,
  form = "card",
  uniform = true,
  // Read by the stream's ranker, not by this component; declared so the
  // props are typed at every call site.
  weight,
  receipt,
}: {
  icon: ReactNode;
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
  onOpen?: () => void;
  // Extra rows below the main line, inside the same card (the email stack).
  foot?: ReactNode;
  form?: "card" | "headliner" | "row";
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
  weight?: number;
  receipt?: boolean;
}) {
  void weight; void receipt;
  const [expanded, setExpanded] = useState(false);
  const effForm = form === "row" && expanded ? "card" : form;

  // A SHREDDED SUB IS WORSE THAN NO SUB (Dave 2026-08-22, measured off his
  // screenshot). On a verb row the line is whatever the button leaves: with
  // a 13-character verb that is 143px for fact AND sub together, so both
  // ellipsed and "2 Blocks Slip... Behi..." told him nothing twice. The
  // FACT is the row's reason for existing and the sub only supports it, so
  // the sub is what yields. The law is the STREAM's, not the row's: a sub
  // renders whole or not at all, in a row and in the headliner's foot
  // alike. (The plain card form is exempt: there the sub owns a full line
  // under the title and wrapping to two lines is the design.)
  //
  // Two ways a row runs out of line, and the sub loses both: the fact is
  // clipped (the sub is stealing room the fact needs), or the sub itself
  // cannot finish (a mail gist ending at "...starts Mon" is furniture
  // pretending to be information).
  //
  // Measured, not predicted: a character budget would have to guess the
  // font, and Dynamic Type moves it. The latch is one-way per mounted
  // notice -- dropping the sub only ever gives the fact more room, so it
  // cannot oscillate -- and producers key their notices, so new content
  // arrives as a new instance with a fresh measurement.
  const factRef = useRef<HTMLSpanElement>(null);
  const subRef = useRef<HTMLSpanElement>(null);
  const [subDropped, setSubDropped] = useState(false);
  useLayoutEffect(() => {
    if ((effForm !== "row" && effForm !== "headliner") || subDropped) return;
    const over = (el: HTMLElement | null) => !!el && el.scrollWidth > el.clientWidth + 1;
    if (over(factRef.current) || over(subRef.current)) setSubDropped(true);
  });
  // Headliners show alt beside the primary, so the swipe carries only
  // Dismiss there; other forms keep alt on the reveal.
  const altOnReveal = effForm === "headliner" ? undefined : alt;
  const acts = (altOnReveal ? 1 : 0) + (onDismiss ? 1 : 0);
  const swipe = useSwipe({ revealW: acts * 88, enabled: acts > 0 });

  const subNode = sub != null && (typeof sub === "string" ? <Quiet s={sub} heat={heat} /> : sub);

  const inner =
    effForm === "headliner" ? (
      // THE HEADLINER PAYS RENT (Dave 2026-08-22, twice in one day: "why is
      // this rendering so large and with so much wasted space").
      //
      // The title still owns a full line, because that is the only thing
      // stopping a real task title ("Check on Bridge Admin Costs") from
      // truncating to "Check ..." beside its verb -- measured, 143px is all
      // a row leaves for fact plus sub next to a 13-character button. What
      // was wasted was the SUB sitting on a line of its own: it moves down
      // to ride beside the verb, which recovers a whole line. The lead also
      // gains the category tile, so it wears the same anatomy as the rows
      // under it instead of being the one notice with no icon at all.
      // 129px -> 85px, nothing truncated.
      <>
        <div className="notice-hl">
          <div className={"hl-tile " + (tone ?? "cat-fg-red").replace("cat-fg-", "cat-bg-")}>{icon}</div>
          <div className="row-grow"><div className="hl-title">{title}</div></div>
        </div>
        {((subNode && !subDropped) || action || alt || onOpen) && (
          <div className="hl-acts">
            {subNode && !subDropped && <span className="conn-meta hl-sub" ref={subRef}>{subNode}</span>}
            {(action || alt || onOpen) && (
              <span className="hl-verbs">
                {action && (
                  <button className="pill-act" onClick={(e) => { e.stopPropagation(); action.onClick(); }}>
                    {action.label}
                  </button>
                )}
                {alt && (
                  <button className="pill-act" onClick={(e) => { e.stopPropagation(); alt.onClick(); }}>
                    {alt.label}
                  </button>
                )}
                {!action && onOpen && <div className="chev" />}
              </span>
            )}
          </div>
        )}
        {foot}
      </>
    ) : effForm === "row" ? (
      <div
        className="row notice-vrow"
        role="button"
        tabIndex={0}
        onClick={() => { if (foot || alt) setExpanded(true); else if (onOpen) onOpen(); }}
      >
        <div className={"row-glyph " + (tone ?? "cat-fg-red")}>{icon}</div>
        <div className="row-grow vrow-line">
          <span className="conn-name vrow-fact" ref={factRef}>{title}</span>
          {subNode && !subDropped && <span className="conn-meta vrow-sub" ref={subRef}>{subNode}</span>}
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
          <div className={"row-glyph " + (tone ?? "cat-fg-red")}>{icon}</div>
          <div className="row-grow">
            <div className="conn-name">{title}</div>
            {subNode && <div className="conn-meta">{subNode}</div>}
          </div>
          {action ? (
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

  return (
    <div className="pad-x">
      <div className="notice-swipe">
        {altOnReveal && (
          <button
            className={"notice-alt" + (onDismiss ? " beside-dismiss" : "")}
            onClick={() => swipe.closeThen(altOnReveal.onClick)}
          >
            {altOnReveal.label}
          </button>
        )}
        {onDismiss && (
          <button className="notice-dismiss" onClick={() => swipe.closeThen(onDismiss)}>
            Dismiss
          </button>
        )}
        <div
          className={"card notice-card"
            + (effForm === "row" ? " notice-card-row" : "")
            + (uniform && effForm === "card" ? " notice-card-uniform" : "")
            /* A UNIFORM CARD IS TWO LINES TALL, and how it spends them is
               its own business. With a sub, that is one line each. WITHOUT
               one, the title takes both, which costs nothing: the card is
               the same height either way.
               Found by the page sweep, which measured "Run three times a
               week" losing 34% of itself to a clamp it did not need. Fixed
               height was the ask; throwing away words was not. */
            + (uniform && effForm === "card" && !subNode ? " notice-card-solo" : "")
            + (swipe.dragging ? " swiping" : "")}
          style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
          {...swipe.handlers}
        >
          {inner}
        </div>
      </div>
    </div>
  );
}
