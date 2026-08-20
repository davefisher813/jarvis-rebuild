import { capAfterNumber } from "../shared/casing";

// THE UNSUBSCRIBE SWEEP (N9, Dave 2026-08-20).
//
// The self-cleaning inbox already notices when a sender has been thrown away
// unread several times and offers to file them. This is the batch version,
// and it does the better thing: filing HIDES mail, unsubscribing ENDS it.
//
// Laws:
//   - Only senders he has already thrown away, repeatedly, by hand. This
//     never guesses that he might not want something.
//   - Only senders who published a List-Unsubscribe header, because that is
//     the sender's own machine-readable "here is how to stop". Everyone else
//     is offered as a filing rule instead, honestly labelled.
//   - NEVER CLAIMS IT WORKED. "Asked them to stop" is the truth; some senders
//     ignore it, and a false receipt is worse than no receipt.
//   - Asked once per sender, whatever the answer.

export interface SweepCandidate {
  sender: string;      // lowercased email
  name: string;        // display name
  tossed: number;      // times archived unread by hand
  canUnsub: boolean;   // a usable List-Unsubscribe exists
}

export const SWEEP_MIN = 3;
export const SWEEP_MAX = 6;

export function sweepCandidates(
  tossed: Record<string, number>,
  asked: string[],
  names: Record<string, string>,
  unsubbable: string[],
  min = SWEEP_MIN,
): SweepCandidate[] {
  const seen = new Set(asked.map((a) => a.toLowerCase()));
  const can = new Set(unsubbable.map((u) => u.toLowerCase()));
  return Object.entries(tossed)
    .filter(([sender, n]) => n >= min && !seen.has(sender.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, SWEEP_MAX)
    .map(([sender, n]) => ({
      sender: sender.toLowerCase(),
      name: names[sender] || sender,
      tossed: n,
      canUnsub: can.has(sender.toLowerCase()),
    }));
}

export function sweepTitle(list: SweepCandidate[]): string {
  const total = list.reduce((n, c) => n + c.tossed, 0);
  return capAfterNumber(`${total} thrown away without opening`);
}

export function sweepSub(list: SweepCandidate[]): string {
  const unsub = list.filter((c) => c.canUnsub).length;
  if (unsub === list.length) return `End all ${list.length}?`;
  if (unsub === 0) return `File all ${list.length} to Noise?`;
  return `End ${unsub}, file the rest?`;
}

// The receipt. Two verbs, because two different things happened, and lying
// about which is which is how someone keeps getting mail they were told had
// stopped.
export function sweepReceipt(ended: number, filed: number): string {
  const bits: string[] = [];
  if (ended > 0) bits.push(ended === 1 ? "Asked 1 sender to stop" : `Asked ${ended} senders to stop`);
  if (filed > 0) bits.push(filed === 1 ? "filed 1 to Noise" : `filed ${filed} to Noise`);
  return bits.join(" · ") || "Nothing changed";
}
