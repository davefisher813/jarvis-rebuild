// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { dismissSuggestion, isSuggestionDismissed, suggestionKey } from "./suggestionMemory";

afterEach(() => vi.restoreAllMocks());

describe("Not Now is remembered for the session", () => {
  it("keys the pattern, not the bill, so next month's bill stays quiet", () => {
    expect(suggestionKey({ vendor: " ConEdison ", amountCents: 8412 })).toBe(suggestionKey({ vendor: "conedison", amountCents: 8412 }));
    expect(suggestionKey({ vendor: "ConEdison", amountCents: 8412 })).not.toBe(suggestionKey({ vendor: "ConEdison", amountCents: 9000 }));
  });
  it("a dismissed pattern stays dismissed, and an untouched one does not", () => {
    const k = suggestionKey({ vendor: "Memory Test Co", amountCents: 1234 });
    expect(isSuggestionDismissed(k)).toBe(false);
    dismissSuggestion(k);
    expect(isSuggestionDismissed(k)).toBe(true);
    expect(isSuggestionDismissed(suggestionKey({ vendor: "Other Co", amountCents: 1234 }))).toBe(false);
  });
  it("survives a blocked sessionStorage: memory still holds for the session", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const k = suggestionKey({ vendor: "Blocked Co", amountCents: 500 });
    expect(() => dismissSuggestion(k)).not.toThrow();
    expect(isSuggestionDismissed(k)).toBe(true);
  });
  it("is read back from sessionStorage when the page was reloaded within the session", () => {
    const k = suggestionKey({ vendor: "Reloaded Co", amountCents: 700 });
    sessionStorage.setItem("jarvis.money.recurring.dismissed.v1", JSON.stringify([k]));
    expect(isSuggestionDismissed(k)).toBe(true);
  });
});
