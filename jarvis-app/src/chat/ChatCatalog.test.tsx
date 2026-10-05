// @vitest-environment jsdom
// CHAT, THE CATALOG ON WHAT IS DRAWN (Alfred 2026-10-04, the perfect bar 2026-10-05).
//
//   - the placeholder reads "Ask, Tell or Paste" (Title Case, and no dot typed into it);
//   - the first screen is a crafted empty state, not a blank page: a glyph, a title, one line, and four starters stacked as
//     full-width rows (the review, 2026-10-05, D9);
//   - the composer's attach button is the quiet tonal circle and Send is the one red circle;
//   - "9 Tasks Due", not "9 Tasks due", in the day's count;
//   - one grey per bubble: a records answer draws no "From your records" second line (it said nothing the answer did
//     not), an AI answer keeps its one provenance line, an action receipt keeps its green "Done".
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useChat, useTasks } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import type { AIService } from "../ai/AIService";
import type { ChatService } from "./ChatService";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
vi.mock("../shared/toast", () => ({ showToast: vi.fn() }));

let chatRef: ChatService | null = null;
let tasksRef: ReturnType<typeof useTasks> | null = null;
function Grab() {
  chatRef = useChat();
  tasksRef = useTasks();
  return null;
}
afterEach(() => { chatRef = null; tasksRef = null; });

async function openChat(seed: { role: "user" | "jarvis"; text: string; provenance?: { kind: "records" | "ai" | "action" } }[]) {
  const user = "u-chat-catalog-" + Math.random().toString(36).slice(2);
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(chatRef && tasksRef).toBeTruthy());
  for (const s of seed) await chatRef!.append(s);
  view.rerender(<NotesProvider userId={user}><Grab /><ChatFlow /></NotesProvider>);
  await waitFor(() => expect(document.querySelectorAll(".chat-text")).toHaveLength(seed.length));
}

describe("Chat catalog", () => {
  it("the placeholder is Title Case and has no dot typed into it", async () => {
    await openChat([]);
    const box = screen.getByPlaceholderText("Ask, Tell or Paste");
    expect(box).toBeInTheDocument();
    expect(box.getAttribute("placeholder")).not.toContain("\u00b7");
  });

  it("an empty Chat is a crafted empty state with its starters stacked, and tapping one fills the field", async () => {
    await openChat([]);
    const empty = document.querySelector(".empty-state.chat-empty")!;
    expect(empty).toBeTruthy();
    expect(empty.querySelector(".empty-icon .ic"), "a glyph").toBeTruthy();
    expect(empty.querySelector(".empty-title")!.textContent).toBe("Ask JARVIS Anything");
    expect(empty.querySelector(".empty-sub")!.textContent).not.toMatch(/\. [A-Z]/);
    // Full-width rows in a column, never a scrolling chip row that clips the last one.
    const list = empty.querySelector(".chat-starter-list")!;
    expect(list.classList.contains("chip-row")).toBe(false);
    const rows = Array.from(list.querySelectorAll("button.chat-starter"));
    expect(rows.map((r) => r.textContent)).toEqual(["What's on Today?", "What's Next?", "Complete…", "Move… to Tomorrow"]);
    fireEvent.click(rows[3]!);
    expect((screen.getByPlaceholderText("Ask, Tell or Paste") as HTMLInputElement).value).toBe("Move ");
  });

  it("the empty state goes once there is a message", async () => {
    await openChat([{ role: "jarvis", text: "Nothing on today", provenance: { kind: "records" } }]);
    expect(document.querySelector(".chat-empty")).toBeNull();
  });

  it("attach is the quiet circle and Send is the one red circle, tonal until there is something to send", async () => {
    await openChat([]);
    const attach = screen.getByRole("button", { name: "Attach a File" });
    const send = screen.getByRole("button", { name: "Send" });
    expect(attach).toHaveClass("convo-send", "chat-attach");
    expect(send).toHaveClass("convo-send", "chat-send");
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Ask, Tell or Paste"), { target: { value: "hello" } });
    expect(send).not.toBeDisabled();
  });

  it("a records answer draws no provenance line: one grey, and the answer is the content", async () => {
    await openChat([{ role: "jarvis", text: "Nothing on today", provenance: { kind: "records" } }]);
    expect(document.querySelector(".chat-prov")).toBeNull();
    expect(screen.queryByText(/from your records/i)).toBeNull();
  });

  it("an AI answer keeps its one line, in Title Case", async () => {
    await openChat([{ role: "jarvis", text: "Two things today", provenance: { kind: "ai" } }]);
    expect(document.querySelectorAll(".chat-prov")).toHaveLength(1);
    expect(screen.getByText("From Your Data + AI")).toBeInTheDocument();
  });

  it("an action receipt keeps its green Done, unless its own words already open with it", async () => {
    await openChat([
      { role: "jarvis", text: "Saved Marco to the Gym", provenance: { kind: "action" } },
      { role: "jarvis", text: "Done: Call the plumber", provenance: { kind: "action" } },
    ]);
    const bubbles = Array.from(document.querySelectorAll(".chat-bubble"));
    expect(bubbles[0]!.querySelector(".chat-prov .fact.good")?.textContent).toBe("Done");
    // One "Done", not two: the text says it, so the line under it does not repeat it.
    expect(bubbles[1]!.querySelector(".chat-prov")).toBeNull();
  });

  it("the day's count reads 9 Tasks Due, not 9 Tasks due", async () => {
    await openChat([]);
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    for (let i = 0; i < 9; i++) await tasksRef!.createTask("Task " + i, { due: iso });
    fireEvent.change(screen.getByPlaceholderText("Ask, Tell or Paste"), { target: { value: "what's on today?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("0 Events · 9 Tasks Due")).toBeInTheDocument());
  });
});

// The stylesheet half of the composer (jsdom draws no CSS, so the rule is read as source).
describe("Chat composer circles, in the stylesheet", () => {
  const css = readFileSync(join(__dirname, "../styles/components.css"), "utf8");
  const rule = (sel: string) => (css.match(new RegExp(sel.replace(/[.[\]()]/g, "\\$&") + "\\s*\\{([^}]*)\\}")) ?? [])[1] ?? "";

  it("attach is tonal with a neutral glyph, never the red fill", () => {
    const r = rule(".chat-inputbar .chat-attach");
    expect(r).toMatch(/background-color:\s*var\(--press-3\)/);
    expect(r).toMatch(/color:\s*var\(--tx-2\)/);
    expect(r).not.toMatch(/accent/);
  });

  it("a disabled Send is the tonal circle at full strength, not a faded maroon", () => {
    const r = rule(".chat-inputbar .chat-send:disabled");
    expect(r).toMatch(/background-color:\s*var\(--press-3\)/);
    expect(r).toMatch(/opacity:\s*1/);
  });
});
