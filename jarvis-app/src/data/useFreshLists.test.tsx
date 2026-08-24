// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useFreshLists } from "./useFreshLists";
import { notifyFreshLists } from "./store";

// The producer half of this pipe has worked since it shipped and had ZERO
// subscribers, so nothing ever proved the two ends fit together. `notify` is
// exactly what CachedAdapter calls when a background refresh finds changes.

function Probe({ types, onReload }: { types: string[]; onReload: () => void }) {
  useFreshLists(types, onReload);
  return null;
}

const fresh = (t: string) => act(() => notifyFreshLists(t));

describe("useFreshLists", () => {
  it("reloads when a background refresh reports a type this surface draws", () => {
    const onReload = vi.fn();
    render(<Probe types={["task"]} onReload={onReload} />);
    fresh("task");
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("ignores a type this surface does not draw", () => {
    const onReload = vi.fn();
    render(<Probe types={["task"]} onReload={onReload} />);
    fresh("event");
    expect(onReload).not.toHaveBeenCalled();
  });

  it("reloads for any of several types", () => {
    const onReload = vi.fn();
    render(<Probe types={["task", "event"]} onReload={onReload} />);
    fresh("event");
    fresh("task");
    expect(onReload).toHaveBeenCalledTimes(2);
  });

  it("stops listening once the surface unmounts", () => {
    const onReload = vi.fn();
    const { unmount } = render(<Probe types={["task"]} onReload={onReload} />);
    unmount();
    fresh("task");
    expect(onReload).not.toHaveBeenCalled();
  });

  // A caller passing an inline arrow is the normal case, and resubscribing on
  // every render would make this a leak rather than a fix.
  it("subscribes once even when the caller passes a new function every render", () => {
    let calls = 0;
    const { rerender } = render(<Probe types={["task"]} onReload={() => { calls++; }} />);
    rerender(<Probe types={["task"]} onReload={() => { calls++; }} />);
    rerender(<Probe types={["task"]} onReload={() => { calls++; }} />);
    fresh("task");
    expect(calls).toBe(1);
  });

  it("calls the LATEST reload, not the one captured when it subscribed", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe types={["task"]} onReload={first} />);
    rerender(<Probe types={["task"]} onReload={second} />);
    fresh("task");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does nothing when a surface names no types", () => {
    const onReload = vi.fn();
    render(<Probe types={[]} onReload={onReload} />);
    fresh("task");
    expect(onReload).not.toHaveBeenCalled();
  });

  it("leaves nothing behind, so unmounted surfaces cannot pile up", () => {
    const a = vi.fn(); const b = vi.fn();
    const one = render(<Probe types={["task"]} onReload={a} />);
    const two = render(<Probe types={["task"]} onReload={b} />);
    fresh("task");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    one.unmount(); two.unmount();
    fresh("task");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
