// @vitest-environment jsdom
// SHELL-F-14 (2026-09-05): AI Control had no test file. The level applied to
// the session the instant it was tapped and the profile write behind it was
// unguarded, so a failed save left the running app at one level and the next
// launch at another, with nothing on screen having said a word. This is the
// setting that decides what JARVIS may do on its own, so a silent
// disagreement about it is the worst one in the app.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { ProfileService } from "../profile/ProfileService";
import { subscribeToast } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import { getAIControl, setAIControl } from "../ai/levelStore";
import { DEFAULT_AI_LEVEL } from "../ai/aiGate";
import AIControlPage from "./AIControlPage";

afterEach(() => { vi.restoreAllMocks(); setAIControl(undefined); });

describe("AIControlPage", () => {
  it("a level that could not be saved goes back, in this session too", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    vi.spyOn(ProfileService.prototype, "save").mockRejectedValue(new Error("network"));
    render(<NotesProvider userId="u1"><AIControlPage onBack={() => {}} /></NotesProvider>);

    const row = screen.getByText("Everything").closest(".row")!;
    fireEvent.click(row);
    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));

    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(getAIControl().level).toBe(DEFAULT_AI_LEVEL);
    stop();
  });

  it("a level that saved stays put", async () => {
    vi.spyOn(ProfileService.prototype, "save").mockResolvedValue({} as never);
    render(<NotesProvider userId="u1"><AIControlPage onBack={() => {}} /></NotesProvider>);
    const row = screen.getByText("Everything").closest(".row")!;
    fireEvent.click(row);
    await waitFor(() => expect(row.getAttribute("aria-checked")).toBe("true"));
    expect(getAIControl().level).toBe("everything");
  });
});

// THE SPENDING LIMIT (Dave, 2026-09-28). The screen shows what the SERVER
// holds, saves with one explicit tap, and goes back to the server's number on
// any failure. No write per keystroke, no hopeful local balance.
describe("AIControlPage spending limit", () => {
  const BUDGET = { limitMicrousd: 5_000_000, spentMicrousd: 780_000, heldMicrousd: 0, remainingMicrousd: 4_220_000, period: "since_activation", periodStart: "2026-09-29T12:00:00Z", version: 3, paused: false };
  let patches: { limitMicrousd: number; expectedVersion: number }[] = [];
  let patchReply: () => Response = () => new Response("{}", { status: 500 });

  function stubApi(budget: typeof BUDGET | null = BUDGET) {
    patches = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return patchReply(); }
      if (String(input).includes("/api/ai-usage")) return new Response(JSON.stringify({ count: 0, calls: [], tokens: [], budget }), { status: 200 });
      return new Response("{}", { status: 200 });
    }));
  }
  const mount = () => render(<NotesProvider userId="u1" accessToken="tok"><AIControlPage onBack={() => {}} /></NotesProvider>);
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows the real remaining balance and when it started", async () => {
    stubApi();
    mount();
    expect(await screen.findByText("$4.22 remaining of $5")).toBeInTheDocument();
    expect(screen.getByText(/^Since /)).toBeInTheDocument();
  });

  it("shows nothing when the server has no budget to report", async () => {
    stubApi(null);
    mount();
    await waitFor(() => expect(screen.getByText("AI Calls Today")).toBeInTheDocument());
    expect(screen.queryByText("AI Spending Limit")).toBeNull();
  });

  it("names pending holds when there are any", async () => {
    stubApi({ ...BUDGET, heldMicrousd: 120_001 });
    mount();
    expect(await screen.findByText("$0.13 held")).toBeInTheDocument();
  });

  it("Save is inert until the field differs, and typing writes nothing", async () => {
    stubApi();
    mount();
    const field = await screen.findByLabelText("Limit in dollars");
    const save = screen.getByText("Save Limit").closest(".row")!;
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(field, { target: { value: "8" } });
    fireEvent.change(field, { target: { value: "8.5" } });
    expect(patches).toEqual([]);
    expect(save.getAttribute("aria-disabled")).toBeNull();
  });

  it("one Save sends the exact micro-USD and the version the screen saw, then shows the server's answer", async () => {
    stubApi();
    patchReply = () => new Response(JSON.stringify({ budget: { ...BUDGET, limitMicrousd: 8_500_000, remainingMicrousd: 7_720_000, version: 4 } }), { status: 200 });
    mount();
    const field = await screen.findByLabelText("Limit in dollars");
    fireEvent.change(field, { target: { value: "8.50" } });
    fireEvent.click(screen.getByText("Save Limit").closest(".row")!);
    await waitFor(() => expect(screen.getByText("$7.72 remaining of $8.50")).toBeInTheDocument());
    expect(patches).toEqual([{ limitMicrousd: 8_500_000, expectedVersion: 3 }]);
    expect((field as HTMLInputElement).value).toBe("8.50");
  });

  it("a failed save puts the field back to what is really in force", async () => {
    stubApi();
    patchReply = () => new Response(JSON.stringify({ error: "AI paused. The spending limit could not be checked.", code: "AI_BUDGET_UNAVAILABLE" }), { status: 503 });
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    mount();
    const field = (await screen.findByLabelText("Limit in dollars")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.click(screen.getByText("Save Limit").closest(".row")!);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(field.value).toBe("5");
    expect(screen.getByText("$4.22 remaining of $5")).toBeInTheDocument();
    stop();
  });

  it("a version conflict shows the limit that is really saved", async () => {
    stubApi();
    patchReply = () => new Response(JSON.stringify({ error: "Your limit changed somewhere else. Reload and try again.", code: "VERSION_CONFLICT", budget: { ...BUDGET, limitMicrousd: 6_000_000, remainingMicrousd: 5_220_000, version: 9 } }), { status: 409 });
    mount();
    const field = (await screen.findByLabelText("Limit in dollars")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.click(screen.getByText("Save Limit").closest(".row")!);
    await waitFor(() => expect(field.value).toBe("6"));
  });

  it("says AI paused at the cap, and off at zero", async () => {
    stubApi({ ...BUDGET, spentMicrousd: 5_000_000, remainingMicrousd: 0 });
    const { unmount } = mount();
    expect(await screen.findByText("AI paused. You reached your $5 limit.")).toBeInTheDocument();
    unmount();
    stubApi({ ...BUDGET, limitMicrousd: 0, remainingMicrousd: 0 });
    mount();
    expect(await screen.findByText("AI is off. Your spending limit is $0.")).toBeInTheDocument();
  });

  it("refuses text it will not save", async () => {
    stubApi();
    mount();
    const field = await screen.findByLabelText("Limit in dollars");
    fireEvent.change(field, { target: { value: "5.999" } });
    expect(screen.getByText("Save Limit").closest(".row")!.getAttribute("aria-disabled")).toBe("true");
  });
});
