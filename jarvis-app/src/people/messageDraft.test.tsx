// @vitest-environment jsdom
// Messages Drafting laws (addendum item 3): the draft exists at open and
// rides the write tier with the messageDrafts pin; flagged always outranks
// register in the prompt; the sms: link carries the edited text; the sheet
// performs NO writes (nothing is logged after), pinned by a static scan.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MessageDraftSheet from "./MessageDraftSheet";
import { draftSystemPrompt, smsLink } from "./messageDraft";
import type { AIService } from "../ai/AIService";
import type { Person } from "./types";

const person = (extra = {}): Person => ({
  id: "p1",
  data: { name: "Coach Reyes", group: "contacts", phone: "(203) 555-0138", register: "professional", ...extra },
});

function fakeAI(text: string, calls: { opts: unknown[] }) {
  return {
    available: true,
    complete: vi.fn(async (_m: unknown, _s: unknown, opts: unknown) => { calls.opts.push(opts); return text; }),
  } as unknown as AIService;
}

describe("the prompt", () => {
  it("flagged outranks every register", () => {
    const p = person({ register: "friend", flagged: true }).data;
    const sys = draftSystemPrompt(p, "warm", undefined);
    expect(sys).toMatch(/handle-with-care/);
  });

  it("no topic means a check-in that must not invent facts", () => {
    const sys = draftSystemPrompt(person().data, "brief", undefined);
    expect(sys).toMatch(/Do not invent events, plans, or facts/);
  });
});

describe("the sms link", () => {
  it("carries digits and the encoded body", () => {
    expect(smsLink("(203) 555-0138", "See you at 7")).toBe("sms:2035550138&body=See%20you%20at%207");
  });
  it("an empty body still opens the composer", () => {
    expect(smsLink("203", "")).toBe("sms:203");
  });
});

describe("the sheet", () => {
  it("drafts at open on the write tier with the messageDrafts pin", async () => {
    const calls = { opts: [] as unknown[] };
    render(<MessageDraftSheet person={person()} ai={fakeAI("Running 10 late.", calls)} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue("Running 10 late.")).toBeInTheDocument());
    expect(calls.opts[0]).toMatchObject({ tier: "write", pin: "messageDrafts", kind: "message" });
  });

  it("the edited text is what the sms link carries", async () => {
    const calls = { opts: [] as unknown[] };
    render(<MessageDraftSheet person={person()} ai={fakeAI("Draft.", calls)} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue("Draft.")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue("Draft."), { target: { value: "My own words" } });
    const link = screen.getByText("Open in Messages").closest("a")!;
    expect(link.getAttribute("href")).toContain(encodeURIComponent("My own words"));
  });

  it("changing the tone redrafts", async () => {
    const calls = { opts: [] as unknown[] };
    const ai = fakeAI("Draft.", calls);
    render(<MessageDraftSheet person={person()} ai={ai} onClose={() => {}} />);
    await waitFor(() => expect(calls.opts.length).toBe(1));
    fireEvent.click(screen.getByText("Brief"));
    await waitFor(() => expect(calls.opts.length).toBe(2));
  });
});

describe("law: nothing is logged after", () => {
  it("the sheet imports no data services and no store: it cannot write", () => {
    // AIService is the drafting engine, not a write path; everything that
    // CAN write (data services, the store, the write guard) is banned here.
    const src = readFileSync(join(__dirname, "MessageDraftSheet.tsx"), "utf8");
    expect(src).not.toMatch(/@core|from "\.\.\/data\/|useTasks|useNotes|usePeople|useSchedule|TasksService|NotesService|PeopleService|ScheduleService|attemptWrite/);
  });
});
