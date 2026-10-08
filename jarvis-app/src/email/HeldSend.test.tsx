// @vitest-environment jsdom
// THE HELD SEND, FROM THE SCREEN (Email v1 spec section 9; Dave's locked decision 4; AC27 to AC30, AC62). The real hook and
// screen run against a fake database that answers as the server would. What these hold: the countdown comes from the
// SERVER's clock; Undo is the server's answer, not the screen's guess; a lost race says so and does not pretend; offline
// Undo is "not confirmed", never a false cancel; the screen announces states, not seconds; a send that settles or comes
// back hands over to the screen that fits.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import HeldSendView from "./HeldSendView";
import { phaseOf } from "./useHeldSend";
import type { HoldStatus } from "./drafts";
import type { RpcClient } from "../substrate/commands/errors";
import { HELD_TITLE, NOT_SENT_YET, PREPARING_LINE, SENDING_LINE, UNDO_SEND, UNDO_TOO_LATE, UNDO_UNCONFIRMED } from "./copy";

const ACT = "act-1";
const status = (o: Partial<HoldStatus> = {}): HoldStatus => ({ action_id: ACT, state: "queued", error_code: null, hold_until: "2026-10-08T12:00:30.000Z", dispatch_deadline: "2026-10-08T12:01:00.000Z", server_now: "2026-10-08T12:00:00.000Z", draft_id: "d-1", draft_state: "sending", provider_message_id: null, ...o });
const HELD = { hold_until: "2026-10-08T12:00:30.000Z", dispatch_deadline: "2026-10-08T12:01:00.000Z", server_now: "2026-10-08T12:00:00.000Z" };

interface Rig { client: RpcClient; calls: string[]; setStatus: (s: HoldStatus) => void; cancelAnswer: { state: string } | { error: string } }
function rig(): Rig {
  let current = status();
  const r: Rig = { calls: [], cancelAnswer: { state: "cancelled" }, setStatus: (s) => { current = s; }, client: null as unknown as RpcClient };
  r.client = { rpc: async (fn: string) => {
    r.calls.push(fn);
    if (fn === "send_hold_status") return { data: current, error: null };
    if (fn === "command_cancel") {
      if ("state" in r.cancelAnswer && r.cancelAnswer.state === "cancelled") current = status({ state: "cancelled", error_code: "CANCELLED", draft_state: "draft" });
      return { data: r.cancelAnswer, error: null };
    }
    return { data: { error: "NOT_FOUND" }, error: null };
  } };
  return r;
}

let t0 = 1_000_000;
const mount = (r: Rig, o: { offline?: boolean; onEnd?: (p: string, s: HoldStatus) => void } = {}) =>
  render(<HeldSendView client={r.client} actionId={ACT} held={HELD} receivedAt={t0} offline={o.offline ?? false} subject="Re: Transcript" from="dave@example.test" recipients={["coach@example.test", "me@example.test"]} onEnd={o.onEnd ?? (() => {})} onBack={() => {}} />);
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); }); };

beforeEach(() => { vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(t0); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("phaseOf", () => {
  it("maps the server's state and the hold left to one phase", () => {
    expect(phaseOf(status(), 12000)).toBe("held");
    expect(phaseOf(status(), 0)).toBe("preparing");
    expect(phaseOf(status({ state: "claimed" }), 0)).toBe("sending");
    expect(phaseOf(status({ state: "dispatched" }), 0)).toBe("sending");
    expect(phaseOf(status({ state: "confirmed" }), 0)).toBe("settled");
    expect(phaseOf(status({ state: "outcome_unknown" }), 0)).toBe("settled");
    expect(phaseOf(status({ state: "failed" }), 0)).toBe("settled");
    expect(phaseOf(status({ state: "cancelled" }), 0)).toBe("returned");
  });
});

describe("Waiting to Send", () => {
  it("says Not Sent Yet and counts down the SERVER's 30 seconds, then Preparing to Send at zero while the command is still queued", async () => {
    const r = rig();
    mount(r);
    expect(screen.getAllByText(HELD_TITLE).length).toBeGreaterThan(0);
    expect(screen.getByText(NOT_SENT_YET)).toBeInTheDocument();
    expect(screen.getByText("30s")).toBeInTheDocument();
    await tick(12000);
    expect(screen.getByText("18s")).toBeInTheDocument();
    await tick(18500);
    expect(screen.getByText(PREPARING_LINE)).toBeInTheDocument();
    expect(screen.queryByText(/\ds$/)).toBeNull();
    // Undo is still on offer: it wins until a worker has claimed.
    expect(screen.getByRole("button", { name: UNDO_SEND })).toBeEnabled();
  });

  it("shows the message exactly as approved: subject, From and every recipient", () => {
    mount(rig());
    expect(screen.getByText("Re: Transcript")).toBeInTheDocument();
    expect(screen.getByText("dave@example.test")).toBeInTheDocument();
    expect(screen.getByText("coach@example.test, me@example.test")).toBeInTheDocument();
  });

  it("Undo is the server's compare-and-set: cancelled hands the draft back (zero sends)", async () => {
    const r = rig();
    const onEnd = vi.fn();
    mount(r, { onEnd });
    await tick(3000);
    fireEvent.click(screen.getByRole("button", { name: UNDO_SEND }));
    await tick(10);
    await tick(10);
    expect(r.calls).toContain("command_cancel");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0]![0]).toBe("returned");
    expect(onEnd.mock.calls[0]![1].state).toBe("cancelled");
  });

  it("Undo that loses the race says Already Sending, disables itself, and never claims a cancel", async () => {
    const r = rig();
    r.cancelAnswer = { state: "cancellation_requested" };
    const onEnd = vi.fn();
    mount(r, { onEnd });
    await tick(31000);
    fireEvent.click(screen.getByRole("button", { name: UNDO_SEND }));
    await tick(10);
    expect(screen.getByText(UNDO_TOO_LATE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: UNDO_SEND })).toBeDisabled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("a worker claiming it shows Sending with Undo shut, and a settled outcome hands over", async () => {
    const r = rig();
    const onEnd = vi.fn();
    mount(r, { onEnd });
    r.setStatus(status({ state: "claimed" }));
    await tick(2100);
    expect(screen.getAllByText(SENDING_LINE).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: UNDO_SEND })).toBeDisabled();
    r.setStatus(status({ state: "confirmed", draft_state: "sent", provider_message_id: "gm-1" }));
    await tick(2100);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0]![0]).toBe("settled");
    await tick(6000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("a send the deadline caught comes back as returned (never sent late)", async () => {
    const r = rig();
    const onEnd = vi.fn();
    mount(r, { onEnd });
    r.setStatus(status({ state: "cancelled", error_code: "HOLD_EXPIRED", draft_state: "draft" }));
    await tick(2100);
    expect(onEnd).toHaveBeenCalledWith("returned", expect.objectContaining({ error_code: "HOLD_EXPIRED" }));
  });

  it("offline, Undo says it is not confirmed and does not ask the server (AC30)", async () => {
    const r = rig();
    mount(r, { offline: true });
    fireEvent.click(screen.getByRole("button", { name: UNDO_SEND }));
    await tick(10);
    expect(screen.getByText(UNDO_UNCONFIRMED)).toBeInTheDocument();
    expect(r.calls).not.toContain("command_cancel");
    expect(r.calls).not.toContain("send_hold_status");
  });

  it("announces states, not seconds: the timer region is not live and the seconds never enter a live region", async () => {
    mount(rig());
    const timer = screen.getByRole("timer");
    expect(timer).toHaveAttribute("aria-live", "off");
    await tick(5000);
    expect(document.querySelectorAll('[aria-live="polite"]').length).toBe(0);
  });

  it("a failed status read changes nothing but a quiet note: no invented outcome", async () => {
    const r = rig();
    const onEnd = vi.fn();
    r.client = { rpc: async (fn: string) => (fn === "send_hold_status" ? { data: null, error: { message: "net" } } : { data: {}, error: null }) };
    mount(r, { onEnd });
    await tick(4100);
    expect(onEnd).not.toHaveBeenCalled();
    expect(screen.getAllByText(HELD_TITLE).length).toBeGreaterThan(0);
  });
});
