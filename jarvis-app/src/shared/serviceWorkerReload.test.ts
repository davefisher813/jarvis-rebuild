import { describe, it, expect, vi } from "vitest";
import { reloadOnWorkerUpdate } from "./serviceWorkerReload";

// A fake ServiceWorkerContainer: controller is whatever the page started under,
// and `fire` is the browser announcing that the controller changed.
function container(controller: unknown) {
  let handler: () => void = () => {};
  return {
    controller: controller as ServiceWorker | null,
    addEventListener: (_: string, h: EventListenerOrEventListenerObject) => { handler = h as () => void; },
    fire: () => handler(),
  };
}

describe("reloadOnWorkerUpdate", () => {
  it("does not reload when the first worker claims a page that had none (a first visit)", () => {
    const reload = vi.fn();
    const c = container(null);
    reloadOnWorkerUpdate(c, reload);
    c.fire();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when a new worker replaces the one the page was running under (a deploy)", () => {
    const reload = vi.fn();
    const c = container({});
    reloadOnWorkerUpdate(c, reload);
    c.fire();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once, however many times the controller changes after that", () => {
    const reload = vi.fn();
    const c = container({});
    reloadOnWorkerUpdate(c, reload);
    c.fire(); c.fire(); c.fire();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a first visit that is later updated in the same session still reloads for the update", () => {
    const reload = vi.fn();
    const c = container(null);
    reloadOnWorkerUpdate(c, reload);
    c.fire(); // the first claim: no reload
    expect(reload).not.toHaveBeenCalled();
    c.fire(); // a deploy while the tab stays open
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
