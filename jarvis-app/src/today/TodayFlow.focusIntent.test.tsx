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
// The panel itself is not under test: only whether Today opens it.
vi.mock("../upnext/UpNextFlow", () => ({
  default: ({ onClose }: { onClose: () => void }) => <div>FOCUS PANEL<button onClick={onClose}>Close Focus</button></div>,
}));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// AppShell in miniature: Today is mounted per visit, focusIntent is the shell's.
function Shell() {
  const focus = useOneShot<boolean>();
  const [tab, setTab] = useState<"today" | "other">("today");
  return (
    <>
      <button onClick={() => { focus.fire(true); setTab("today"); }}>bolt</button>
      <button onClick={() => setTab("other")}>go other</button>
      <button onClick={() => setTab("today")}>go today</button>
      {tab === "today"
        ? <TodayFlow focusOpen={focus.value === true} focusNonce={focus.nonce} onFocusOpened={focus.clear} onGoSchedule={() => {}} onGoTasks={() => {}} />
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
