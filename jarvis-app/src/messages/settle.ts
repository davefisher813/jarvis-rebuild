// COUNT WHAT LANDED, NOT WHAT YOU TRIED (Dave 2026-08-25, from the email
// audit).
//
// Six separate places in this module ran a batch of Gmail writes like this:
//
//     for (const r of hit) apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]).catch(() => {});
//     say(hit.length + " conversations archived");
//
// Every failure is swallowed by the empty catch, and the number in the receipt
// is the size of the batch. So "6 conversations archived" is a statement about
// a loop that ran, not about mail that moved, and the six come back on the next
// load. Two of those sites feed the day's cleared count, which this app's own
// copy describes as "counted, never estimated".
//
// The correct shape already existed for ONE row: archiveRow un-hides the row
// and says "Couldn't archive · Still in inbox". It never got generalised, so
// every batch operation written after it repeated the bug. This is that shape,
// written once.
//
// Three rules:
//   1. It never throws. A batch is a best-effort thing; the caller's job is to
//      report honestly, not to handle an exception.
//   2. A missing client counts as FAILED, not as skipped. `apiFor` returns
//      undefined for an account that is no longer connected, and `?.` made
//      that indistinguishable from success at every call site.
//   3. It returns the items, not counts, so the caller can put the failed rows
//      back exactly where they were.

export interface Settled<T> {
  ok: T[];
  failed: T[];
}

export async function settleAll<T>(
  items: readonly T[],
  run: (item: T) => Promise<unknown> | undefined | null,
): Promise<Settled<T>> {
  const results = await Promise.all(items.map(async (item) => {
    try {
      const p = run(item);
      // Rule 2: nothing to await means nothing was sent.
      if (!p) return { item, ok: false };
      await p;
      return { item, ok: true };
    } catch {
      return { item, ok: false };
    }
  }));
  return {
    ok: results.filter((r) => r.ok).map((r) => r.item),
    failed: results.filter((r) => !r.ok).map((r) => r.item),
  };
}

/**
 * The receipt for a partly-successful batch.
 *
 * `past` is the verb as it reads when it worked ("archived"), `stuck` is what
 * is true of the ones that did not ("still in your inbox"). Singular and
 * plural of the noun are both passed because English, and because "1
 * conversations archived" is the kind of thing that makes a person stop
 * trusting the number.
 *
 * Nothing here says "some" or "partially". A number he can check beats a hedge
 * he cannot.
 */
export interface SettleWords {
  one: string;        // "conversation"
  many: string;       // "conversations"
  did: string;        // "archived"      -- what happened to the ones that worked
  doing: string;      // "archive"       -- for the nothing-worked case
  stuck: string;      // "still in your inbox"
}

export function settleLine(okN: number, failedN: number, w: SettleWords): string {
  const noun = (n: number) => n + " " + (n === 1 ? w.one : w.many);
  // Both verb forms are passed rather than derived. A first cut built the
  // present tense by stripping "ed" off the past, which turns "archived" into
  // "archiv". English does not deserve a regex.
  if (okN === 0) return "Couldn't " + w.doing + " " + (failedN === 1 ? "it" : "those") + " · " + capitalize(w.stuck);
  if (failedN === 0) return noun(okN) + " " + w.did;
  return noun(okN) + " " + w.did + " · " + failedN + " " + w.stuck;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
