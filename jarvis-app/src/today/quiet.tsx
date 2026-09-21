
// THE QUIET LINE (approved 2026-08-22): words whisper, data pops.
//
// Words in a sub stay small and dim. Every piece of DATA -- counts, ages,
// fractions, times -- renders bright and tabular in the app's time face, so
// scanning for what matters means scanning for bright numbers instead of
// reading sentences. Units fuse to their figure the way the inbox already
// writes ages (59d, never "59 days"); producers write the fused form and
// this component only ever emphasizes, never rewords.
//
// HEAT IS A COUNT OF DAYS, AND IT IS RED (Dave 2026-09-21, on two rows of
// one card: "One is red. The other isn't. They should both be red and all
// instances. We need everything uniform without drifting").
//
// It used to be the producer's call, on the producer's own thresholds: the
// mail nudge lit its age amber at seven days and red at twenty-one, and a
// notice that was not a nudge got nothing at all. So "Invoice · 84 Days" was
// red while "Mailchimp trial ends, 3 days left" -- the same datum, in the
// same card, one row apart -- was not, and a third rung made the same kind of
// number amber somewhere else. Three appearances of one thing.
//
// A day count is now hot wherever it appears, and nothing else is. It is a
// rule about the SHAPE of the datum, which is the only kind of rule that can
// hold across a producer that writes its own sentence (a reply's gist is
// model-written; no threshold in domain code can reach inside it).

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

/** A number that counts days: the fused form (3d) or a figure with the word
 *  after it (84 Days, 3 days left). Never 20m, 9h, 8/10 or a clock. */
function isDayCount(token: string, after: string): boolean {
  if (/^\d+d$/i.test(token)) return true;
  return /^\d+$/.test(token) && /^\s*days?\b/i.test(after);
}

export function Quiet({ s }: { s: string }) {
  // Walked rather than split, so each candidate can be judged against the
  // characters around it. Every character of `s` is emitted exactly once.
  const out: { text: string; data: boolean; hot?: boolean }[] = [];
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
    out.push({ text: m[0], data: true, hot: isDayCount(m[0], s.slice(end)) });
    last = end;
  }
  if (!out.length) return <>{s}</>;
  if (last < s.length) out.push({ text: s.slice(last), data: false });
  return (
    <>
      {out.map((p, i) =>
        p.data
          ? <span key={i} className={"qd" + (p.hot ? " qd-hot" : "")}>{p.text}</span>
          : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}

// TODAY-F-18 (2026-09-05): QuietParts and the QuietSub alias both went. No
// producer ever pre-split a sub into heated segments; Quiet above finds the
// datum in the sentence itself, which is why nothing needed to.
