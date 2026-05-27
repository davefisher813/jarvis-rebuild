// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import MessagesFlow from "./MessagesFlow";

const noAI = new AIService({ available: false });

const api = makeFakeGoogleApi({
  listInbox: async () => [
    { id: "m1", snippet: "hi", labelIds: ["INBOX", "UNREAD"], internalDate: "200",
      payload: { headers: [{ name: "From", value: "Sam <s@x.com>" }, { name: "Subject", value: "Lunch?" }] } },
    { id: "m2", snippet: "yo", labelIds: ["INBOX"], internalDate: "100",
      payload: { headers: [{ name: "From", value: "Wei <w@x.com>" }, { name: "Subject", value: "Intro" }] } },
  ],
  getMessage: async (id: string) => ({
    id, threadId: "t1",
    payload: {
      mimeType: "text/plain",
      body: { data: btoa("Lets get lunch") },
      headers: [{ name: "From", value: "Sam <s@x.com>" }, { name: "Subject", value: "Lunch?" }, { name: "Date", value: "Mon" }],
    },
  }),
});

function wrap(node: React.ReactNode) {
  return (
    <NotesProvider userId="u1">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>{node}</GoogleSessionProvider>
    </NotesProvider>
  );
}

describe("MessagesFlow", () => {
  it("connects and lists the real inbox", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText("Lunch?")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
  });

  it("opens a message and shows its body", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Lunch?"));
    expect(await screen.findByText("Lets get lunch")).toBeInTheDocument();
    expect(screen.getByText("Reply")).toBeInTheDocument();
  });

  it("composes and sends", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("New message"));
    fireEvent.change(screen.getByPlaceholderText("To"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Sent")).toBeInTheDocument());
  });

  it("shows an honest setup state when unconfigured (no fake text inbox)", () => {
    render(wrap(<MessagesFlow ai={noAI} configured={false} />));
    expect(screen.getByText("Email setup required")).toBeInTheDocument();
    expect(screen.queryByText("Texts aren't available")).toBeNull();
  });
});
