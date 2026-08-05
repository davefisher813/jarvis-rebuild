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
