// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import TodayFlow from "./TodayFlow";

// THE CATALOG HARD GATE (Dave 2026-10-05), Today's own lines. The welcome-back
// receipt joined three parts with ". " and a capital ("Welcome Back. Start With
// One?"): a sentence boundary the short-copy rule bans in any drawn string, and
// a small word capitalised mid-line. It is one phrase now.
vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

function mount() {
  return render(
    <NotesProvider userId={"today-catalog-" + Math.random().toString(36).slice(2)}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

describe("TodayFlow: the welcome-back receipt", () => {
  it("says Welcome Back, Start with One? as one phrase with no sentence boundary", async () => {
    localStorage.setItem("jarvis.lastseen.v1", "2020-01-01");
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("[data-receipt] .rl-t")).not.toBeNull());
    const line = container.querySelector("[data-receipt] .rl-t")!.textContent!;
    expect(line).toBe("Welcome Back, Start with One?");
    expect(line, "no sentence boundary in a drawn line").not.toMatch(/[.?!] [A-Z]/);
  });
});
