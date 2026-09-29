// @vitest-environment jsdom
// BRAIN "LOG IT" IN CHAT (2026-09-29): a message, Dave's or JARVIS's, files to
// the Brain through the one FilingSheet. Every case runs with AI OFF and with
// fetch trapped, because filing is manual and must never call a model.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useChat, useOptionalBrainMemory } from "../data/NotesProvider";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import ChatFlow from "./ChatFlow";
import type { AIService } from "../ai/AIService";
import type { BrainMemoryService } from "../ai/brainMemoryService";
import type { ChatService } from "./ChatService";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// AI is off: available false, and nothing on the filing path may read more.
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));

// The Brain service can be switched off per test to prove the doors vanish.
const gate = vi.hoisted(() => ({ brainOff: false }));
vi.mock("../data/NotesProvider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../data/NotesProvider")>();
  return { ...mod, useOptionalBrainMemory: () => (gate.brainOff ? null : mod.useOptionalBrainMemory()) };
});

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

let chatRef: ChatService | null = null;
let brainRef: BrainMemoryService | null = null;
function Grab() {
  chatRef = useChat();
  brainRef = useOptionalBrainMemory();
  return null;
}

const fetchTrap = vi.fn();
beforeEach(() => {
  showToast.mockReset();
  fetchTrap.mockReset();
  vi.stubGlobal("fetch", fetchTrap);
  gate.brainOff = false;
  chatRef = null;
  brainRef = null;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

interface Seed { role: "user" | "jarvis"; text: string; provenance?: { kind: "records" | "ai" | "action"; refs?: { kind: string; id: string; label: string }[] } }

async function openChat(seed: Seed[], onOpen?: (k: string, id: string) => void) {
  const user = "u-chatfile-" + Math.random().toString(36).slice(2);
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gate.brainOff ? chatRef : chatRef && brainRef).toBeTruthy());
  const ids: string[] = [];
  for (const s of seed) ids.push(await chatRef!.append(s));
  view.rerender(<NotesProvider userId={user}><Grab /><ChatFlow {...(onOpen ? { onOpen } : {})} /></NotesProvider>);
  await waitFor(() => expect(document.querySelectorAll(".chat-text")).toHaveLength(seed.length));
  return { ids, view, user };
}

const box = () => screen.getByLabelText("What to Remember") as HTMLTextAreaElement;
const filed = async () => (await brainRef!.listByCategory("fact"));

describe("chat Log It: the doors", () => {
  it("offers a menu button on Dave's message and on JARVIS's, and both file", async () => {
    await openChat([
      { role: "user", text: "Never schedule anything before 9 on Mondays" },
      { role: "jarvis", text: "Noted. Mondays open at 9." },
    ]);
    expect(screen.getByRole("button", { name: "More Actions for Your Message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More Actions for JARVIS Message" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More Actions for JARVIS Message" }));
    fireEvent.click(await screen.findByText("Log It"));
    expect(box().value).toBe("Noted. Mondays open at 9.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await filed()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "More Actions for Your Message" }));
    fireEvent.click(await screen.findByText("Log It"));
    expect(box().value).toBe("Never schedule anything before 9 on Mondays");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await filed()).toHaveLength(2));
    expect(fetchTrap).not.toHaveBeenCalled();
  });

  it("shows no entry point at all when the Brain service does not exist", async () => {
    gate.brainOff = true;
    await openChat([{ role: "user", text: "hello there" }, { role: "jarvis", text: "Hi." }]);
    // The bubbles still render, exactly as before: no wrapper, no button.
    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More Actions/ })).toBeNull();
    expect(document.querySelector(".chat-row")).toBeNull();
    // A long press on a bubble opens nothing either.
    fireEvent.touchStart(screen.getByText("hello there"), touch(10, 10));
    await wait(560);
    expect(screen.queryByText("Log It")).toBeNull();
  });

  it("does not offer Log It on a bubble with no words", async () => {
    await openChat([{ role: "jarvis", text: "   " }, { role: "user", text: "anchor text" }]);
    expect(screen.getAllByRole("button", { name: /More Actions/ })).toHaveLength(1);
  });
});

describe("chat Log It: long press", () => {
  it("a held press on the bubble opens the menu, and the menu files", async () => {
    await openChat([{ role: "user", text: "Marco prefers email" }]);
    fireEvent.touchStart(screen.getByText("Marco prefers email"), touch(20, 20));
    await wait(560);
    fireEvent.touchEnd(screen.getByText("Marco prefers email"));
    fireEvent.click(await screen.findByText("Log It"));
    expect(box().value).toBe("Marco prefers email");
  });

  it("a scroll is not a press: movement past the tolerance cancels it", async () => {
    await openChat([{ role: "user", text: "Marco prefers email" }]);
    const el = screen.getByText("Marco prefers email");
    fireEvent.touchStart(el, touch(20, 20));
    await wait(200);
    fireEvent.touchMove(el, touch(20, 60));
    await wait(400);
    expect(screen.queryByText("Log It")).toBeNull();
  });

  it("the browser taking the gesture for a scroll (touchcancel) cancels it", async () => {
    await openChat([{ role: "user", text: "Marco prefers email" }]);
    const el = screen.getByText("Marco prefers email");
    fireEvent.touchStart(el, touch(20, 20));
    await wait(200);
    fireEvent.touchCancel(el);
    await wait(400);
    expect(screen.queryByText("Log It")).toBeNull();
  });

  it("a quick tap is not a press", async () => {
    await openChat([{ role: "user", text: "Marco prefers email" }]);
    const el = screen.getByText("Marco prefers email");
    fireEvent.touchStart(el, touch(20, 20));
    await wait(150);
    fireEvent.touchEnd(el);
    await wait(450);
    expect(screen.queryByText("Log It")).toBeNull();
  });

  it("a press that starts on a ref chip belongs to the chip", async () => {
    const opened: string[] = [];
    await openChat(
      [{ role: "jarvis", text: "You have one task", provenance: { kind: "records", refs: [{ kind: "task", id: "t9", label: "Call the plumber" }] } }],
      (k, id) => opened.push(k + ":" + id),
    );
    const chip = screen.getByRole("button", { name: "Call the plumber" });
    fireEvent.touchStart(chip, touch(20, 20));
    await wait(560);
    expect(screen.queryByText("Log It")).toBeNull();
    // And the chip still opens its record.
    fireEvent.click(chip);
    expect(opened).toEqual(["task:t9"]);
  });

  it("a press over selected text leaves the selection alone instead of opening the menu", async () => {
    await openChat([{ role: "jarvis", text: "Marco prefers email over text" }]);
    const el = screen.getByText("Marco prefers email over text");
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.touchStart(el, touch(20, 20));
    await wait(560);
    expect(screen.queryByText("Log It")).toBeNull();
    expect(sel.toString()).toBe("Marco prefers email over text");
    sel.removeAllRanges();
  });

  it("keeps the star, the provenance line and the chips on the bubble", async () => {
    await openChat([{ role: "jarvis", text: "Two things today", provenance: { kind: "ai" } }]);
    expect(screen.getByText("From your data + AI")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remember this" })).toBeInTheDocument();
  });
});

describe("chat Log It: what the sheet opens with", () => {
  it("Dave's message goes in exactly, whitespace and blank lines kept", async () => {
    const text = "  Sure!\n\n  never move the standup \t\n\nLet me know if you need anything else.  ";
    await openChat([{ role: "user", text }, { role: "user", text: "second" }]);
    fireEvent.click(screen.getAllByRole("button", { name: "More Actions for Your Message" })[0]!);
    fireEvent.click(await screen.findByText("Log It"));
    expect(box().value).toBe(text);
  });

  it("JARVIS's stock opener and closer come off, the substance stays", async () => {
    await openChat([{ role: "jarvis", text: "Sure!\n\nThe dentist is Tuesday at 3.\n\nLet me know if you need anything else." }]);
    fireEvent.click(screen.getByRole("button", { name: "More Actions for JARVIS Message" }));
    fireEvent.click(await screen.findByText("Log It"));
    expect(box().value).toBe("The dentist is Tuesday at 3.");
  });

  it("meaningful JARVIS text is preserved whole", async () => {
    const text = "Sure, Marco can do Thursday but not before noon.\nHope that helps a little, he said.";
    await openChat([{ role: "jarvis", text }]);
    fireEvent.click(screen.getByRole("button", { name: "More Actions for JARVIS Message" }));
    fireEvent.click(await screen.findByText("Log It"));
    expect(box().value).toBe(text);
  });

  it("the What box is the multiline field and long text edits in place", async () => {
    const long = Array.from({ length: 12 }, (_, i) => "Line " + i).join("\n");
    await openChat([{ role: "user", text: long }]);
    fireEvent.click(screen.getByRole("button", { name: "More Actions for Your Message" }));
    fireEvent.click(await screen.findByText("Log It"));
    expect(box().tagName).toBe("TEXTAREA");
    expect(box()).toHaveClass("input-multiline");
    fireEvent.change(box(), { target: { value: long + "\nLine 12" } });
    expect(box().value.endsWith("Line 12")).toBe(true);
  });

  it("opening a different message starts a fresh form", async () => {
    await openChat([{ role: "user", text: "First message" }, { role: "user", text: "Second message" }]);
    const doors = () => screen.getAllByRole("button", { name: "More Actions for Your Message" });
    fireEvent.click(doors()[0]!);
    fireEvent.click(await screen.findByText("Log It"));
    fireEvent.change(box(), { target: { value: "edited text" } });
    fireEvent.click(screen.getByRole("radio", { name: "Value" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());

    fireEvent.click(doors()[1]!);
    fireEvent.click(await screen.findByText("Log It"));
    expect(box().value).toBe("Second message");
    expect(screen.getByRole("radio", { name: "Fact" })).toHaveAttribute("aria-checked", "true");
    expect(await filed()).toHaveLength(0);
  });
});

describe("chat Log It: save, cancel, undo", () => {
  const openSheet = async (text = "Marco prefers email") => {
    const { ids } = await openChat([{ role: "user", text }]);
    fireEvent.click(screen.getByRole("button", { name: "More Actions for Your Message" }));
    fireEvent.click(await screen.findByText("Log It"));
    return ids[0]!;
  };

  it("Save files a chat-sourced fact linked to the message, toasts, and Undo removes it", async () => {
    const id = await openSheet();
    fireEvent.click(screen.getByRole("radio", { name: "Value" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await brainRef!.listByCategory("value")).toHaveLength(1));
    const row = (await brainRef!.listByCategory("value"))[0]!;
    expect(row.data).toMatchObject({ text: "Marco prefers email", source: "manual-chat", linkedItemIds: [id], category: "value" });
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    const call = showToast.mock.calls.map((c) => c[0] as { actionLabel?: string; onAction?: () => void }).find((c) => c.actionLabel === "Undo")!;
    expect(call).toBeTruthy();
    await act(async () => { call.onAction!(); await new Promise((r) => setTimeout(r, 20)); });
    expect(await brainRef!.listByCategory("value")).toHaveLength(0);
    expect(fetchTrap).not.toHaveBeenCalled();
  });

  it("Cancel writes nothing", async () => {
    await openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    expect(await filed()).toHaveLength(0);
  });

  it("a tap outside the sheet writes nothing", async () => {
    await openSheet();
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    expect(await filed()).toHaveLength(0);
  });

  it("a double tap files once", async () => {
    await openSheet();
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    expect(await filed()).toHaveLength(1);
  });

  it("a failed save keeps the sheet open with the edits, and a retry lands", async () => {
    await openSheet();
    fireEvent.change(box(), { target: { value: "edited but not saved yet" } });
    vi.spyOn(brainRef!, "file").mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: WRITE_FAILED_MESSAGE }));
    expect(box().value).toBe("edited but not saved yet");
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(await filed()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await filed()).toHaveLength(1));
    expect((await filed())[0]!.data.text).toBe("edited but not saved yet");
  });

  it("an empty box cannot be saved", async () => {
    await openSheet();
    fireEvent.change(box(), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("if the Brain goes away while the sheet is open, Save is dead and the sheet closes with a plain word", async () => {
    const { view, user } = await openChat([{ role: "user", text: "Marco prefers email" }]);
    fireEvent.click(screen.getByRole("button", { name: "More Actions for Your Message" }));
    fireEvent.click(await screen.findByText("Log It"));
    const svc = brainRef!;
    const file = vi.spyOn(svc, "file");
    gate.brainOff = true;
    view.rerender(<NotesProvider userId={user}><Grab /><ChatFlow /></NotesProvider>);
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    expect(showToast).toHaveBeenCalledWith({ message: "Brain Unavailable · Nothing Saved" });
    expect(file).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /More Actions/ })).toBeNull();
  });
});
