// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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

// The typed answers a broker's silent path gives (2026-09-29): a fresh token
// with its expiry, or a failure with its cause. Never a bare token or null.
const good = (token: string, email: string, over: Partial<Extract<GoogleSessionResult, { ok: true }>> = {}): GoogleSessionResult =>
  ({ ok: true, token, email, expiresAt: Date.now() + 3600e3, remembered: true, status: 200, ...over });
const bad = (code: GoogleFailureCode, email = "a@x.com", status = 410): GoogleSessionResult =>
  ({ ok: false, ...googleFailure(code, email, status) });

// THE SCOPE GATE (2026-08-26, born from "deleting literally doesn't work").
// A refresh token keeps minting access tokens with the scopes it was BORN
// with, whatever config.ts says today. These tests hold the two halves of
// the repair: silent minting refuses accounts whose stamped scopes are not
// current, and every interactive authorize stamps the current scopes.
import { GOOGLE_SCOPES } from "./config";
import { googleFailure, type GoogleFailureCode, type GoogleSessionResult, type TokenBroker } from "./broker";
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
        silent: async (email) => { silentCalls.push(email); return good("t-" + email, email); },
      },
    );
    await waitFor(() => expect(screen.getByTestId("tokened")).toHaveTextContent("new@x.com"));
    // The stale account was never asked for a silent token, so the UI shows
    // it signed out instead of armed with a token that cannot write.
    expect(silentCalls).toEqual(["new@x.com"]);
    expect(screen.getByTestId("tokened").textContent).not.toContain("old@x.com");
  });

  // THE DRIVE SCOPE ADDITION (Dave 2026-09-29). Both of his accounts were
  // stamped with the three-scope list. Adding drive changes the list, so the
  // gate must refuse both silently, and one interactive reconnect each must
  // stamp the new list. The stamp is compared as an exact string.
  const PREVIOUS_LIST = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
  ].join(" ");

  it("an account stamped with the list from before Drive is refused silently: both of them", async () => {
    const silentCalls: string[] = [];
    gateSetup(
      [
        { email: "one@x.com", mail: true, cal: true, scopes: PREVIOUS_LIST },
        { email: "two@x.com", mail: true, cal: true, scopes: PREVIOUS_LIST },
      ],
      { authorize: async () => ({ token: "t-int", email: "one@x.com" }), silent: async (email) => { silentCalls.push(email); return good("t-" + email, email); } },
    );
    await waitFor(() => expect(screen.getByTestId("scopes")).toHaveTextContent("one@x.com:stale,two@x.com:stale"));
    expect(silentCalls).toEqual([]);
    expect(screen.getByTestId("tokened").textContent).toBe("");
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/drive");
    expect(GOOGLE_SCOPES).not.toBe(PREVIOUS_LIST);
  });

  it("the one reconnect stamps the list with Drive, and the account is then current", async () => {
    let authorized = 0;
    gateSetup(
      [{ email: "old@x.com", mail: true, cal: true, scopes: PREVIOUS_LIST }],
      { authorize: async () => { authorized += 1; return { token: "t-int", email: "old@x.com" }; }, silent: async (email) => good("t-sil", email) },
    );
    await waitFor(() => expect(screen.getByTestId("scopes")).toHaveTextContent("old@x.com:stale"));
    fireEvent.click(screen.getByText("reconnect-old"));
    await waitFor(() => expect(screen.getByTestId("scopes")).toHaveTextContent("old@x.com:current"));
    expect(authorized).toBe(1);
  });

  it("reconnecting a stale account skips silent, goes interactive, and stamps the new scopes", async () => {
    const silentCalls: string[] = [];
    let authorized = 0;
    gateSetup(
      [{ email: "old@x.com", mail: true, cal: true }],
      {
        authorize: async () => { authorized += 1; return { token: "t-int", email: "old@x.com" }; },
        silent: async (email) => { silentCalls.push(email); return good("t-sil", email); },
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

// PLUMB-F-04 (2026-09-05): "Google access tokens are minted once at open and
// never refreshed." The session minted once per mount (silentTried) and the
// api had no 401 path, so an hour in every mail and calendar call said the
// sign-in expired while Reconnect in Settings worked instantly. These run
// the REAL api builder (no makeApi override) over a fake network, so the
// re-mint and the replay are exercised end to end.
import { vi } from "vitest";
import { act } from "@testing-library/react";
type FetchInit = { headers?: Record<string, string> };
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const unauthorized = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });

function RefreshHost({ broker, fetchImpl }: { broker: TokenBroker; fetchImpl: (url: string, init?: FetchInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> }) {
  const profile = useProfile();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    // Stamped with the current scopes, so the silent path is open to it
    // (the same shape GateHost seeds through a typed variable).
    const seed: { email: string; mail: boolean; cal: boolean; scopes?: string }[] =
      [{ email: "a@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES }];
    void profile.save({ googleAccounts: seed }).then(() => setSeeded(true));
  }, [profile]);
  if (!seeded) return null;
  return (
    <GoogleSessionProvider broker={broker} fetchImpl={fetchImpl as never}>
      <RefreshProbe />
    </GoogleSessionProvider>
  );
}
function RefreshProbe() {
  const g = useGoogle();
  const [out, setOut] = useState("");
  return (
    <div>
      <button onClick={() => void g.api("a@x.com")!.getProfile().then((p) => setOut("ok:" + p.emailAddress), (e: Error) => setOut("err:" + e.message))}>call</button>
      <div data-testid="tokened">{g.tokenEmails.join(",")}</div>
      <div data-testid="out">{out}</div>
    </div>
  );
}

describe("silent refresh (PLUMB-F-04)", () => {
  it("a 401 an hour in is met with one silent re-mint and the call succeeds, no Reconnect walk", async () => {
    const minted: string[] = [];
    let n = 0;
    const broker: TokenBroker = {
      authorize: async () => { throw new Error("must not go interactive"); },
      silent: async (email) => { n += 1; minted.push(email); return good("tok" + n, email); },
    };
    const calls: string[] = [];
    // tok1 is the mount-time token, "expired" by the time he taps; tok2 works.
    const fetchImpl = (url: string, init?: FetchInit) => {
      calls.push(init?.headers?.Authorization ?? "");
      return init?.headers?.Authorization === "Bearer tok2" ? ok({ emailAddress: "a@x.com" }) : unauthorized();
    };
    render(<NotesProvider userId={"refresh-" + Math.random()}><RefreshHost broker={broker} fetchImpl={fetchImpl} /></NotesProvider>);
    await waitFor(() => expect(screen.getByTestId("tokened")).toHaveTextContent("a@x.com"));
    expect(minted).toEqual(["a@x.com"]);

    fireEvent.click(screen.getByText("call"));
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("ok:a@x.com"));
    // One re-mint, one replay, and the session now holds the fresh token
    // for every api it hands out from here on.
    expect(minted).toEqual(["a@x.com", "a@x.com"]);
    expect(calls).toEqual(["Bearer tok1", "Bearer tok2"]);
    fireEvent.click(screen.getByText("call"));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]).toBe("Bearer tok2");
    expect(minted).toHaveLength(2);
  });

  it("when the server cannot re-mint either, the 401 is reported honestly, once", async () => {
    let n = 0;
    const broker: TokenBroker = {
      authorize: async () => { throw new Error("must not go interactive"); },
      // The first mint (at mount) works; the refresh token is then revoked.
      silent: async (email) => { n += 1; return n === 1 ? good("tok1", email) : bad("GOOGLE_SIGNIN_REVOKED", email); },
    };
    const calls: string[] = [];
    const fetchImpl = (_url: string, init?: FetchInit) => { calls.push(init?.headers?.Authorization ?? ""); return unauthorized(); };
    render(<NotesProvider userId={"refresh-" + Math.random()}><RefreshHost broker={broker} fetchImpl={fetchImpl} /></NotesProvider>);
    await waitFor(() => expect(screen.getByTestId("tokened")).toHaveTextContent("a@x.com"));
    fireEvent.click(screen.getByText("call"));
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("err:profile 401"));
    expect(calls).toEqual(["Bearer tok1"]);
    expect(n).toBe(2);
  });

  it("coming back to the foreground with a token older than 50 minutes re-mints before anything can fail", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let n = 0;
      const broker: TokenBroker = {
        authorize: async () => { throw new Error("must not go interactive"); },
        silent: async (email) => { n += 1; return good("tok" + n, email); },
      };
      const fetchImpl = () => ok({ emailAddress: "a@x.com" });
      render(<NotesProvider userId={"refresh-" + Math.random()}><RefreshHost broker={broker} fetchImpl={fetchImpl} /></NotesProvider>);
      await waitFor(() => expect(screen.getByTestId("tokened")).toHaveTextContent("a@x.com"));
      expect(n).toBe(1);

      // Ten minutes later, a return to the foreground is nothing to act on.
      vi.setSystemTime(Date.now() + 10 * 60e3);
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      expect(n).toBe(1);

      // An hour later it is: the token is re-minted on the way back in.
      vi.setSystemTime(Date.now() + 51 * 60e3);
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      await waitFor(() => expect(n).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

// THE SESSION'S OWN ACCOUNT STATE AND THE WRITE PREFLIGHT (2026-09-29).
//
// Delete used to run on whatever token the session held, for whichever
// account the row named, falling back to the first account when the row's
// own was missing. These hold the gate every write passes now: the exact
// account, mail on, the modify scope, a token good for the next minute, and
// a getProfile that says the token really is that address. On any failure
// nothing is touched, the caller's selection is the caller's to keep, and a
// reconnect never resumes what the person had asked for.
import type { GoogleApi } from "./api";
import type { EnsureGoogleResult } from "./GoogleSession";

type Seed = { email: string; mail: boolean; cal: boolean; scopes?: string }[];
type Session = ReturnType<typeof useGoogle>;

function Grab({ into }: { into: { current: Session | null } }) {
  into.current = useGoogle();
  return null;
}

function PreflightHost({ seed, broker, makeApi, into }: {
  seed: Seed; broker: TokenBroker; makeApi: (token: string, email?: string) => GoogleApi; into: { current: Session | null };
}) {
  const profile = useProfile();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => { void profile.save({ googleAccounts: seed }).then(() => setSeeded(true)); }, [profile, seed]);
  if (!seeded) return null;
  return <GoogleSessionProvider broker={broker} makeApi={makeApi}><Grab into={into} /></GoogleSessionProvider>;
}

const A = { email: "a@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES };
const B = { email: "b@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES };
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";

async function mount(seed: Seed, broker: TokenBroker, opts: { profileOf?: (token: string, email?: string) => string; trashed?: string[]; profiles?: string[] } = {}) {
  const into: { current: Session | null } = { current: null };
  const makeApi = (token: string, email?: string) => makeFakeGoogleApi({
    getProfile: async () => { opts.profiles?.push(token); return { emailAddress: opts.profileOf ? opts.profileOf(token, email) : (email ?? "a@x.com") }; },
    trashThread: async (id: string) => { opts.trashed?.push(token + ":" + id); },
  });
  render(<NotesProvider userId={"pre-" + Math.random()}><PreflightHost seed={seed} broker={broker} makeApi={makeApi} into={into} /></NotesProvider>);
  await waitFor(() => expect(into.current).not.toBeNull());
  return into as { current: Session };
}

const ensure = async (into: { current: Session }, email: string, forMutation = true): Promise<EnsureGoogleResult> => {
  let out!: EnsureGoogleResult;
  await act(async () => { out = await into.current.ensureGoogleSession(email, { forMutation }); });
  return out;
};

const neverInteractive = async (): Promise<never> => { throw new Error("must not go interactive"); };

describe("ensureGoogleSession for a mutation", () => {
  it("refuses an account the session does not know, and never falls back to the first one", async () => {
    const silentFor: string[] = [];
    const trashed: string[] = [];
    const into = await mount([A], {
      authorize: neverInteractive,
      silent: async (email) => { silentFor.push(email); return good("tok-" + email, email, { scope: MODIFY }); },
    }, { trashed });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    const r = await ensure(into, "stranger@x.com");
    expect(r).toMatchObject({ ok: false, code: "GOOGLE_UNKNOWN_ACCOUNT", email: "stranger@x.com" });
    expect(silentFor).toEqual(["a@x.com"]); // only the mount mint; nothing was minted for or borrowed from anyone else
    expect(trashed).toEqual([]);
  });

  it("refuses an account with mail turned off", async () => {
    const into = await mount([{ ...A, mail: false }], { authorize: neverInteractive, silent: async (e) => good("t", e, { scope: MODIFY }) });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    expect(await ensure(into, "a@x.com")).toMatchObject({ ok: false, code: "GOOGLE_MAIL_DISABLED" });
    // A read is another matter: the same account is fine to ask for a token.
    expect((await ensure(into, "a@x.com", false)).ok).toBe(true);
  });

  it("refuses an account stamped with older scopes without asking the server", async () => {
    const silentFor: string[] = [];
    const into = await mount([{ email: "a@x.com", mail: true, cal: true }], {
      authorize: neverInteractive, silent: async (e) => { silentFor.push(e); return good("t", e); },
    });
    expect(await ensure(into, "a@x.com")).toMatchObject({ ok: false, code: "GOOGLE_MISSING_SCOPE" });
    expect(silentFor).toEqual([]);
  });

  it("refuses an account stamped with the list from before Drive, for a write and for a read", async () => {
    const PREV = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send";
    const into = await mount([{ email: "a@x.com", mail: true, cal: true, scopes: PREV }], {
      authorize: neverInteractive, silent: async (e) => good("t", e),
    });
    expect(await ensure(into, "a@x.com")).toMatchObject({ ok: false, code: "GOOGLE_MISSING_SCOPE" });
    expect(await ensure(into, "a@x.com", false)).toMatchObject({ ok: false, code: "GOOGLE_MISSING_SCOPE" });
  });

  it("refuses a token Google says cannot modify mail, even under current stamps", async () => {
    const into = await mount([A], {
      authorize: neverInteractive,
      silent: async (e) => good("t", e, { scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.send" }),
    });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    expect(await ensure(into, "a@x.com")).toMatchObject({ ok: false, code: "GOOGLE_MISSING_SCOPE" });
  });

  it("hands back an api bound to the good token, verified once with getProfile, and does not re-mint", async () => {
    let mints = 0;
    const profiles: string[] = [];
    const into = await mount([A], {
      authorize: neverInteractive, silent: async (e) => { mints += 1; return good("tok" + mints, e, { scope: MODIFY }); },
    }, { profiles });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    const r = await ensure(into, " A@X.com ");
    expect(r).toMatchObject({ ok: true, email: "a@x.com", token: "tok1", remembered: true });
    expect(mints).toBe(1);
    expect(profiles).toEqual(["tok1"]); // one profile check for the group
  });

  it("a read-only ensure does not spend a profile call", async () => {
    const profiles: string[] = [];
    const into = await mount([A], { authorize: neverInteractive, silent: async (e) => good("tok1", e, { scope: MODIFY }) }, { profiles });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    expect((await ensure(into, "a@x.com", false)).ok).toBe(true);
    expect(profiles).toEqual([]);
  });

  it("refreshes a token inside the 60 second margin BEFORE the write, and binds the api to the fresh one", async () => {
    let mints = 0;
    const into = await mount([A], {
      authorize: neverInteractive,
      silent: async (e) => {
        mints += 1;
        // The mount-time token has 30 seconds left; the next one is healthy.
        return good("tok" + mints, e, { scope: MODIFY, expiresAt: Date.now() + (mints === 1 ? 30e3 : 3600e3) });
      },
    });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    const r = await ensure(into, "a@x.com");
    expect(mints).toBe(2);
    expect(r).toMatchObject({ ok: true, token: "tok2" });
  });

  it("a token with more than a minute left is used as it is", async () => {
    let mints = 0;
    const into = await mount([A], {
      authorize: neverInteractive,
      silent: async (e) => { mints += 1; return good("tok" + mints, e, { scope: MODIFY, expiresAt: Date.now() + 120e3 }); },
    });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    expect(await ensure(into, "a@x.com")).toMatchObject({ ok: true, token: "tok1" });
    expect(mints).toBe(1);
  });

  it("two writes asking at once share ONE refresh per account", async () => {
    let mints = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const into = await mount([A], {
      authorize: neverInteractive,
      silent: async (e) => {
        mints += 1;
        if (mints === 1) return good("tok1", e, { scope: MODIFY, expiresAt: Date.now() + 10e3 });
        await gate;
        return good("tok2", e, { scope: MODIFY });
      },
    });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    let both!: EnsureGoogleResult[];
    await act(async () => {
      const p = Promise.all([
        into.current.ensureGoogleSession("a@x.com", { forMutation: true }),
        into.current.ensureGoogleSession("a@x.com", { forMutation: true }),
      ]);
      release();
      both = await p;
    });
    expect(mints).toBe(2); // the mount mint and one shared refresh
    expect(both.map((r) => r.ok && r.token)).toEqual(["tok2", "tok2"]);
  });

  it("a token that belongs to another address is refused and dropped, never used", async () => {
    const into = await mount([A, B], {
      authorize: neverInteractive, silent: async (e) => good("tok-" + e, e, { scope: MODIFY }),
    }, { profileOf: (token) => (token === "tok-b@x.com" ? "a@x.com" : token.slice(4)) });
    await waitFor(() => expect(into.current.tokenEmails.sort()).toEqual(["a@x.com", "b@x.com"]));
    expect(await ensure(into, "a@x.com")).toMatchObject({ ok: true });
    const r = await ensure(into, "b@x.com");
    expect(r).toMatchObject({ ok: false, code: "GOOGLE_ACCOUNT_MISMATCH" });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
  });

  it("names the cause when the refresh fails, for every cause", async () => {
    const causes: GoogleFailureCode[] = [
      "GOOGLE_NO_STORED_SIGNIN", "GOOGLE_STORED_SIGNIN_UNREADABLE", "GOOGLE_SIGNIN_REVOKED",
      "GOOGLE_REFRESH_UNAVAILABLE", "GOOGLE_NETWORK_ERROR", "GOOGLE_AUTH_EXPIRED", "GOOGLE_STORAGE_FAILURE",
    ];
    for (const code of causes) {
      let mints = 0;
      const into = await mount([A], {
        authorize: neverInteractive,
        silent: async (e) => {
          mints += 1;
          return mints === 1 ? good("t1", e, { scope: MODIFY, expiresAt: Date.now() + 5e3 }) : bad(code, e);
        },
      });
      await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
      const r = await ensure(into, "a@x.com");
      expect(r).toMatchObject({ ok: false, code, email: "a@x.com" });
      expect(r.ok ? "" : r.message.length).toBeGreaterThan(5);
      // The state a screen reads says the same thing.
      await waitFor(() => expect(into.current.connectionOf("a@x.com").failure?.code).toBe(code));
      cleanup();
    }
  });

  it("legacy brokers with no silent path cannot refresh, and say the sign-in is not stored", async () => {
    const into = await mount([A], { authorize: neverInteractive });
    expect(await ensure(into, "a@x.com")).toMatchObject({ ok: false, code: "GOOGLE_NO_STORED_SIGNIN" });
  });
});

// The phone behaviour: Delete refreshes first; a failed preflight keeps the
// selection and says why in plain words; Reconnect does not delete anything.
describe("a Delete that fails its preflight", () => {
  function DeleteProbe({ into }: { into: { current: Session | null } }) {
    const g = useGoogle();
    into.current = g;
    const [selected, setSelected] = useState(["t1", "t2"]);
    const [said, setSaid] = useState("");
    const del = async () => {
      const r = await g.ensureGoogleSession("a@x.com", { forMutation: true });
      if (!r.ok) { setSaid(r.message); return; } // nothing removed, nothing sent
      for (const id of selected) await r.api.trashThread(id);
      setSelected([]);
      setSaid("Deleted");
    };
    return (
      <div>
        <button onClick={() => void del()}>delete</button>
        <button onClick={() => void g.reconnect("a@x.com").catch((e: Error) => setSaid("reconnect:" + e.message))}>reconnect</button>
        <div data-testid="selected">{selected.join(",")}</div>
        <div data-testid="said">{said}</div>
      </div>
    );
  }

  function Host({ broker, trashed, into }: { broker: TokenBroker; trashed: string[]; into: { current: Session | null } }) {
    const profile = useProfile();
    const [seeded, setSeeded] = useState(false);
    useEffect(() => { void profile.save({ googleAccounts: [A] }).then(() => setSeeded(true)); }, [profile]);
    if (!seeded) return null;
    return (
      <GoogleSessionProvider broker={broker} makeApi={(token) => makeFakeGoogleApi({
        getProfile: async () => ({ emailAddress: "a@x.com" }),
        trashThread: async (id: string) => { trashed.push(token + ":" + id); },
      })}>
        <DeleteProbe into={into} />
      </GoogleSessionProvider>
    );
  }

  it("keeps the selection, names the cause, deletes nothing, and after Reconnect waits for a second tap", async () => {
    const trashed: string[] = [];
    let interactive = 0;
    let mints = 0;
    const broker: TokenBroker = {
      authorize: async () => { interactive += 1; return { token: "tok-int", email: "a@x.com", expiresAt: Date.now() + 3600e3, remembered: true, scope: MODIFY }; },
      silent: async (e) => {
        mints += 1;
        if (mints === 1) return good("tok1", e, { scope: MODIFY, expiresAt: Date.now() + 5e3 }); // about to die
        return bad("GOOGLE_SIGNIN_REVOKED", e);
      },
    };
    const into: { current: Session | null } = { current: null };
    render(<NotesProvider userId={"del-" + Math.random()}><Host broker={broker} trashed={trashed} into={into} /></NotesProvider>);
    await waitFor(() => expect(into.current?.tokenEmails).toEqual(["a@x.com"]));

    fireEvent.click(screen.getByText("delete"));
    await waitFor(() => expect(screen.getByTestId("said")).toHaveTextContent("Google revoked this sign-in. Reconnect a@x.com."));
    expect(screen.getByTestId("selected")).toHaveTextContent("t1,t2"); // selection preserved
    expect(trashed).toEqual([]); // no Gmail mutation
    expect(interactive).toBe(0); // and Google's chooser was not opened for it

    // The person taps Reconnect. It is interactive, and it deletes nothing.
    fireEvent.click(screen.getByText("reconnect"));
    await waitFor(() => expect(interactive).toBe(1));
    await waitFor(() => expect(into.current!.connectionOf("a@x.com").failure).toBeNull());
    expect(trashed).toEqual([]);
    expect(screen.getByTestId("selected")).toHaveTextContent("t1,t2");

    // Only their second tap on Delete runs it, on the fresh token.
    fireEvent.click(screen.getByText("delete"));
    await waitFor(() => expect(screen.getByTestId("said")).toHaveTextContent("Deleted"));
    expect(trashed).toEqual(["tok-int:t1", "tok-int:t2"]);
  });

  it("a temporary failure never opens Google's chooser, from Delete or from Reconnect", async () => {
    let interactive = 0;
    let mints = 0;
    const broker: TokenBroker = {
      authorize: async () => { interactive += 1; return { token: "x", email: "a@x.com" }; },
      silent: async (e) => {
        mints += 1;
        return mints === 1 ? good("tok1", e, { scope: MODIFY, expiresAt: Date.now() + 5e3 }) : bad("GOOGLE_NETWORK_ERROR", e, 0);
      },
    };
    const trashed: string[] = [];
    const into: { current: Session | null } = { current: null };
    render(<NotesProvider userId={"del-" + Math.random()}><Host broker={broker} trashed={trashed} into={into} /></NotesProvider>);
    await waitFor(() => expect(into.current?.tokenEmails).toEqual(["a@x.com"]));

    fireEvent.click(screen.getByText("delete"));
    await waitFor(() => expect(screen.getByTestId("said")).toHaveTextContent("Couldn't reach Google. Check your connection and try again."));
    fireEvent.click(screen.getByText("reconnect"));
    await waitFor(() => expect(screen.getByTestId("said")).toHaveTextContent(/^reconnect:Couldn't reach Google/));
    expect(interactive).toBe(0);
    expect(trashed).toEqual([]);
    expect(screen.getByTestId("selected")).toHaveTextContent("t1,t2");
  });
});

describe("per-account connection state", () => {
  it("a connect the server could not store is shown as temporary at once, with the reason", async () => {
    const into = await mount([], {
      authorize: async () => ({
        token: "tok", email: "a@x.com", expiresAt: Date.now() + 3600e3, remembered: false,
        warning: googleFailure("GOOGLE_STORAGE_FAILURE", "a@x.com", 200),
      }),
    });
    let added!: { remembered: boolean };
    await act(async () => { added = await into.current.addAccount(); });
    expect(added.remembered).toBe(false);
    const c = into.current.connectionOf("a@x.com");
    expect(c).toMatchObject({ connected: true, durable: false });
    expect(c.failure?.code).toBe("GOOGLE_STORAGE_FAILURE");
  });

  it("a stored, confirmed connect is durable and clean", async () => {
    const into = await mount([], {
      authorize: async () => ({ token: "tok", email: "A@x.com", expiresAt: Date.now() + 3600e3, remembered: true, scope: MODIFY }),
    });
    await act(async () => { await into.current.addAccount(); });
    expect(into.current.connectionOf("a@x.com")).toMatchObject({ connected: true, durable: true, failure: null });
    expect(into.current.connectionOf("a@x.com").expiresAt).toBeGreaterThan(Date.now());
  });

  it("a token minted silently at mount is durable, and its expiry is tracked", async () => {
    const at = Date.now() + 1800e3;
    const into = await mount([A], { authorize: neverInteractive, silent: async (e) => good("t", e, { expiresAt: at }) });
    await waitFor(() => expect(into.current.connectionOf("a@x.com").connected).toBe(true));
    expect(into.current.connectionOf("a@x.com")).toMatchObject({ durable: true, expiresAt: at, failure: null });
  });

  it("mount restore keeps the cause when an account cannot be restored", async () => {
    const into = await mount([A, B], {
      authorize: neverInteractive,
      silent: async (e) => (e === "a@x.com" ? bad("GOOGLE_STORED_SIGNIN_UNREADABLE", e) : good("tb", e)),
    });
    await waitFor(() => expect(into.current.connectionOf("b@x.com").connected).toBe(true));
    await waitFor(() => expect(into.current.connectionOf("a@x.com").failure?.code).toBe("GOOGLE_STORED_SIGNIN_UNREADABLE"));
    expect(into.current.connectionOf("a@x.com").connected).toBe(false);
  });

  it("disconnect forgets the account's state along with its token", async () => {
    const into = await mount([A], { authorize: neverInteractive, silent: async (e) => good("t", e) });
    await waitFor(() => expect(into.current.connectionOf("a@x.com").connected).toBe(true));
    await act(async () => { await into.current.disconnect("a@x.com"); });
    expect(into.current.connectionOf("a@x.com")).toMatchObject({ connected: false, durable: false, expiresAt: null, failure: null });
  });
});

describe("foreground refresh follows the expiry the server gave", () => {
  const foreground = async () => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  };

  it("leaves a token with an hour left alone", async () => {
    let mints = 0;
    const into = await mount([A], { authorize: neverInteractive, silent: async (e) => { mints += 1; return good("tok" + mints, e); } });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    await foreground();
    expect(mints).toBe(1);
  });

  it("re-mints a token with under ten minutes left, and clears nothing it should keep", async () => {
    let mints = 0;
    const into = await mount([A], {
      authorize: neverInteractive,
      silent: async (e) => { mints += 1; return good("tok" + mints, e, { expiresAt: Date.now() + (mints === 1 ? 5 * 60e3 : 3600e3) }); },
    });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    await foreground();
    await waitFor(() => expect(mints).toBe(2));
    await waitFor(() => expect(into.current.connectionOf("a@x.com").expiresAt).toBeGreaterThan(Date.now() + 30 * 60e3));
  });

  it("a foreground refresh that fails leaves the old token in place and records why", async () => {
    let mints = 0;
    const into = await mount([A], {
      authorize: neverInteractive,
      silent: async (e) => { mints += 1; return mints === 1 ? good("tok1", e, { expiresAt: Date.now() + 5 * 60e3 }) : bad("GOOGLE_NETWORK_ERROR", e, 0); },
    });
    await waitFor(() => expect(into.current.tokenEmails).toEqual(["a@x.com"]));
    await foreground();
    await waitFor(() => expect(into.current.connectionOf("a@x.com").failure?.code).toBe("GOOGLE_NETWORK_ERROR"));
    expect(into.current.connectionOf("a@x.com").connected).toBe(true); // a temporary problem does not sign anyone out
  });
});

// PREPARED SIGN-INS (2026-10-10, the Sign In Again that did nothing). warmReconnect does the network work before the tap;
// reconnect then calls the prepared launch synchronously, inside the tap, so the browser lets Google's window open.
function PrepHost({ broker }: { broker: TokenBroker }) {
  const profile = useProfile();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    const seed: { email: string; mail: boolean; cal: boolean; scopes?: string }[] = [{ email: "old@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES }];
    void profile.save({ googleAccounts: seed }).then(() => setSeeded(true));
  }, [profile]);
  if (!seeded) return null;
  return (
    <GoogleSessionProvider broker={broker} makeApi={() => makeFakeGoogleApi({ getProfile: async () => ({ emailAddress: "old@x.com" }) })}>
      <PrepInner />
    </GoogleSessionProvider>
  );
}
function PrepInner() {
  const g = useGoogle();
  return (
    <div>
      <button onClick={() => g.warmReconnect("old@x.com", { consent: true })}>warm</button>
      <button onClick={() => { void g.reconnect("old@x.com", { consent: true }); }}>tap</button>
    </div>
  );
}

describe("prepared sign-ins", () => {
  it("Sign In Again prepares before the tap, then opens Google synchronously in the tap, never via the silent path", async () => {
    const order: string[] = [];
    const broker: TokenBroker = {
      authorize: async () => { order.push("authorize"); return { token: "t", email: "old@x.com", expiresAt: Date.now() + 3600e3, remembered: true }; },
      silent: async () => { order.push("silent"); return bad("GOOGLE_REFRESH_UNAVAILABLE", "old@x.com", 503); },
      prepare: async (opts) => {
        order.push("prepare:" + String(opts.reconnect));
        return { expiresAt: Date.now() + 60e3, launch: () => { order.push("launch"); return Promise.resolve({ token: "t2", email: "old@x.com", expiresAt: Date.now() + 3600e3, remembered: true }); } };
      },
    };
    render(<NotesProvider userId={"prep-" + Math.random()}><PrepHost broker={broker} /></NotesProvider>);
    fireEvent.click(await screen.findByText("warm"));
    await waitFor(() => expect(order).toContain("prepare:old@x.com"));
    const before = order.length;
    fireEvent.click(screen.getByText("tap"));
    // Synchronously after the tap: the prepared window was asked for, and nothing else ran first.
    expect(order.slice(before)).toEqual(["launch"]);
    expect(order).not.toContain("authorize");
  });
});
