// @vitest-environment jsdom
// THE SPEECH BOX, app half: Speak records, the clip goes to the server, the words land in the editable draft ONCE, and the hook
// commits nothing. A missing provider, a refused microphone and silence are each said in words.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRef, useState } from "react";
import Dictate from "../shared/Dictate";
import { spokenInto } from "../shared/useDictation";
import { transcribeAudio, TranscribeError } from "./transcribeClient";
import { audioExtension, transcribeLine } from "./wire";

vi.mock("../data/store", () => ({ backendConfigured: true }));
vi.mock("../auth/AuthProvider", () => ({ useOptionalSession: () => ({ access_token: "tok" }) }));
vi.mock("../shared/toast", () => ({ showToast: vi.fn() }));

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: unknown) { FakeRecorder.last = this; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(1200)], { type: this.mimeType }) });
    this.onstop?.();
  }
}
const track = { stop: vi.fn() };

function plant(getUserMedia?: () => Promise<unknown>) {
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getUserMedia ?? (async () => ({ getTracks: () => [track] })) },
  });
}
function unplant() {
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
}

function Harness({ onSpoken }: { onSpoken?: (t: string, f: boolean) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState("");
  const base = useRef<string | null>(null);
  return (
    <>
      <textarea ref={ref} aria-label="Message" value={text} onChange={(e) => { base.current = null; setText(e.target.value); }} />
      <Dictate target={ref} onText={(w, f) => { onSpoken?.(w, f); setText((cur) => spokenInto(base, cur, w, f)); }} />
    </>
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
function serverSays(body: unknown, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => { track.stop.mockReset(); FakeRecorder.last = null; });
afterEach(() => { cleanup(); unplant(); vi.unstubAllGlobals(); });

describe("Speak records, and the words land in the draft", () => {
  it("records on a tap, sends the clip with the speech header, and writes the words once", async () => {
    plant();
    const f = serverSays({ text: "Call Marco about Thursday" });
    const spoken = vi.fn();
    render(<Harness onSpoken={spoken} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    expect(screen.getByRole("button", { name: "Listening" })).toHaveAttribute("aria-pressed", "true");
    expect(FakeRecorder.last!.state).toBe("recording");
    fireEvent.click(screen.getByRole("button", { name: "Listening" }));
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["x-jarvis-transcribe"]).toBe("1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("audio/webm");
    expect(screen.getByLabelText("Message")).toHaveValue("Call Marco about Thursday");
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith("Call Marco about Thursday", true);
    expect(track.stop).toHaveBeenCalled(); // the microphone is released
    expect(screen.getByRole("button", { name: "Speak" })).toBeInTheDocument();
  });

  it("appends to what is already typed rather than replacing it", async () => {
    plant();
    serverSays({ text: "and bring the charger" });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Packing list" } });
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Listening" }));
    await settle();
    expect(screen.getByLabelText("Message")).toHaveValue("Packing list and bring the charger");
  });

  it("says Writing It Down while the server works, and ignores a tap meanwhile", async () => {
    plant();
    let release: (r: Response) => void = () => {};
    const f = vi.fn(() => new Promise<Response>((r) => { release = r; }));
    vi.stubGlobal("fetch", f);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Listening" }));
    await settle();
    const busy = screen.getByRole("button", { name: "Writing It Down" });
    fireEvent.click(busy);
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.last!.state).toBe("inactive");
    await act(async () => { release(new Response(JSON.stringify({ text: "ok" }))); });
    await settle();
    expect(screen.getByLabelText("Message")).toHaveValue("ok");
  });

  it("says when voice is not set up on the server, in words, and writes nothing", async () => {
    plant();
    serverSays({ error: "x", code: "TRANSCRIBE_NOT_CONFIGURED" }, 503);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Listening" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Voice Isn't Set Up Yet · Use the Keyboard Mic");
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("says Nothing Heard when the server hears nothing", async () => {
    plant();
    serverSays({ text: "" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Listening" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing Heard, Try Again");
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("says so when the microphone is refused, and records nothing", async () => {
    plant(async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); });
    const f = serverSays({ text: "never" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Allow the Microphone in Settings to Speak");
    expect(f).not.toHaveBeenCalled();
  });

  it("a second tap that lands while the microphone is still being granted still stops it", async () => {
    let grant: (s: unknown) => void = () => {};
    plant(() => new Promise((r) => { grant = r; }));
    serverSays({ text: "quick one" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    fireEvent.click(screen.getByRole("button", { name: "Listening" }));
    await act(async () => { grant({ getTracks: () => [track] }); });
    await settle();
    expect(screen.getByLabelText("Message")).toHaveValue("quick one");
  });

  it("drops the words and releases the microphone when the screen is left mid-recording", async () => {
    plant();
    const f = serverSays({ text: "late" });
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    await settle();
    unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("the client call", () => {
  const blob = new Blob([new Uint8Array(10)], { type: "audio/mp4" });
  it("needs a signed-in session", async () => {
    await expect(transcribeAudio(blob, { token: undefined, fetchImpl: vi.fn() })).rejects.toMatchObject({ code: "TRANSCRIBE_AUTH" });
  });
  it("reads the server's code, and reads an AI Control refusal as Off", async () => {
    const off = vi.fn(async () => new Response(JSON.stringify({ error: "AI is off", code: "AI_OFF" }), { status: 403 }));
    await expect(transcribeAudio(blob, { token: "t", fetchImpl: off as unknown as typeof fetch })).rejects.toMatchObject({ code: "TRANSCRIBE_OFF", retryable: false });
    const busy = vi.fn(async () => new Response("", { status: 502 }));
    await expect(transcribeAudio(blob, { token: "t", fetchImpl: busy as unknown as typeof fetch })).rejects.toMatchObject({ code: "TRANSCRIBE_BUSY", retryable: true });
    const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(transcribeAudio(blob, { token: "t", fetchImpl: down as unknown as typeof fetch })).rejects.toBeInstanceOf(TranscribeError);
  });
});

describe("the shared words", () => {
  it("knows the audio types phones write", () => {
    expect(audioExtension("audio/mp4")).toBe("m4a");
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtension("image/png")).toBeNull();
  });
  it("every line is Title Case fragments with the fix second, and an unknown code still says something", () => {
    expect(transcribeLine("TRANSCRIBE_TOO_LARGE")).toBe("That Was Too Long · Try a Shorter Clip");
    expect(transcribeLine("NOPE")).toBe("Voice Stopped · Try Again");
  });
});
