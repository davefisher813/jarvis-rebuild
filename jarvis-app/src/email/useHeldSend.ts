// THE HELD SEND, FROM THE SCREEN'S SIDE (Email v1 spec section 9; Dave's locked decision 4).
//
// An approved message waits on the server for 30 seconds. This hook is the screen's view of that wait: it shows the
// countdown from the SERVER's clock (sendHold.ts), asks the server what the command is doing every couple of seconds, and
// turns the answer into one phase the screen draws. It never decides anything itself: Undo is the server's compare-and-set
// (command_cancel), and the outcome is whatever the server says it is. Closing the screen does not stop a held send.
//
//   held        inside the 30 seconds, Undo is on offer
//   preparing   the countdown is at zero and no worker has claimed it yet; Undo still wins until one does
//   sending     a worker has it; Undo has lost and says so
//   settled     Gmail accepted it, refused it, or the outcome is unknown: the outcome screen takes over
//   returned    it came back to the draft (Undo won, or the deadline passed and it was never sent late)

import { useCallback, useEffect, useRef, useState } from "react";
import { cancelCommand } from "../substrate/commands/sends";
import { lineFor, type CommandFailure, type RpcClient } from "../substrate/commands/errors";
import { holdStatus, type HoldStatus } from "./drafts";
import { holdRemainingMs, holdSeconds, type HeldSend } from "./sendHold";
import { UNDO_TOO_LATE, UNDO_UNCONFIRMED } from "./copy";

export type HoldPhase = "held" | "preparing" | "sending" | "settled" | "returned";

export interface HeldState {
  phase: HoldPhase;
  /** Whole seconds left in the hold (0 once it has passed). */
  seconds: number;
  /** A line about the last Undo or the last status read, for the screen's quiet note. */
  note: string | null;
  /** The server's last word on the command, for the screen that takes over. */
  status: HoldStatus | null;
  undoing: boolean;
}

/** The phase a server status means, given the hold still to run. Pure, so the maths is held by tests. */
export function phaseOf(status: HoldStatus, remainingMs: number): HoldPhase {
  switch (status.state) {
    case "queued":
    case "reviewed":
      return remainingMs > 0 ? "held" : "preparing";
    case "claimed":
    case "dispatched":
      return "sending";
    case "cancelled":
      return "returned";
    default:
      return "settled";
  }
}

export function useHeldSend(opts: {
  client: RpcClient;
  actionId: string;
  held: HeldSend;
  /** The device clock at the moment the held answer arrived. */
  receivedAt: number;
  offline: boolean;
  now?: () => number;
  pollMs?: number;
  /** Called once when the server says the command has left the hold for good, with its last status. */
  onEnd: (phase: "settled" | "returned", status: HoldStatus) => void;
}): HeldState & { undo: () => void } {
  const { client, actionId, held, receivedAt, offline, onEnd } = opts;
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? 2000;
  const [state, setState] = useState<HeldState>({ phase: "held", seconds: holdSeconds(holdRemainingMs(held, receivedAt, now())), note: null, status: null, undoing: false });
  const ended = useRef(false);
  const statusRef = useRef<HoldStatus | null>(null);
  /** Undo asked and the server said a worker already has it: from then on the screen is Sending, whatever a read lags to say. */
  const lostRace = useRef(false);
  const finish = useCallback((phase: "settled" | "returned", status: HoldStatus) => {
    if (ended.current) return;
    ended.current = true;
    onEnd(phase, status);
  }, [onEnd]);

  // The countdown: a display tick, derived from the server's times. It only changes the number and the held/preparing split.
  useEffect(() => {
    const t = setInterval(() => {
      const rem = holdRemainingMs(held, receivedAt, now());
      setState((s) => {
        const seconds = holdSeconds(rem);
        const phase: HoldPhase = s.phase === "held" || s.phase === "preparing" ? (rem > 0 ? "held" : "preparing") : s.phase;
        return seconds === s.seconds && phase === s.phase ? s : { ...s, seconds, phase };
      });
    }, 500);
    return () => clearInterval(t);
  }, [held, receivedAt, now]);

  // The truth: ask the server. A failed read changes nothing on screen except a quiet note; it never invents an outcome.
  const poll = useCallback(async () => {
    if (ended.current || offline) return;
    const r = await holdStatus(client, actionId);
    if (ended.current) return;
    if (!r.ok) { setState((s) => ({ ...s, note: lineFor(r) })); return; }
    statusRef.current = r.value;
    const rem = holdRemainingMs(held, receivedAt, now());
    const read = phaseOf(r.value, rem);
    const phase: HoldPhase = lostRace.current && (read === "held" || read === "preparing") ? "sending" : read;
    setState((s) => ({ ...s, phase, status: r.value, note: s.note === UNDO_UNCONFIRMED ? null : s.note }));
    if (phase === "settled" || phase === "returned") finish(phase, r.value);
  }, [client, actionId, held, receivedAt, offline, now, finish]);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), pollMs);
    return () => clearInterval(t);
  }, [poll, pollMs]);

  const undo = useCallback(() => {
    if (ended.current) return;
    if (offline) { setState((s) => ({ ...s, note: UNDO_UNCONFIRMED })); return; }
    setState((s) => ({ ...s, undoing: true, note: null }));
    void (async () => {
      const r = await cancelCommand(client, actionId);
      if (!r.ok) {
        const f: CommandFailure = r;
        setState((s) => ({ ...s, undoing: false, note: f.code === "OFFLINE" || f.code === "UNAVAILABLE" ? UNDO_UNCONFIRMED : lineFor(f) }));
        return;
      }
      if (r.value.state === "cancelled") {
        const st = await holdStatus(client, actionId);
        const status: HoldStatus = st.ok ? st.value : { action_id: actionId, state: "cancelled", error_code: "CANCELLED", hold_until: null, dispatch_deadline: null, server_now: new Date(now()).toISOString(), draft_id: null, draft_state: "draft", provider_message_id: null };
        setState((s) => ({ ...s, phase: "returned", undoing: false, status }));
        finish("returned", status);
        return;
      }
      // cancellation_requested: a worker already has it. Undo lost; the outcome decides and the screen says so.
      lostRace.current = true;
      setState((s) => ({ ...s, phase: "sending", undoing: false, note: UNDO_TOO_LATE }));
      void poll();
    })();
  }, [client, actionId, offline, now, finish, poll]);

  return { ...state, undo };
}
