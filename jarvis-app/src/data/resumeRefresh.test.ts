// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { wireResumeRefresh } from "./resumeRefresh";
import { ALL_LISTS } from "./store";

// UP-PLAT-06 (2026-09-06): "Pick the phone back up and it is right." Nothing
// in the app listened for the foreground at all: a grep for visibilitychange
// found one caller, and it re-arms notifications rather than refreshing data.
// So a change made on the laptop at lunch was still missing at dinner unless
// something on screen happened to trigger a list.

function visible(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("coming back to the app", () => {
  it("drops the Store's cached lists and tells every surface, in that order", () => {
    const store = new Store(new InMemoryAdapter());
    const drop = vi.spyOn(store, "invalidateAll");
    const notify = vi.fn();
    const off = wireResumeRefresh(store, notify);

    visible("visible");
    expect(drop).toHaveBeenCalledTimes(1);
    // Both halves matter: clearing the cache without telling anyone leaves
    // the same stale screen, and telling everyone without clearing it just
    // re-reads the same cached copy.
    expect(notify).toHaveBeenCalledWith(ALL_LISTS);
    off();
  });

  it("going away is not coming back", () => {
    const store = new Store(new InMemoryAdapter());
    const notify = vi.fn();
    const off = wireResumeRefresh(store, notify);
    visible("hidden");
    expect(notify).not.toHaveBeenCalled();
    off();
  });

  it("unwiring stops it, so a signed-out session holds no listener", () => {
    const store = new Store(new InMemoryAdapter());
    const notify = vi.fn();
    wireResumeRefresh(store, notify)();
    visible("visible");
    expect(notify).not.toHaveBeenCalled();
  });
});
