// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRef } from "react";
import Dictate, { DICTATION_HINT, hintSeen } from "./Dictate";

const showToast = vi.fn();
vi.mock("./toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

// UP-MIND-26, chosen option: lean on the keyboard's own dictation. A pointer,
// not a feature: it focuses the field and says where the mic is, once, and
// promises nothing it does not do.
function Harness() {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <>
      <textarea ref={ref} aria-label="Message" />
      <Dictate target={ref} />
    </>
  );
}

beforeEach(() => { showToast.mockReset(); localStorage.clear(); });

describe("Speak", () => {
  it("focuses the field, which is what raises the keyboard", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Message"));
  });

  it("says where the mic is the first time, and never again on this device", () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    expect(showToast).toHaveBeenCalledWith({ message: DICTATION_HINT });
    expect(hintSeen()).toBe(true);
    showToast.mockReset();
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    expect(showToast).not.toHaveBeenCalled();
    unmount();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    expect(showToast).not.toHaveBeenCalled();
  });

  // It is a pointer at the system keyboard, so it must not claim to be
  // listening: nothing here records, transcribes, or sends.
  it("promises only what it does", () => {
    expect(DICTATION_HINT).toBe("Tap the mic on your keyboard to talk");
  });
});
