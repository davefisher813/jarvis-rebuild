// @vitest-environment jsdom
// THE REBUILT RECONNECT TAP, as the Email screen drives it (Foundation Fix Spec 4): the matrix of how a reconnect can end,
// what each ending says (or, for a closed window, does not), and what a killed app says when it reopens.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useReconnect, type ReconnectDeps } from "./useReconnect";
import ConnectionBanner from "./ConnectionBanner";
import { ReconnectCancelled, ReconnectDenied, ReconnectOutcomeError, writePending, readPending } from "../connections/google/reconnect";

const DAVE = "dave@gmail.com";
const deps = (o: Partial<ReconnectDeps> = {}): ReconnectDeps => ({
  token: "jwt", reconnect: vi.fn(async () => ({})), knownEmails: [DAVE], refreshStatus: vi.fn(async () => {}), catchUp: vi.fn(async () => {}), fallback: vi.fn(), ...o,
});
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the tap", () => {
  it("reconnects the exact account, then re-reads the status, catches up, and re-reads again: restored first, up to date only after", async () => {
    const order: string[] = [];
    const d = deps({
      reconnect: vi.fn(async (e: string) => { order.push("reconnect:" + e); }),
      refreshStatus: vi.fn(async () => { order.push("status"); }),
      catchUp: vi.fn(async () => { order.push("catchUp"); }),
    });
    const { result } = renderHook(() => useReconnect(d));
    await act(async () => { await result.current.start(DAVE); });
    expect(order).toEqual(["reconnect:" + DAVE, "status", "catchUp", "status"]);
    expect(result.current.outcome).toBeNull();
    expect(result.current.busy).toBeNull();
  });

  it("with no Google session in this build it goes where it always went", async () => {
    const d = deps({ reconnect: null });
    const { result } = renderHook(() => useReconnect(d));
    await act(async () => { await result.current.start(DAVE); });
    expect(d.fallback).toHaveBeenCalled();
  });

  it("MATRIX: consent closed without completing is SILENT: no outcome, no error, nothing to dismiss, and no catch-up", async () => {
    const d = deps({ reconnect: vi.fn(async () => { throw new ReconnectCancelled(); }) });
    const { result } = renderHook(() => useReconnect(d));
    await act(async () => { await result.current.start(DAVE); });
    expect(result.current.outcome).toBeNull();
    expect(d.catchUp).not.toHaveBeenCalled();
    expect(d.refreshStatus).not.toHaveBeenCalled();
  });

  it("MATRIX: Google denying the flow surfaces Google's reason", async () => {
    const d = deps({ reconnect: vi.fn(async () => { throw new ReconnectDenied("admin_policy_enforced"); }) });
    const { result } = renderHook(() => useReconnect(d));
    await act(async () => { await result.current.start(DAVE); });
    expect(result.current.outcome).toMatchObject({ status: "denied", copy: { title: "Google Did Not Allow It", lines: ["Google said your administrator blocks this app."] } });
    expect(d.catchUp).not.toHaveBeenCalled();
  });

  it("MATRIX: the wrong Google account says who was selected and who is being reconnected, and catches nothing up", async () => {
    const d = deps({ reconnect: vi.fn(async () => { throw new ReconnectOutcomeError("wrong_account", DAVE, { selected: "other@gmail.com" }); }) });
    const { result } = renderHook(() => useReconnect(d));
    await act(async () => { await result.current.start(DAVE); });
    expect(result.current.outcome!.copy.lines).toEqual(["You selected other@gmail.com.", `JARVIS is reconnecting ${DAVE}.`]);
    expect(d.catchUp).not.toHaveBeenCalled();
    // The screen's own view of the account is re-read, never assumed.
    expect(d.refreshStatus).toHaveBeenCalledWith(true);
  });

  it("no way to renew: Finish Reconnecting and Not Now once, and the second time the loop ends with Google's permissions page", async () => {
    const d = deps({ reconnect: vi.fn(async () => { throw new ReconnectOutcomeError("needs_step", DAVE); }) });
    const { result } = renderHook(() => useReconnect(d));
    await act(async () => { await result.current.start(DAVE); });
    expect(result.current.outcome!.copy.actions).toEqual(["finish", "not_now"]);
    await act(async () => { result.current.act("finish"); });
    await waitFor(() => expect(d.reconnect).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.outcome!.copy.actions).toEqual(["permissions", "not_now"]));
    expect(result.current.outcome!.copy.actions).not.toContain("finish");
  });

  it("Not Now puts it away, Try Again starts a fresh attempt, and a second tap while one is open is refused by the button being disabled", async () => {
    const d = deps({ reconnect: vi.fn(async () => { throw new ReconnectOutcomeError("unverified", DAVE, { retryable: true }); }) });
    const { result } = renderHook(() => useReconnect(d));
    await act(async () => { await result.current.start(DAVE); });
    await act(async () => { result.current.act("not_now"); });
    expect(result.current.outcome).toBeNull();
    await act(async () => { await result.current.start(DAVE); });
    await act(async () => { result.current.act("retry"); });
    await waitFor(() => expect(d.reconnect).toHaveBeenCalledTimes(3));
  });
});

describe("a killed app, on reopen", () => {
  const server = (status: string) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status }) })));

  it("asks the server, says it is checking, and then says the honest thing: not completed, drafts saved, never green", async () => {
    server("started");
    writePending(DAVE);
    const d = deps();
    const { result } = renderHook(() => useReconnect(d));
    expect(result.current.checking).toBe(true);
    await waitFor(() => expect(result.current.outcome).not.toBeNull());
    expect(result.current.checking).toBe(false);
    expect(result.current.outcome!.copy).toMatchObject({ title: "Reconnect Wasn't Completed", lines: ["Your drafts are saved."] });
    // No duplicate flow: Google is never opened on its own, and the note is used up.
    expect(d.reconnect).not.toHaveBeenCalled();
    expect(readPending()).toBeNull();
  });

  it("if the server says it DID complete, it restores: status, catch-up, status", async () => {
    server("verified");
    writePending(DAVE);
    const d = deps();
    renderHook(() => useReconnect(d));
    await waitFor(() => expect(d.catchUp).toHaveBeenCalledTimes(1));
    expect(d.refreshStatus).toHaveBeenCalledTimes(2);
  });

  it("a note about an account that is gone is dropped without a word", async () => {
    server("started");
    writePending("gone@gmail.com");
    const d = deps();
    const { result } = renderHook(() => useReconnect(d));
    expect(result.current.checking).toBe(false);
    expect(readPending()).toBeNull();
  });

  it("with nothing pending it asks nothing", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    renderHook(() => useReconnect(deps()));
    expect(f).not.toHaveBeenCalled();
  });

  it("offline on reopen: it says it was not completed rather than guessing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    writePending(DAVE);
    const { result } = renderHook(() => useReconnect(deps()));
    await waitFor(() => expect(result.current.outcome?.status).toBe("interrupted"));
  });
});

describe("the banner draws it", () => {
  const model = { incidentId: "JC-1", email: DAVE, kind: "auth" as const, title: "Gmail Needs Reconnecting", address: DAVE, lines: ["Mail last updated Oct 6 at 8:12 PM.", "New mail may be missing."] as [string, string], paused: null, reconnect: true, strip: false };

  it("the button names the exact account, and is disabled while one reconnect is open", () => {
    const onReconnect = vi.fn();
    const { rerender } = render(<ConnectionBanner models={[model]} notes={[]} onReconnect={onReconnect} onAcknowledge={() => {}} onSeen={() => {}} />);
    fireEvent.click(screen.getByText(`Reconnect ${DAVE}`));
    expect(onReconnect).toHaveBeenCalledWith(DAVE);
    rerender(<ConnectionBanner models={[model]} notes={[]} onReconnect={onReconnect} busyEmail={DAVE} onAcknowledge={() => {}} onSeen={() => {}} />);
    expect(screen.getByText("Connecting")).toBeDisabled();
  });

  it("the wrong-account card is three short lines with Try Again and Not Now, and the red banner stays above it", () => {
    const onOutcomeAction = vi.fn();
    render(<ConnectionBanner models={[model]} notes={[]} onReconnect={() => {}} onAcknowledge={() => {}} onSeen={() => {}} onOutcomeAction={onOutcomeAction}
      outcome={{ email: DAVE, status: "wrong_account", copy: { title: "That's a Different Google Account", lines: ["You selected other@gmail.com.", `JARVIS is reconnecting ${DAVE}.`], actions: ["retry", "not_now"] } }} />);
    expect(screen.getByText("That's a Different Google Account")).toBeInTheDocument();
    expect(screen.getByText("You selected other@gmail.com.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("conn-banner");
    fireEvent.click(screen.getByText("Not Now"));
    expect(onOutcomeAction).toHaveBeenCalledWith("not_now");
  });

  it("one more step offers exactly Finish Reconnecting and Not Now", () => {
    render(<ConnectionBanner models={[model]} notes={[]} onReconnect={() => {}} onAcknowledge={() => {}} onSeen={() => {}}
      outcome={{ email: DAVE, status: "needs_step", copy: { title: "Reconnect Needs One More Step", lines: ["Google allowed access now.", "JARVIS cannot renew it automatically."], actions: ["finish", "not_now"] } }} />);
    const outcome = screen.getByText("Reconnect Needs One More Step").closest(".conn-outcome")!;
    expect([...outcome.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Finish Reconnecting", "Not Now"]);
  });

  it("checking shows the one line, with no green anywhere", () => {
    render(<ConnectionBanner models={[model]} notes={[]} onReconnect={() => {}} onAcknowledge={() => {}} onSeen={() => {}} checking />);
    expect(screen.getByText("Checking Your Gmail Connection...")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/up to date|restored/i);
  });
});
