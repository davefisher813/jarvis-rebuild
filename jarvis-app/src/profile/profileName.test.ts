// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { announceProfileName, onProfileName } from "./profileName";

describe("profileName", () => {
  it("tells every listener the new name", () => {
    const a = vi.fn(); const b = vi.fn();
    const stopA = onProfileName(a); const stopB = onProfileName(b);
    announceProfileName("Dave F");
    expect(a).toHaveBeenCalledWith("Dave F");
    expect(b).toHaveBeenCalledWith("Dave F");
    stopA(); stopB();
  });

  it("stops telling a listener that has gone", () => {
    const a = vi.fn();
    onProfileName(a)();
    announceProfileName("Nobody");
    expect(a).not.toHaveBeenCalled();
  });
});
