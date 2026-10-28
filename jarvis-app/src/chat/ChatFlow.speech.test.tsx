// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useChat } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import type { AIService } from "../ai/AIService";

// THE SPEECH BOX IN THE CHAT (2026-10-27). The mic records, the server writes the words down, they land in the box as a draft, and
// NOTHING is sent: no message is stored and the AI is not asked until the person taps Send.

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const ai = vi.hoisted(() => ({ available: true, complete: vi.fn() }));
vi.mock("../ai/useAI", () => ({ useAI: () => ai as unknown as AIService }));
vi.mock("../shared/toast", () => ({ showToast: () => {} }));
vi.mock("../data/store", async (orig) => ({ ...(await orig<object>()), backendConfigured: true }));
vi.mock("../auth/AuthProvider", async (orig) => ({ ...(await orig<object>()), useOptionalSession: () => ({ access_token: "tok" }) }));

class FakeRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/mp4";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(900)], { type: "audio/mp4" }) }); this.onstop?.(); }
}

let chatRef: ReturnType<typeof useChat> | null = null;
function Capture() { chatRef = useChat(); return null; }
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  ai.complete.mockReset();
  chatRef = null;
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
});
afterEach(() => {
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  vi.unstubAllGlobals();
});

describe("speaking into the chat box", () => {
  it("fills the box with the words and sends nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "remind me to call the dentist" }))));
    render(<NotesProvider userId="u-speech-chat"><Capture /><ChatFlow /></NotesProvider>);
    const box = await screen.findByPlaceholderText("Ask, Tell or Paste");
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    expect(screen.getByRole("button", { name: "Stop Listening" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Stop Listening" }));
    await waitFor(() => expect(box).toHaveValue("remind me to call the dentist"));
    expect(ai.complete).not.toHaveBeenCalled();
    expect((await chatRef!.list()).filter((m) => m.data.role === "user")).toEqual([]);
    // Editable: the person can change it before Send.
    fireEvent.change(box, { target: { value: "remind me to call the dentist Friday" } });
    expect(box).toHaveValue("remind me to call the dentist Friday");
  });

  it("says when voice is not set up, and leaves the box alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x", code: "TRANSCRIBE_NOT_CONFIGURED" }), { status: 503 })));
    render(<NotesProvider userId="u-speech-chat-2"><Capture /><ChatFlow /></NotesProvider>);
    const box = await screen.findByPlaceholderText("Ask, Tell or Paste");
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Stop Listening" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Voice Isn't Set Up Yet · Use the Keyboard Mic");
    expect(box).toHaveValue("");
  });
});
