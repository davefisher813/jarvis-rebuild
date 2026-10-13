// @vitest-environment jsdom
//
// FOCUS OPENS WHEN ASKED, NOT WHEN YOU COME BACK (audit 2026-09-29). Today
// remounts on every visit. The shell's one-shot clear() gives the value back
// but leaves the nonce, and Today keyed on the nonce alone, so a dismissed
// Focus panel opened itself again the next time he returned to Today.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { useOneShot } from "../shell/intents";
import TodayFlow from "./TodayFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false }) }));
// The panel itself is not under test: only whether Today opens it, and what Today does when the panel answers. It hands back
// the doors Today gave it (15 Min, Start Now) and shows the live block Today passes it.
vi.mock("../upnext/UpNextFlow", () => ({
  default: ({ onClose, onFifteen, onStartNow, fifteen }: {
    onClose: () => void;
    onFifteen?: (t: unknown) => unknown;
    onStartNow?: (id: string) => void;
    fifteen?: { clock: string; line: string } | null;
  }) => (
    <div>
      FOCUS PANEL
      <button onClick={onClose}>Close Focus</button>
      <button onClick={() => void onFifteen?.({ id: "t-fifteen", data: { text: "Call the bank", category: "", done: false, due: null } })}>Fifteen</button>
      <button onClick={() => onStartNow?.("t-start")}>Start It</button>
      {fifteen && <span>RUNNING {fifteen.clock} / {fifteen.line}</span>}
    </div>
  ),
}));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// AppShell in miniature: Today is mounted per visit, focusIntent is the shell's.
const startNow = vi.fn();
function Shell() {
  const focus = useOneShot<boolean>();
  const [tab, setTab] = useState<"today" | "other">("today");
  return (
    <>
      <button onClick={() => { focus.fire(true); setTab("today"); }}>bolt</button>
      <button onClick={() => setTab("other")}>go other</button>
      <button onClick={() => setTab("today")}>go today</button>
      {tab === "today"
        ? <TodayFlow focusOpen={focus.value === true} focusNonce={focus.nonce} onFocusOpened={focus.clear} onStartNow={startNow} onGoSchedule={() => {}} onGoTasks={() => {}} />
        : <div>the other tab</div>}
    </>
  );
}

describe("Today: the Focus panel", () => {
  it("opens when asked, and stays closed when he comes back after dismissing it", async () => {
    render(
      <NotesProvider userId="u-focus-reopen">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Shell />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    expect(screen.queryByText("FOCUS PANEL")).toBeNull();
    fireEvent.click(screen.getByText("bolt"));
    expect(await screen.findByText("FOCUS PANEL")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close Focus"));
    await waitFor(() => expect(screen.queryByText("FOCUS PANEL")).toBeNull());

    fireEvent.click(screen.getByText("go other"));
    fireEvent.click(screen.getByText("go today"));
    // Let Today mount and settle; nothing should ask for the panel.
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText("FOCUS PANEL")).toBeNull();

    // And it still opens when asked again.
    fireEvent.click(screen.getByText("bolt"));
    expect(await screen.findByText("FOCUS PANEL")).toBeInTheDocument();
  });
});

// 15 MIN KEEPS FOCUS OPEN (issue 108, Dave 2026-10-13: Focus is the whole screen and the countdown runs there). It used to close
// Focus at once and land him on Today's headliner. The block still begins (Today owns it), the screen stays, and the live block
// reaches the panel so the number can tick; Close and Start Now still leave. TO GO BACK TO CLOSING: TodayFlow's onFifteen for
// UpNextFlow becomes `(t) => { setUpNextOpen(false); void startFifteen(t); }`, and the first assertion below is the one to flip.
describe("Today: 15 Min from the Focus panel (issue 108)", () => {
  const mountShell = () => render(
    <NotesProvider userId={"u-focus-fifteen-" + Math.random().toString(36).slice(2)}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <Shell />
      </GoogleSessionProvider>
    </NotesProvider>,
  );

  it("starts the block and leaves the panel open, showing the live clock Today passes it", async () => {
    localStorage.removeItem("jarvis.today.fifteen.v1");
    mountShell();
    fireEvent.click(screen.getByText("bolt"));
    expect(await screen.findByText("FOCUS PANEL")).toBeInTheDocument();
    expect(screen.queryByText(/RUNNING/)).toBeNull();
    fireEvent.click(screen.getByText("Fifteen"));
    // the block begins: Today wrote it, and passed the panel the number and the line
    expect(await screen.findByText(/RUNNING \d+:\d\d \/ \d+:\d\d Left/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("jarvis.today.fifteen.v1") ?? "{}").taskId).toBe("t-fifteen");
    // ...and the panel is still there: 15 Min no longer closes it
    expect(screen.getByText("FOCUS PANEL")).toBeInTheDocument();
    // Close is still the way out, and the block keeps running on Today
    fireEvent.click(screen.getByText("Close Focus"));
    await waitFor(() => expect(screen.queryByText("FOCUS PANEL")).toBeNull());
    expect(localStorage.getItem("jarvis.today.fifteen.v1")).not.toBeNull();
    localStorage.removeItem("jarvis.today.fifteen.v1");
  });

  it("Start Now still closes the panel and hands the task to the Start screen", async () => {
    localStorage.removeItem("jarvis.today.fifteen.v1");
    startNow.mockClear();
    mountShell();
    fireEvent.click(screen.getByText("bolt"));
    expect(await screen.findByText("FOCUS PANEL")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Start It"));
    expect(startNow).toHaveBeenCalledWith("t-start");
    await waitFor(() => expect(screen.queryByText("FOCUS PANEL")).toBeNull());
  });
});
