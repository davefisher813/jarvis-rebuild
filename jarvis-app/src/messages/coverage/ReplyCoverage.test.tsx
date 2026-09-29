// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, renderHook, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReplyCoverage from "./ReplyCoverage";
import { useReplyRequirements } from "../useReplyRequirements";
import { saveBrief } from "../brief";
import { resetInboxRefreshState } from "../inboxRefresh";
import { BRIEF_SCHEMA_VERSION, type ReplyRequirement, type ReplyRequirements } from "../mailContracts";
import type { CoverageOverride } from "../replyCoverage";
import type { ThreadFull } from "../../connections/google/map";

const req = (id: string, label: string, kind: ReplyRequirement["kind"], match: ReplyRequirement["match"]): ReplyRequirement => ({
  id, sourceMessageId: "m1", sourceQuote: "Quote for " + label, kind, label, match,
});
const FOUR: ReplyRequirement[] = [
  req("day", "Which Day", "question", { kind: "date_time", topicTerms: ["day"] }),
  req("players", "Attendees", "question", { kind: "quantity", topicTerms: ["players", "kids"] }),
  req("waiver", "Waiver", "request", { kind: "attachment", topicTerms: ["waiver"] }),
  req("publish", "Publication Permission", "question", { kind: "free_text", topicTerms: ["publish", "photos"] }),
];
const REQS = (over: Partial<ReplyRequirements> = {}): ReplyRequirements => ({ items: FOUR, completeSource: true, sourceRevision: "m1", ...over });
const TEXT = "Tuesday works, four players, yes you can publish";

function Harness({ reqs, text, files = [], overrides = {}, onOverride = () => {}, debounceMs }: {
  reqs: ReplyRequirements | undefined; text: string; files?: { filename: string }[]; overrides?: Record<string, CoverageOverride>;
  onOverride?: (k: string, m: CoverageOverride | null) => void; debounceMs?: number;
}) {
  return <ReplyCoverage requirements={reqs} text={text} attachments={files} overrides={overrides} onOverride={onOverride} {...(debounceMs !== undefined ? { debounceMs } : {})} />;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ReplyCoverage: the indicator", () => {
  it("says Answered 3 of 4 for the four asks, and 4 of 4 once the waiver is really attached", () => {
    const { rerender } = render(<Harness reqs={REQS()} text={TEXT} />);
    expect(screen.getByText("Answered 3 of 4")).toBeInTheDocument();
    rerender(<Harness reqs={REQS()} text={TEXT} files={[{ filename: "Team Waiver.pdf" }]} />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText("Answered 4 of 4")).toBeInTheDocument();
  });

  it("typing the word waiver does not raise the count", () => {
    const { rerender } = render(<Harness reqs={REQS()} text={TEXT} />);
    rerender(<Harness reqs={REQS()} text={TEXT + ", waiver"} />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText("Answered 3 of 4")).toBeInTheDocument();
  });

  it("draws nothing before the thread is analysed, and nothing for a complete read that found nothing", () => {
    const a = render(<Harness reqs={undefined} text={TEXT} />);
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    const b = render(<Harness reqs={REQS({ items: [] })} text={TEXT} />);
    expect(b.container).toBeEmptyDOMElement();
  });

  it("an incomplete read says so: Answered 3 of 4 Found, Review Requests, and explains", () => {
    render(<Harness reqs={REQS({ completeSource: false })} text={TEXT} />);
    expect(screen.getByText("Answered 3 of 4 Found · Review Requests")).toBeInTheDocument();
    expect(screen.getByText("Not Every Message Was Read")).toBeInTheDocument();
  });

  it("an incomplete read that found nothing still says it was incomplete", () => {
    render(<Harness reqs={REQS({ completeSource: false, items: [] })} text="anything" />);
    expect(screen.getByText("Answered 0 of 0 Found · Review Requests")).toBeInTheDocument();
  });
});

describe("ReplyCoverage: the checklist", () => {
  it("tapping opens a small checklist: each ask, whether it is answered, and why", () => {
    render(<Harness reqs={REQS()} text={"Tuesday works, four players, yes you can publish. Can't send waiver until Friday"} />);
    expect(screen.queryByText("Waiver")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText("Which Day")).toBeInTheDocument();
    expect(screen.getByText("Waiver")).toBeInTheDocument();
    expect(screen.getByText("Deferred")).toBeInTheDocument();
    expect(screen.getByText("Says 4")).toBeInTheDocument();
    expect(screen.getAllByText("Answered").length).toBeGreaterThanOrEqual(4);
    // Each line carries the sender's own words.
    expect(screen.getByText("Quote for Waiver")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Quote for Waiver")).toBeNull();
  });

  it("the row is the door: tapping the words makes the mark, as the pill does", () => {
    const onOverride = vi.fn();
    render(<Harness reqs={REQS()} text={TEXT} onOverride={onOverride} />);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    // The waiver is open, so its control offers Mark Answered.
    fireEvent.click(screen.getByText("Quote for Waiver"));
    expect(onOverride).toHaveBeenCalledWith("waiver", "addressed");
  });

  it("marks work both ways and can be taken back", () => {
    const onOverride = vi.fn();
    const { rerender } = render(<Harness reqs={REQS()} text={TEXT} onOverride={onOverride} />);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    // An answered line offers Mark Open.
    const publishRow = screen.getByText("Publication Permission").closest(".row") as HTMLElement;
    fireEvent.click(publishRow.querySelector("button")!);
    expect(onOverride).toHaveBeenLastCalledWith("publish", "open");
    // With the mark set the line offers to clear it.
    rerender(<Harness reqs={REQS()} text={TEXT} overrides={{ publish: "open" }} onOverride={onOverride} />);
    expect(screen.getByText("Answered 2 of 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear Mark" }));
    expect(onOverride).toHaveBeenLastCalledWith("publish", null);
  });

  it("a hand mark counts, and shows as one", () => {
    render(<Harness reqs={REQS()} text={TEXT} overrides={{ waiver: "addressed" }} />);
    expect(screen.getByText("Answered 4 of 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText("Marked Answered")).toBeInTheDocument();
  });

  it("it never blocks anything: it renders no disabled control and no send", () => {
    render(<Harness reqs={REQS()} text="" />);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    for (const b of screen.getAllByRole("button")) expect(b).not.toBeDisabled();
    expect(screen.queryByText(/send/i)).toBeNull();
  });
});

describe("ReplyCoverage: the 300 ms debounce", () => {
  it("does not recompute on every keystroke: the count moves once, 300 ms after the last one", () => {
    const { rerender } = render(<Harness reqs={REQS()} text="" />);
    expect(screen.getByText("Answered 0 of 4")).toBeInTheDocument();
    for (let i = 1; i <= TEXT.length; i++) {
      rerender(<Harness reqs={REQS()} text={TEXT.slice(0, i)} />);
      act(() => { vi.advanceTimersByTime(50); });
    }
    // Typing was continuous (50 ms apart): the last pause has not reached 300 ms yet.
    act(() => { vi.advanceTimersByTime(249); });
    expect(screen.getByText(/Answered [0-2] of 4/)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(60); });
    expect(screen.getByText("Answered 3 of 4")).toBeInTheDocument();
  });

  it("makes no request of any kind, whatever is typed", () => {
    const fetchSpy = vi.fn();
    const g = globalThis as unknown as { fetch?: unknown };
    const real = g.fetch;
    g.fetch = fetchSpy;
    try {
      const { rerender } = render(<Harness reqs={REQS()} text="" />);
      for (let i = 1; i <= 100; i++) {
        rerender(<Harness reqs={REQS()} text={("Tuesday works, four players, yes you can publish. ".repeat(3)).slice(0, i)} />);
        act(() => { vi.advanceTimersByTime(20); });
      }
      act(() => { vi.advanceTimersByTime(400); });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { g.fetch = real; }
  });
});

// The hook that finds what the reply has to answer: from the cache when it can,
// through the one single-flight door when it must, and never because of typing.
describe("useReplyRequirements", () => {
  beforeEach(() => { vi.useRealTimers(); localStorage.clear(); resetInboxRefreshState(); });

  const thread = (id = "t1", last = "m2"): ThreadFull => ({
    id, subject: "Practice",
    messages: [
      { id: "m1", from: "Coach", fromEmail: "coach@club.org", dateMs: Date.UTC(2026, 8, 21, 17, 0), body: "Hi" },
      { id: last, from: "Coach", fromEmail: "coach@club.org", dateMs: Date.UTC(2026, 8, 21, 18, 0), body: "Please send the waiver." },
    ] as unknown as ThreadFull["messages"],
  });
  const ANSWER = JSON.stringify({
    summary: "s", replies: [], meetingCandidates: [],
    replyRequirements: [{ messageId: "m2", quote: "Please send the waiver", kind: "request", label: "waiver", match: { kind: "attachment", topicTerms: ["waiver"] } }],
  });
  const mkAI = () => { const complete = vi.fn(async () => ANSWER); return { ai: { available: true, complete }, complete }; };
  const base = (over: Partial<Parameters<typeof useReplyRequirements>[0]> = {}) => ({
    userId: "u1", source: { account: "dave@me.com", threadId: "t1", revision: "m2" }, thread: thread(),
    loadThread: async () => null, selfEmails: ["dave@me.com"], ...mkAI(), ...over,
  });

  it("finds the requirements through ensureThreadBrief for the open thread, once", async () => {
    const a = base();
    const { result } = renderHook(() => useReplyRequirements(a));
    await waitFor(() => expect(result.current?.items).toHaveLength(1));
    expect(result.current).toMatchObject({ sourceRevision: "m2", completeSource: true });
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it("reads the cache when the thread was already read: no call at all", async () => {
    saveBrief("m2", {
      summary: "s", replies: [], schema: BRIEF_SCHEMA_VERSION,
      replyRequirements: { items: [FOUR[2]!], completeSource: true, sourceRevision: "m2" },
    }, { userId: "u1", account: "dave@me.com" });
    const a = base();
    const { result } = renderHook(() => useReplyRequirements(a));
    await waitFor(() => expect(result.current?.items).toHaveLength(1));
    expect(a.complete).not.toHaveBeenCalled();
  });

  it("a thread that is not open is fetched once, then read through the same door", async () => {
    const loadThread = vi.fn(async () => thread());
    const a = base({ thread: null, loadThread });
    const { result } = renderHook(() => useReplyRequirements(a));
    await waitFor(() => expect(result.current?.items).toHaveLength(1));
    expect(loadThread).toHaveBeenCalledTimes(1);
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it("typing never restarts it: re-rendering with the same source makes no second lookup", async () => {
    const a = base();
    const { result, rerender } = renderHook((p: Parameters<typeof useReplyRequirements>[0]) => useReplyRequirements(p), { initialProps: a });
    await waitFor(() => expect(result.current?.items).toHaveLength(1));
    for (let i = 0; i < 100; i++) rerender({ ...a, source: { ...a.source! }, selfEmails: [...a.selfEmails] });
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it("another mailbox with the same thread id is its own source: its own read, and the old answer is not shown for it", async () => {
    const a = base();
    const { result, rerender } = renderHook((p: Parameters<typeof useReplyRequirements>[0]) => useReplyRequirements(p), { initialProps: a });
    await waitFor(() => expect(result.current?.items).toHaveLength(1));
    rerender({ ...a, source: { account: "other@x.com", threadId: "t1", revision: "m2" }, selfEmails: ["other@x.com"] });
    // Not the first account's answer, at any moment.
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.items).toHaveLength(1));
    expect(a.complete).toHaveBeenCalledTimes(2);
  });

  it("no source (a new compose, a forward) looks nothing up", async () => {
    const a = base({ source: null });
    const { result } = renderHook(() => useReplyRequirements(a));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current).toBeUndefined();
    expect(a.complete).not.toHaveBeenCalled();
  });

  it("a source whose thread cannot be read shows nothing rather than guessing", async () => {
    const a = base({ thread: null, loadThread: async () => { throw new Error("offline"); } });
    const { result } = renderHook(() => useReplyRequirements(a));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current).toBeUndefined();
    expect(a.complete).not.toHaveBeenCalled();
  });

  it("an answer that arrives for a source the reply has since left is dropped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = { available: true, complete: vi.fn(async () => { await gate; return ANSWER; }) };
    const a = base({ ai: slow });
    const { result, rerender } = renderHook((p: Parameters<typeof useReplyRequirements>[0]) => useReplyRequirements(p), { initialProps: a });
    // The reply is closed (no source) before the read lands.
    rerender({ ...a, source: null });
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current).toBeUndefined();
  });
});
