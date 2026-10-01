// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { ProfileService } from "../profile/ProfileService";
import { subscribeToast } from "../shared/toast";
import AIControlPage from "../settings/AIControlPage";
import { AIService } from "./AIService";
import { effectiveLevel, aiCallAllowed, ADMIN_AI_CODE, ADMIN_AI_MESSAGE, AI_PIN_KEYS } from "./aiGate";
import { getAIControl, setAIControl, setAdminAiBlocked, isAdminAiBlocked } from "./levelStore";
import { fetchAdminAiAllowed } from "./useAdminAiGate";

// THE ADMIN SWITCH FOR AI, in the app (Dave 2026-09-30). The proxy refuses
// regardless (aiProxyAdminSwitch.test.ts); these pin what the app does so it
// never offers what cannot work and says why.

afterEach(() => { vi.restoreAllMocks(); setAdminAiBlocked(false); setAIControl(undefined); });

describe("the level store under an admin block", () => {
  it("reads Off everywhere, every pin too, so no feature can run", () => {
    setAIControl({ level: "everything", pins: { emailDrafts: "everything" } });
    setAdminAiBlocked(true);
    expect(isAdminAiBlocked()).toBe(true);
    expect(getAIControl().level).toBe("off");
    for (const k of AI_PIN_KEYS) {
      expect(aiCallAllowed(effectiveLevel(getAIControl(), k), false)).toBe(false);
      expect(aiCallAllowed(effectiveLevel(getAIControl(), k), true)).toBe(false);
    }
  });

  it("keeps the user's own choice underneath and gives it straight back when the admin turns AI on", () => {
    setAIControl({ level: "request", pins: { morningPlan: "off" } });
    setAdminAiBlocked(true);
    setAIControl({ level: "request", pins: { morningPlan: "off" } }); // a profile reload mid-block must not lift it
    expect(getAIControl().level).toBe("off");
    setAdminAiBlocked(false);
    expect(getAIControl()).toEqual({ level: "request", pins: { morningPlan: "off" } });
  });
});

describe("AIService under an admin block", () => {
  const ok = () => new Response(JSON.stringify({ text: "hi" }), { status: 200 });

  it("refuses locally with the admin reason and sends nothing", async () => {
    const f = vi.fn(async () => ok());
    const svc = new AIService({ available: true, getToken: () => "t", fetchImpl: f as never });
    setAdminAiBlocked(true);
    await expect(svc.complete([{ role: "user", content: "x" }])).rejects.toThrow(ADMIN_AI_MESSAGE);
    expect(f).not.toHaveBeenCalled();
  });

  it("a session that did not know yet learns from the server's coded refusal and stops trying", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: ADMIN_AI_MESSAGE, code: ADMIN_AI_CODE }), { status: 403 }));
    const svc = new AIService({ available: true, getToken: () => "t", fetchImpl: f as never });
    await expect(svc.complete([{ role: "user", content: "x" }])).rejects.toThrow(ADMIN_AI_MESSAGE);
    expect(isAdminAiBlocked()).toBe(true);
    await expect(svc.complete([{ role: "user", content: "again" }])).rejects.toThrow(ADMIN_AI_MESSAGE);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("an ordinary 403 is not mistaken for the admin switch", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "AI is turned off in Settings." }), { status: 403 }));
    const svc = new AIService({ available: true, getToken: () => "t", fetchImpl: f as never });
    await expect(svc.complete([{ role: "user", content: "x" }])).rejects.toThrow(/AI request failed/);
    expect(isAdminAiBlocked()).toBe(false);
  });

  it("works as before when nothing is blocked", async () => {
    const svc = new AIService({ available: true, getToken: () => "t", fetchImpl: (async () => ok()) as never });
    setAIControl({ level: "everything" });
    await expect(svc.complete([{ role: "user", content: "x" }])).resolves.toBe("hi");
  });
});

describe("fetchAdminAiAllowed", () => {
  it("asks the cheap status answer with the session token", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ allowed: false }), { status: 200 }));
    expect(await fetchAdminAiAllowed("tok", f as never)).toBe(false);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/ai-usage?status=1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("a failed or odd answer changes nothing (null), because the proxy is the authority", async () => {
    expect(await fetchAdminAiAllowed("t", (async () => new Response("no", { status: 500 })) as never)).toBeNull();
    expect(await fetchAdminAiAllowed("t", (async () => new Response("{}", { status: 200 })) as never)).toBeNull();
    expect(await fetchAdminAiAllowed("t", (async () => { throw new Error("offline"); }) as never)).toBeNull();
  });
});

describe("Settings > AI Control on a blocked account", () => {
  it("shows Turned off by admin, and the user cannot turn it on or change a level", async () => {
    const save = vi.spyOn(ProfileService.prototype, "save").mockResolvedValue({} as never);
    const toasts: string[] = [];
    const stop = subscribeToast((t) => { if (t) toasts.push(t.message); });
    setAdminAiBlocked(true);
    render(<NotesProvider userId="u1"><AIControlPage onBack={() => {}} /></NotesProvider>);

    expect(screen.getByText("Turned off by admin")).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: "AI on or off" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(sw);
    fireEvent.click(sw.closest(".row")!);
    fireEvent.click(screen.getByText("Everything").closest(".row")!);
    await waitFor(() => expect(toasts).toContain("Turned off by admin"));

    expect(save).not.toHaveBeenCalled();
    expect(getAIControl().level).toBe("off");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    stop();
  });

  it("comes back to the normal switch the moment the admin turns AI on", async () => {
    vi.spyOn(ProfileService.prototype, "save").mockResolvedValue({} as never);
    setAdminAiBlocked(true);
    render(<NotesProvider userId="u1"><AIControlPage onBack={() => {}} /></NotesProvider>);
    expect(screen.getByText("Turned off by admin")).toBeInTheDocument();
    act(() => setAdminAiBlocked(false));
    await waitFor(() => expect(screen.queryByText("Turned off by admin")).toBeNull());
    expect(screen.getByRole("switch", { name: "AI on or off" }).getAttribute("aria-disabled")).toBeNull();
  });
});
