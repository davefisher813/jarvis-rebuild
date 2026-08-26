// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../../data/NotesProvider";
import { GoogleSessionProvider, useGoogle } from "./GoogleSession";
import { makeFakeGoogleApi } from "./fakeApi";
import type { TokenOpts } from "./gis";

// Multi-account session: tokens keyed by whoever ACTUALLY authorized (Google's
// answer, not our request), feature filters, and per-account disconnect.

function Probe() {
  const g = useGoogle();
  return (
    <div>
      <button onClick={() => void g.addAccount()}>add</button>
      <button onClick={() => void g.disconnect("a@x.com")}>drop-a</button>
      <button onClick={() => void g.setFeature("b@x.com", "mail", false)}>b-mail-off</button>
      <div data-testid="accounts">{g.accounts.map((a) => a.email).join(",")}</div>
      <div data-testid="mail-apis">{g.apis("mail").map((x) => x.email).join(",")}</div>
      <div data-testid="cal-apis">{g.apis("cal").map((x) => x.email).join(",")}</div>
      <div data-testid="has">{String(g.hasToken)}</div>
    </div>
  );
}

function setup() {
  // Token n belongs to account n: tok1 -> a@x.com, tok2 -> b@x.com.
  let n = 0;
  const requestToken = async (_opts?: TokenOpts) => "tok" + ++n;
  const makeApi = (t: string) => makeFakeGoogleApi({
    getProfile: async () => ({ emailAddress: t === "tok1" ? "A@x.com" : "b@x.com" }),
  });
  render(
    <NotesProvider userId="u1">
      <GoogleSessionProvider requestToken={requestToken} makeApi={makeApi}><Probe /></GoogleSessionProvider>
    </NotesProvider>,
  );
}

describe("GoogleSession multi-account", () => {
  it("adds accounts under their REAL address (lowercased), both usable at once", async () => {
    setup();
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent("a@x.com"));
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent("a@x.com,b@x.com"));
    expect(screen.getByTestId("mail-apis")).toHaveTextContent("a@x.com,b@x.com");
    expect(screen.getByTestId("has")).toHaveTextContent("true");
  });

  it("feature toggles filter apis(); disconnecting one account keeps the other", async () => {
    setup();
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent("a@x.com"));
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent("b@x.com"));

    fireEvent.click(screen.getByText("b-mail-off"));
    await waitFor(() => expect(screen.getByTestId("mail-apis")).toHaveTextContent(/^a@x.com$/));
    expect(screen.getByTestId("cal-apis")).toHaveTextContent("a@x.com,b@x.com"); // cal untouched

    fireEvent.click(screen.getByText("drop-a"));
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent(/^b@x.com$/));
    expect(screen.getByTestId("cal-apis")).toHaveTextContent(/^b@x.com$/);
    expect(screen.getByTestId("has")).toHaveTextContent("true"); // b's token survives a's disconnect
  });
});

// THE SCOPE GATE (2026-08-26, born from "deleting literally doesn't work").
// A refresh token keeps minting access tokens with the scopes it was BORN
// with, whatever config.ts says today. These tests hold the two halves of
// the repair: silent minting refuses accounts whose stamped scopes are not
// current, and every interactive authorize stamps the current scopes.
import { GOOGLE_SCOPES } from "./config";
import type { TokenBroker } from "./broker";
import { useProfile } from "../../data/NotesProvider";
import { useEffect, useState } from "react";

// The seed must land BEFORE the session provider mounts, because the
// provider reads the profile once at mount: seeding after (the first draft
// of this test) left the session with an empty account list forever.
function GateHost({ seed, broker }: { seed: { email: string; mail: boolean; cal: boolean; scopes?: string }[]; broker: TokenBroker }) {
  const profile = useProfile();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => { void profile.save({ googleAccounts: seed }).then(() => setSeeded(true)); }, [profile, seed]);
  if (!seeded) return null;
  return (
    <GoogleSessionProvider broker={broker} makeApi={() => makeFakeGoogleApi({ getProfile: async () => ({ emailAddress: "old@x.com" }) })}>
      <GateInner />
    </GoogleSessionProvider>
  );
}
function GateInner() {
  const g = useGoogle();
  return (
    <div>
      <button onClick={() => void g.reconnect("old@x.com")}>reconnect-old</button>
      <div data-testid="tokened">{g.tokenEmails.join(",")}</div>
      <div data-testid="scopes">{g.accounts.map((a) => a.email + ":" + (a.scopes === GOOGLE_SCOPES ? "current" : "stale")).join(",")}</div>
    </div>
  );
}

function gateSetup(seed: { email: string; mail: boolean; cal: boolean; scopes?: string }[], broker: TokenBroker) {
  render(
    <NotesProvider userId={"gate-" + Math.random()}>
      <GateHost seed={seed} broker={broker} />
    </NotesProvider>,
  );
}

describe("the scope gate", () => {
  it("silent minting refuses an account stamped with older scopes", async () => {
    const silentCalls: string[] = [];
    gateSetup(
      [
        { email: "old@x.com", mail: true, cal: true }, // pre-stamp era: readonly
        { email: "new@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES },
      ],
      {
        authorize: async () => ({ token: "t-int", email: "old@x.com" }),
        silent: async (email) => { silentCalls.push(email); return "t-" + email; },
      },
    );
    await waitFor(() => expect(screen.getByTestId("tokened")).toHaveTextContent("new@x.com"));
    // The stale account was never asked for a silent token, so the UI shows
    // it signed out instead of armed with a token that cannot write.
    expect(silentCalls).toEqual(["new@x.com"]);
    expect(screen.getByTestId("tokened").textContent).not.toContain("old@x.com");
  });

  it("reconnecting a stale account skips silent, goes interactive, and stamps the new scopes", async () => {
    const silentCalls: string[] = [];
    let authorized = 0;
    gateSetup(
      [{ email: "old@x.com", mail: true, cal: true }],
      {
        authorize: async () => { authorized += 1; return { token: "t-int", email: "old@x.com" }; },
        silent: async (email) => { silentCalls.push(email); return "t-sil"; },
      },
    );
    await waitFor(() => expect(screen.getByTestId("scopes")).toHaveTextContent("old@x.com:stale"));
    fireEvent.click(screen.getByText("reconnect-old"));
    await waitFor(() => expect(screen.getByTestId("scopes")).toHaveTextContent("old@x.com:current"));
    expect(authorized).toBe(1);
    // Silent was never consulted for the stale account, in reconnect either.
    expect(silentCalls).toEqual([]);
    await waitFor(() => expect(screen.getByTestId("tokened")).toHaveTextContent("old@x.com"));
  });
});
