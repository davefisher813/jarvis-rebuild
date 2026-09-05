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
