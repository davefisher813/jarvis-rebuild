import { describe, it, expect, vi, beforeEach } from "vitest";

// The native half of the haptics vocabulary (Apple sprint, haptics,
// 2026-10-10): each feel asks iOS for one specific Taptic pattern, so the
// phone answers the same kind of tap the same way everywhere.
const calls: string[] = [];
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/haptics", () => ({
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING" },
  Haptics: {
    impact: async (o: { style: string }) => { calls.push("impact:" + o.style); },
    notification: async (o: { type: string }) => { calls.push("notification:" + o.type); },
    selectionStart: async () => { calls.push("selectionStart"); },
    selectionChanged: async () => { calls.push("selectionChanged"); },
    selectionEnd: async () => { calls.push("selectionEnd"); },
  },
}));

import { haptics } from "./haptics";
import { DEFAULT_FEEDBACK, setLiveFeedback } from "../encourage/prefs";

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("native haptics", () => {
  beforeEach(() => { calls.length = 0; setLiveFeedback({ ...DEFAULT_FEEDBACK }); });

  it("confirm is a light impact", async () => {
    haptics.confirm();
    await settle();
    expect(calls).toEqual(["impact:LIGHT"]);
  });

  it("selection is the selection tick", async () => {
    haptics.selection();
    await settle();
    expect(calls).toEqual(["selectionStart", "selectionChanged", "selectionEnd"]);
  });

  it("success is the success notification, and only when chosen", async () => {
    haptics.success();
    await settle();
    expect(calls).toEqual([]);
    setLiveFeedback({ ...DEFAULT_FEEDBACK, haptics: true });
    haptics.success();
    await settle();
    expect(calls).toEqual(["notification:SUCCESS"]);
  });

  it("impact stays the medium beat the gym timers use", async () => {
    haptics.impact();
    await settle();
    expect(calls).toEqual(["impact:MEDIUM"]);
  });
});
