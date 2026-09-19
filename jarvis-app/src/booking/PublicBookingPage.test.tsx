// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PublicBookingPage, { byLocalDay } from "./PublicBookingPage";

// THE BOOKING PAGE (Track 3, 2026-09-19). The one screen with no session
// behind it, so what it does when the server says no matters as much as
// what it does when the server says yes.

const AT = (iso: string) => new Date(iso).getTime();
const SLOTS = [
  { startMs: AT("2026-06-15T13:00:00Z"), endMs: AT("2026-06-15T13:30:00Z"), date: "2026-06-15" },
  { startMs: AT("2026-06-15T14:00:00Z"), endMs: AT("2026-06-15T14:30:00Z"), date: "2026-06-15" },
  { startMs: AT("2026-06-16T13:00:00Z"), endMs: AT("2026-06-16T13:30:00Z"), date: "2026-06-16" },
];
const LINK = { name: "Intro Call", durationMin: 30, timezone: "America/New_York", slots: SLOTS };

const res = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

function fetcher(get: unknown, post?: { body: unknown; status: number }) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST"
      ? res(post?.body ?? {}, post?.status ?? 200)
      : res(get, (get as { __status?: number }).__status ?? 200)) as unknown as typeof fetch;
}

describe("PublicBookingPage", () => {
  it("shows the link, groups the slots by day, and asks for nothing until one is picked", async () => {
    render(<PublicBookingPage slug="intro" fetchImpl={fetcher(LINK)} />);
    expect(await screen.findByText("Intro Call")).toBeInTheDocument();
    expect(screen.getByText("30 Minutes")).toBeInTheDocument();
    // Two days, and the form is not on screen yet.
    expect(document.querySelectorAll(".chip-row").length).toBe(2);
    expect(screen.queryByLabelText("Name")).toBeNull();
    fireEvent.click(document.querySelectorAll(".chip-row .chip")[0]!);
    expect(screen.getByText("Who Is Coming")).toBeInTheDocument();
  });

  it("will not post without a name and an email, and says which is missing", async () => {
    const f = fetcher(LINK);
    render(<PublicBookingPage slug="intro" fetchImpl={f} />);
    await screen.findByText("Intro Call");
    fireEvent.click(document.querySelectorAll(".chip-row .chip")[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Book / }));
    expect(screen.getByText("Add your name.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alberto" } });
    fireEvent.click(screen.getByRole("button", { name: /^Book / }));
    expect(screen.getByText("Add an email we can confirm to.")).toBeInTheDocument();
    // Nothing was posted by either attempt.
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });

  const book = async (f: typeof fetch) => {
    render(<PublicBookingPage slug="intro" fetchImpl={f} />);
    await screen.findByText("Intro Call");
    fireEvent.click(document.querySelectorAll(".chip-row .chip")[0]!);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alberto" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Book / }));
  };
  const MADE = { startMs: SLOTS[0]!.startMs, endMs: SLOTS[0]!.endMs, timezone: "America/New_York", name: "Intro Call" };

  it("books, and the receipt names the time rather than saying it worked", async () => {
    await book(fetcher(LINK, { body: { ...MADE, confirmationSent: true }, status: 200 }));
    expect(await screen.findByText("You Are Booked")).toBeInTheDocument();
    expect(screen.getByText(/a@b\.com/)).toBeInTheDocument();
  });

  // THE PROMISE HAS TO BE TRUE (2026-09-19). This line used to say a
  // confirmation was on its way whether or not one had been sent. Telling
  // somebody to watch an inbox for an email that does not exist is how a
  // booking becomes a no-show, so the page now says what the server did.
  it("when no confirmation went out, it says so instead of promising one", async () => {
    await book(fetcher(LINK, { body: { ...MADE, confirmationSent: false }, status: 200 }));
    expect(await screen.findByText("You Are Booked")).toBeInTheDocument();
    expect(screen.getByText(/No email went out/)).toBeInTheDocument();
    expect(screen.queryByText(/on its way/)).toBeNull();
  });

  // The receipt is written on the VISITOR's clock, and only their browser
  // knows which one that is, so it has to travel with the booking.
  it("sends the visitor's own time zone with the booking", async () => {
    const f = fetcher(LINK, { body: { ...MADE, confirmationSent: true }, status: 200 });
    await book(f);
    await screen.findByText("You Are Booked");
    const post = (f as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    const sent = JSON.parse((post[1] as RequestInit).body as string) as { timezone?: string };
    expect(typeof sent.timezone).toBe("string");
    expect(sent.timezone!.length).toBeGreaterThan(0);
  });

  // THE SERVER DECIDES. Someone else can take the slot between the grid
  // loading and the button being pressed, and the page has to say so and
  // show the grid that is true now, rather than insisting.
  it("when the slot went while they were typing, it says so and reloads the grid", async () => {
    const f = fetcher(LINK, { body: { error: "Someone just took that time" }, status: 409 });
    render(<PublicBookingPage slug="intro" fetchImpl={f} />);
    await screen.findByText("Intro Call");
    fireEvent.click(document.querySelectorAll(".chip-row .chip")[0]!);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alberto" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Book / }));
    expect(await screen.findByText("Someone just took that time")).toBeInTheDocument();
    // The choice is dropped, so nobody confirms a time that is gone.
    await waitFor(() => expect(screen.queryByText("Who Is Coming")).toBeNull());
  });

  it("a link that never existed, and a server that is not set up, both say so plainly", async () => {
    const gone = render(<PublicBookingPage slug="nope" fetchImpl={fetcher({ __status: 404, error: "No such link" })} />);
    expect(await screen.findByText("Nothing to Book Here")).toBeInTheDocument();
    expect(screen.getByText(/expired or never existed/)).toBeInTheDocument();
    gone.unmount();
    render(<PublicBookingPage slug="intro" fetchImpl={fetcher({ __status: 503, error: "Booking is not set up" })} />);
    expect(await screen.findByText(/not taking bookings yet/)).toBeInTheDocument();
  });

  it("a link with no open times says that, and asks for nothing", async () => {
    render(<PublicBookingPage slug="intro" fetchImpl={fetcher({ ...LINK, slots: [] })} />);
    expect(await screen.findByText("No Times Open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});

describe("byLocalDay", () => {
  it("groups by the visitor's own day, in time order", () => {
    const days = byLocalDay(SLOTS);
    expect(days).toHaveLength(2);
    expect(days[0]!.slots).toHaveLength(2);
    expect(days[0]!.key < days[1]!.key).toBe(true);
  });
  it("has nothing to group when there is nothing open", () => {
    expect(byLocalDay([])).toEqual([]);
  });
});
