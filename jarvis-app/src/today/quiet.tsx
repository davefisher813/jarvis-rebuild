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

// A datum, and the characters allowed to touch it.
//
// The pattern alone is not the rule. Any run of digits matched it, so an
// order number lit up inside "#D2565" and the 28 lit up inside "August 28th"
// on Dave's home screen: two pieces of prose wearing the app's data voice.
//
// The rule this MEANT is "a number standing alone is data", so the match has
// to be a whole token. A letter or digit immediately before it means we are
// inside an identifier; a letter immediately after means we are inside a word
// (an ordinal suffix, a unit we do not recognise). Neither is data.
//
// Deliberately no lookbehind: Safari only gained it in 16.4 and this ships to
// phones. The preceding character is checked in code instead.
const DATA = /(\d+\/\d+|\d+:\d+|\d+(?:\.\d+)?(?:[dhm]|min|%)?)/g;
const WORDY = /[A-Za-z0-9#]/;

export type Heat = "warm" | "hot" | null;

export function Quiet({ s, heat = null }: { s: string; heat?: Heat }) {
  // Walked rather than split, so each candidate can be judged against the
  // characters around it. Every character of `s` is emitted exactly once.
  const out: { text: string; data: boolean }[] = [];
  let last = 0;
  DATA.lastIndex = 0;
  for (let m = DATA.exec(s); m; m = DATA.exec(s)) {
    const start = m.index;
    const end = start + m[0].length;
    const before = start > 0 ? s[start - 1]! : "";
    const after = end < s.length ? s[end]! : "";
    // Inside an identifier, or carrying a suffix the pattern did not claim.
    if ((before && WORDY.test(before)) || (after && /[A-Za-z]/.test(after))) continue;
    if (start > last) out.push({ text: s.slice(last, start), data: false });
    out.push({ text: m[0], data: true });
    last = end;
  }
  if (!out.length) return <>{s}</>;
  if (last < s.length) out.push({ text: s.slice(last), data: false });
  return (
    <>
      {out.map((p, i) =>
        p.data
          ? <span key={i} className={"qd" + (heat ? " qd-" + heat : "")}>{p.text}</span>
          : <span key={i}>{p.text}</span>,
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
