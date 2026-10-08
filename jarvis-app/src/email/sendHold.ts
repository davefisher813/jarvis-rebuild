// THE SEND HOLD (Email v1 spec 2026-10-08 section 9; Dave's locked decision 4, 2026-10-07).
//
// An approved message is held ON THE SERVER for 30 seconds before it can be sent. Undo inside that window cancels it and
// brings the draft back. The number lives here and in migration 0059 (interval '30 seconds'); a test pins that the two agree.
// No 5-second or 10-second window survives anywhere. The countdown the screen shows is derived from the SERVER's clock
// (hold_until minus server_now at the moment the answer arrived), never from the phone's: a wrong phone clock cannot make a
// message look cancelled or sent.

export const SEND_HOLD_MS = 30000;
/** After the hold, a worker has this long to claim it. Past it the send is cancelled (HOLD_EXPIRED), never sent late. */
export const DISPATCH_WINDOW_MS = 30000;

export interface HeldSend {
  hold_until: string;
  dispatch_deadline: string;
  /** The server's clock when it answered. */
  server_now: string;
}

/** Milliseconds of hold left, from the server's clock: the gap the server reported, less the time passed on THIS device since the answer arrived. */
export function holdRemainingMs(h: HeldSend, receivedAtDeviceMs: number, nowDeviceMs: number): number {
  const gap = Date.parse(h.hold_until) - Date.parse(h.server_now);
  if (!Number.isFinite(gap)) return 0;
  return Math.max(0, gap - Math.max(0, nowDeviceMs - receivedAtDeviceMs));
}

/** Whole seconds for the screen ("Waiting to send · 30s"): rounded up so it never shows 0s while the hold is still running. */
export const holdSeconds = (ms: number): number => Math.ceil(Math.max(0, ms) / 1000);
