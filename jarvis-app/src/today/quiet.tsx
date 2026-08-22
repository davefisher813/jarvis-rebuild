import type { ReactNode } from "react";

// THE QUIET LINE (approved 2026-08-22): words whisper, data pops.
//
// Words in a sub stay small and dim. Every piece of DATA -- counts, ages,
// fractions, times -- renders bright and tabular in the app's time face, so
// scanning for what matters means scanning for bright numbers instead of
// reading sentences. Units fuse to their figure the way the inbox already
// writes ages (59d, never "59 days"); producers write the fused form and
// this component only ever emphasizes, never rewords.
//
// Heat is the third voice and the rarest: amber for warming, red for hot,
// applied to the DATA ONLY, and only when the producer says so -- thresholds
// belong to domain code (the mail rungs, the slip counts), never to a
// presentation regex.

const DATA = /(\d+\/\d+|\d+:\d+|\d+(?:\.\d+)?(?:[dhm]|min|%)?)/g;

export type Heat = "warm" | "hot" | null;

export function Quiet({ s, heat = null }: { s: string; heat?: Heat }) {
  const parts = s.split(DATA);
  if (parts.length === 1) return <>{s}</>;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1
          ? <span key={i} className={"qd" + (heat ? " qd-" + heat : "")}>{p}</span>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}

// Some subs carry one datum that is hot while the rest stay plain (an age
// beside a count). Producers can pre-split into segments when that matters.
export function QuietParts({ parts }: { parts: { s: string; heat?: Heat }[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>{i > 0 && " · "}<Quiet s={p.s} heat={p.heat ?? null} /></span>
      ))}
    </>
  );
}

export type QuietSub = ReactNode;
