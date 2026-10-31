// @vitest-environment jsdom
// THE SPEECH BOX RECORDS (2026-10-31): opened from the mic (or the one-step link) it is already recording, proves it with the
// recording card, turns the clip into words ONCE in the editable draft, and saves nothing until his tap. A failed transcription
// keeps the clip and offers it again.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useNotes, useTasks } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";
import { readCaptureLink, withoutCaptureLink } from "./captureLink";
import type React from "react";

vi.mock("../data/store", async (orig) => ({ ...(await orig<typeof import("../data/store")>()), backendConfigured: true }));
vi.mock("../auth/AuthProvider", async (orig) => ({ ...(await orig<typeof import("../auth/AuthProvider")>()), useOptionalSession: () => ({ access_token: "tok" }) }));
vi.mock("../shared/toast", () => ({ showToast: vi.fn() }));

class FakeRecorder {
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: unknown) {}
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(1200)], { type: this.mimeType }) }); this.onstop?.(); }
}
function plant() {
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) } });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const refs: { notes: ReturnType<typeof useNotes> | null; tasks: ReturnType<typeof useTasks> | null } = { notes: null, tasks: null };
function Grab({ children }: { children: React.ReactNode }) { refs.notes = useNotes(); refs.tasks = useTasks(); return <>{children}</>; }

beforeEach(() => { localStorage.clear(); plant(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder; });

describe("Opened from the mic, the box is already recording", () => {
  it("Listening and Done Talking show at once; the words land in the box; nothing is saved until the tap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "Dinner with Marco Thursday 7 p.m." }), { status: 200 })));
    render(<NotesProvider userId="u-rec-1"><Grab><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} listen /></Grab></NotesProvider>);
    await settle();
    expect(document.querySelector(".rec-state")).toHaveTextContent("Listening");
    expect(screen.getByRole("button", { name: "Listening" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Capture" }), "one red while it records").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done Talking" }));
    await waitFor(() => expect((screen.getByLabelText("Paste or Type") as HTMLTextAreaElement).value).toBe("Dinner with Marco Thursday 7 p.m."));
    // The read says what it will be BEFORE the tap: an Event, on the day and at the time.
    expect(await refs.tasks!.listTasks()).toHaveLength(0);
    expect(await refs.notes!.listNotes()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Capture" })).toBeInTheDocument();
  });

  it("a transcription that failed on the network keeps the clip, and Try Again sends the same clip", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ text: "Call Marco About the Field" }), { status: 200 });
    }));
    render(<NotesProvider userId="u-rec-2"><Grab><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} listen /></Grab></NotesProvider>);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Done Talking" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Type Instead" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    await waitFor(() => expect((screen.getByLabelText("Paste or Type") as HTMLTextAreaElement).value).toBe("Call Marco About the Field"));
    expect(calls).toBe(2);
  });

  it("with no voice key on the server, it says so and never pretends to have heard anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x", code: "TRANSCRIBE_NOT_CONFIGURED", retryable: false }), { status: 503 })));
    render(<NotesProvider userId="u-rec-3"><Grab><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} listen /></Grab></NotesProvider>);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Done Talking" }));
    await waitFor(() => expect(screen.getByText(/Voice Isn't Set Up Yet/)).toBeInTheDocument());
    expect((screen.getByLabelText("Paste or Type") as HTMLTextAreaElement).value).toBe("");
  });
});

describe("Help with what to say", () => {
  it("an empty box offers three examples for the screen, and a tap puts one in the box without saving it", async () => {
    render(<NotesProvider userId="u-rec-4"><Grab><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} screen="schedule" /></Grab></NotesProvider>);
    const chip = screen.getByRole("button", { name: "Dinner with Sam Tomorrow at 7 PM" });
    fireEvent.click(chip);
    expect((screen.getByLabelText("Paste or Type") as HTMLTextAreaElement).value).toBe("Dinner with Sam Tomorrow at 7 PM");
    expect(await refs.tasks!.listTasks()).toHaveLength(0);
  });

  it("What Can I Say? lists every kind, and a tap fills the box", async () => {
    render(<NotesProvider userId="u-rec-5"><Grab><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} /></Grab></NotesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "What Can I Say?" }));
    const sheet = screen.getByRole("dialog", { name: "What Can I Say" });
    for (const k of ["Event", "Reminder", "Task", "Workout Set", "Question", "Money", "Fact", "Decision", "Note"]) expect(sheet).toHaveTextContent(k);
    fireEvent.click(screen.getByRole("button", { name: /Log Bench Press 225 for 8/ }));
    expect((screen.getByLabelText("Paste or Type") as HTMLTextAreaElement).value).toBe("Log Bench Press 225 for 8");
  });
});

describe("The one-step link", () => {
  it("opens the box recording or typing, and is taken out of the address after", () => {
    expect(readCaptureLink(new URL("https://x.app/capture?mode=voice"))).toBe("voice");
    expect(readCaptureLink(new URL("https://x.app/capture?mode=voice&autostart=1"))).toBe("voice");
    expect(readCaptureLink(new URL("https://x.app/capture"))).toBe("type");
    expect(readCaptureLink(new URL("https://x.app/?capture=voice"))).toBe("voice");
    expect(readCaptureLink(new URL("https://x.app/"))).toBeNull();
    expect(readCaptureLink(new URL("https://x.app/book/dave"))).toBeNull();
    expect(withoutCaptureLink(new URL("https://x.app/capture?mode=voice&autostart=1"))).toBe("/");
    expect(withoutCaptureLink(new URL("https://x.app/?capture=voice&x=1"))).toBe("/?x=1");
  });
});
