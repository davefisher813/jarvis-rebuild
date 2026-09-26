// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PublicCancelPage, { whenLine } from "./PublicCancelPage";

// GIVING THE HOUR BACK (Track 3, 2026-09-19). The second screen with no session
// behind it. What it does when the answer is not the happy one matters most,
// because the person reading it has no other way in and no account to fall back
// on: a dead end here sends them to write an email and hope.

const ID = "3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b";
const START = Date.parse("2026-09-22T18:00:00.000Z");
const END = Date.parse("2026-09-22T18:30:00.000Z");
const STANDING = { name: "Intro Call", status: "confirmed", startMs: START, endMs: END };

const res = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

/** A server that answers the lookup one way and the cancel another. */
function server(get: unknown, del?: { body: unknown; status: number }) {
  return vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "DELETE"
      ? res(del?.body ?? { cancelled: true, already: false }, del?.status ?? 200)
      : res(get, (get as { __status?: number }).__status ?? 200)) as unknown as typeof fetch;
}

describe("whenLine", () => {
  it("names the day and both ends of the meeting", () => {
    expect(whenLine(STANDING)).toBe("Tuesday, September 22, 6:00 PM to 6:30 PM");
  });
  it("still says when it is with only a start", () => {
    expect(whenLine({ ...STANDING, endMs: null })).toBe("Tuesday, September 22 at 6:00 PM");
  });
  // A screen with no time is honest; a screen with the wrong time is not.
  it("says nothing rather than a wrong time when the start did not survive", () => {
    expect(whenLine({ ...STANDING, startMs: null })).toBeNull();
  });
});

describe("PublicCancelPage", () => {
  it("shows the meeting before it offers the button", async () => {
    const f = server({ booking: STANDING });
    render(<PublicCancelPage bookingId={ID} fetchImpl={f} />);
    expect(await screen.findByText("Intro Call")).toBeInTheDocument();
    expect(screen.getByText(/September 22/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel It" })).toBeInTheDocument();
    // Nothing was cancelled by arriving on the page.
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toHaveLength(0);
  });

  it("cancels, and says the hour is free rather than saying it worked", async () => {
    render(<PublicCancelPage bookingId={ID} fetchImpl={server({ booking: STANDING })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel It" }));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText(/hour is free again/)).toBeInTheDocument();
    expect(screen.getByText(/nothing else is needed/i)).toBeInTheDocument();
  });

  it("sends the booking's own id and nothing else", async () => {
    const f = server({ booking: STANDING });
    render(<PublicCancelPage bookingId={ID} fetchImpl={f} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel It" }));
    await screen.findByText("Cancelled");
    const del = (f as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")!;
    expect(JSON.parse((del[1] as RequestInit).body as string)).toEqual({ cancel: ID });
  });

  // ALREADY CANCELLED IS A SUCCESS, NOT AN ERROR. Somebody tapping the link in
  // an old email must be told the meeting is off, which it is. "No such
  // booking" reads as a broken link and sends them to write an email.
  it("tells somebody with an old link that the meeting is already off", async () => {
    render(<PublicCancelPage bookingId={ID} fetchImpl={server({ booking: { ...STANDING, status: "cancelled" } })} />);
    expect(await screen.findByText("Already Cancelled")).toBeInTheDocument();
    expect(screen.getByText(/nothing left to do/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel It" })).toBeNull();
  });

  it("treats a cancel the server says was already done as done, not as a failure", async () => {
    render(<PublicCancelPage bookingId={ID} fetchImpl={server({ booking: STANDING }, { body: { cancelled: true, already: true }, status: 200 })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel It" }));
    expect(await screen.findByText("Already Cancelled")).toBeInTheDocument();
  });

  it("a link that names nothing says so, and points at a person", async () => {
    render(<PublicCancelPage bookingId={ID} fetchImpl={server({ __status: 404, error: "No such booking" })} />);
    expect(await screen.findByText("We Could Not Find That Booking")).toBeInTheDocument();
    expect(screen.getByText(/replying to your confirmation email/)).toBeInTheDocument();
  });

  // The button stays, because the meeting is still on and they still cannot
  // make it. A dead end here is the thing this whole screen exists to avoid.
  it("keeps the button and says so when the cancel failed", async () => {
    render(<PublicCancelPage bookingId={ID} fetchImpl={server({ booking: STANDING }, { body: { error: "nope" }, status: 502 })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel It" }));
    expect(await screen.findByText("Could not cancel that booking.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel It" })).toBeInTheDocument();
  });

  it("says so when it cannot reach the service at all", async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") throw new Error("offline");
      return res({ booking: STANDING });
    }) as unknown as typeof fetch;
    render(<PublicCancelPage bookingId={ID} fetchImpl={f} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel It" }));
    expect(await screen.findByText("Could not reach the booking service.")).toBeInTheDocument();
  });

  it("cannot be double-tapped into two cancellations", async () => {
    const f = server({ booking: STANDING });
    render(<PublicCancelPage bookingId={ID} fetchImpl={f} />);
    const btn = await screen.findByRole("button", { name: "Cancel It" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByText("Cancelled");
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toHaveLength(1);
  });

  it("asks about one booking and only by its id", async () => {
    const f = server({ booking: STANDING });
    render(<PublicCancelPage bookingId={ID} fetchImpl={f} />);
    await waitFor(() => expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));
    expect(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toBe(`/api/book?cancel=${ID}`);
  });
});
