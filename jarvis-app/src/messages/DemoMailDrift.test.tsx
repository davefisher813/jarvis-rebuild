// THE DEMO ALREADY DRIFTED ONCE (LinkPicker catalog pick, 2026-09-0X). Demo
// Mail and the real, connected Email flow are two separate components on
// purpose -- the fixtures never ship to a real user's build -- and nothing
// before this checked they kept showing the same anatomy. This renders BOTH
// through the one component that owns the choice (MessagesFlow itself
// switches on its own `demoMail` prop, see MessagesFlow.test.tsx's "renders
// the demo fixture instead of the setup state") and pins the pieces a reader
// would actually notice drifted: the page title, the search box, the filter
// chips, the two Mission Deck cards, both outcome tabs, and the fold.
//
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import MessagesFlow from "./MessagesFlow";

const noAI = new AIService({ available: false });
const aiReturning = (text: string) => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ text }), text: async () => "" })) as unknown as typeof fetch,
});

const msg = (id: string, from: string, subject: string, snippet: string, labels: string[], dateMs: number, extraHeaders: { name: string; value: string }[] = []): GmailMeta => ({
  id, snippet, labelIds: labels, internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, ...extraHeaders] },
});

const TEN_DAYS_AGO = Date.now() - 10 * 86400e3;

const INBOX_THREADS: GmailThreadMeta[] = [
  { id: "t1", messages: [msg("m1", "Ridgeley <t@x.com>", "Waiver", "Need the waiver by Friday", ["INBOX", "UNREAD"], Date.now())] },
  { id: "t2", messages: [msg("m2", "DoorDash <no@dd.com>", "20% off", "Order now", ["INBOX"], Date.now())] },
];
// A sent thread findWaiting() will surface: the last message is "mine",
// addressed to a real person, old enough to count as waiting.
const SENT_THREADS: GmailThreadMeta[] = [
  { id: "s1", messages: [msg("m3", "me@example.com", "Sponsor Deck", "Following up on the deck", [], TEN_DAYS_AGO, [{ name: "To", value: "Rob Calder <rob@calder.com>" }])] },
];

function makeApi() {
  return makeFakeGoogleApi({
    listThreads: async () => INBOX_THREADS,
    searchThreads: async () => SENT_THREADS,
  });
}

function wrap(node: React.ReactNode) {
  return (
    <NotesProvider userId="u1">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={makeApi}>{node}</GoogleSessionProvider>
    </NotesProvider>
  );
}

// A tab's own text node is the label glued to its count ("Needs You1"); this
// strips the trailing digits back off so the two renders compare labels, not
// labels-plus-whatever-today's-fixture-count-happens-to-be.
const tabLabels = () => screen.getAllByRole("tab").map((t) => (t.textContent ?? "").replace(/\d+$/, ""));

describe("DemoMail vs the real Email flow: the anatomy stays one thing", () => {
  it("the demo shows the same title, search box, chips, deck cards, outcome tabs, and fold as the connected inbox", async () => {
    // The connected, triaged real inbox: one thread that needs him, one
    // that's noise (so Clean Out has something to clean), one sent thread
    // old enough to be Waiting On.
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Ridgeley needs the waiver by Friday." },
      { id: "t2", bucket: "noise", gist: "DoorDash promo." },
    ]));
    const { unmount } = render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("The Sweep");
    await screen.findByRole("tab", { name: /Waiting On/ });

    expect(document.querySelector(".pagehead-title")).toHaveTextContent("Email");
    expect(screen.getByPlaceholderText("Search All Mail")).toBeInTheDocument();
    expect(screen.getByText("For You")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText(/^Drafts/)).toBeInTheDocument();
    expect(screen.getByText("The Sweep")).toBeInTheDocument();
    expect(screen.getByText("Clean Out")).toBeInTheDocument();
    expect(tabLabels()).toEqual(["Needs You", "Waiting On"]);
    expect(screen.getByText("The Rest")).toBeInTheDocument();
    unmount();

    // The demo fixture, through the SAME component's demoMail branch --
    // never a second, hand-copied shell.
    render(wrap(<MessagesFlow ai={noAI} configured={false} demoMail />));
    await screen.findByText("The Sweep");

    expect(document.querySelector(".pagehead-title")).toHaveTextContent("Email");
    expect(screen.getByPlaceholderText("Search All Mail")).toBeInTheDocument();
    expect(screen.getByText("For You")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText(/^Drafts/)).toBeInTheDocument();
    expect(screen.getByText("Clean Out")).toBeInTheDocument();
    expect(tabLabels()).toEqual(["Needs You", "Waiting On"]);
    expect(screen.getByText("The Rest")).toBeInTheDocument();
  });
});
