// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ConnectionBanner from "./ConnectionBanner";
import type { BannerModel, RecoveryNote } from "../connections/incidentView";

const model = (o: Partial<BannerModel> = {}): BannerModel => ({
  incidentId: "JC-0A1B2C3D", email: "dave@gmail.com", kind: "auth", title: "Gmail Needs Reconnecting", address: "dave@gmail.com",
  lines: ["Mail last updated Oct 6 at 8:12 PM.", "New mail may be missing."], paused: "2 Replies Unsent · 1 Other Action Paused", reconnect: true, strip: false, ...o,
});
const handlers = () => ({ onReconnect: vi.fn(), onViewPaused: vi.fn(), onAcknowledge: vi.fn(), onSeen: vi.fn() });

describe("the loud banner", () => {
  it("shows the title, the address, both lines, the paused counts and the three ways out, as an alert", () => {
    render(<ConnectionBanner models={[model()]} notes={[]} {...handlers()} />);
    const b = screen.getByRole("alert");
    expect(b).toHaveClass("conn-banner");
    for (const t of ["Gmail Needs Reconnecting", "dave@gmail.com", "Mail last updated Oct 6 at 8:12 PM.", "New mail may be missing.", "2 Replies Unsent · 1 Other Action Paused"]) expect(b).toHaveTextContent(t);
    expect([...b.querySelectorAll("button")].map((x) => x.textContent)).toEqual(["Reconnect Gmail", "View Paused Actions", "Open Gmail"]);
  });

  it("has no dismiss control of any kind", () => {
    render(<ConnectionBanner models={[model()]} notes={[]} {...handlers()} />);
    expect(screen.queryByText(/dismiss|close|got it|hide/i)).toBeNull();
    expect(document.querySelector("[aria-label*='ismiss' i], [aria-label*='lose' i]")).toBeNull();
  });

  it("never says all caught up", () => {
    render(<ConnectionBanner models={[model()]} notes={[]} {...handlers()} />);
    expect(document.body.textContent).not.toMatch(/all caught up/i);
  });

  it("Reconnect goes to the reconnect path and acknowledges; View Paused Actions does the same for its own", () => {
    const h = handlers();
    render(<ConnectionBanner models={[model()]} notes={[]} {...h} />);
    fireEvent.click(screen.getByText("Reconnect Gmail"));
    expect(h.onReconnect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("View Paused Actions"));
    expect(h.onViewPaused).toHaveBeenCalledTimes(1);
    expect(h.onAcknowledge).toHaveBeenCalledWith("JC-0A1B2C3D");
  });

  it("Open Gmail opens Gmail as that address", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: null } as unknown as Window);
    render(<ConnectionBanner models={[model()]} notes={[]} {...handlers()} />);
    fireEvent.click(screen.getByText("Open Gmail"));
    expect(open).toHaveBeenCalledWith("https://mail.google.com/mail/?authuser=dave%40gmail.com", "_blank");
    open.mockRestore();
  });

  it("a degraded incident offers no Reconnect", () => {
    render(<ConnectionBanner models={[model({ kind: "degraded", reconnect: false, title: "Gmail Isn't Updating" })]} notes={[]} {...handlers()} />);
    expect(screen.queryByText("Reconnect Gmail")).toBeNull();
    expect(screen.getByText("Open Gmail")).toBeInTheDocument();
  });

  it("without somewhere to see paused actions, it does not offer to", () => {
    const { onViewPaused: _drop, ...h } = handlers();
    void _drop;
    render(<ConnectionBanner models={[model()]} notes={[]} {...h} />);
    expect(screen.queryByText("View Paused Actions")).toBeNull();
  });

  it("an acknowledged banner compacts to a strip that still says the failure, and a tap opens it again", () => {
    render(<ConnectionBanner models={[model({ strip: true })]} notes={[]} {...handlers()} />);
    const s = screen.getByRole("alert");
    expect(s).toHaveClass("conn-strip");
    expect(s).toHaveTextContent("Gmail Needs Reconnecting · dave@gmail.com");
    expect(screen.getByText("Reconnect Gmail")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Gmail Needs Reconnecting · /));
    expect(screen.getByRole("alert")).toHaveClass("conn-banner");
  });

  it("access restored and mail caught up are two separate notes with their own words", () => {
    const restored: RecoveryNote = { incidentId: "JC-1", email: "dave@gmail.com", state: "restored", title: "Access Restored", detail: "dave@gmail.com · Syncing Mail Now" };
    const caught: RecoveryNote = { incidentId: "JC-2", email: "dave@gmail.com", state: "caught_up", title: "Mail Caught Up", detail: "dave@gmail.com" };
    const h = handlers();
    render(<ConnectionBanner models={[]} notes={[restored, caught]} {...h} />);
    const notes = screen.getAllByRole("status");
    expect(notes[0]).toHaveTextContent("Access Restored");
    expect(notes[0]).not.toHaveTextContent(/caught up/i);
    expect(notes[1]).toHaveTextContent("Mail Caught Up");
    fireEvent.click(screen.getByText("Done"));
    expect(h.onSeen).toHaveBeenCalledWith("JC-2");
  });
});
