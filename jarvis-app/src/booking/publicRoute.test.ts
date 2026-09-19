import { describe, it, expect } from "vitest";
import { bookingSlugOf, cancelIdOf, cancelUrl } from "./publicRoute";

// The one path that renders before the auth gate, so what counts as it is
// worth being exact about.
describe("bookingSlugOf", () => {
  it("takes a booking URL, with or without a trailing slash", () => {
    expect(bookingSlugOf("/book/dave-30")).toBe("dave-30");
    expect(bookingSlugOf("/book/dave-30/")).toBe("dave-30");
    expect(bookingSlugOf("/book/a")).toBe("a");
  });
  it("decodes an escaped slug", () => {
    expect(bookingSlugOf("/book/dave%2D30")).toBe("dave-30");
  });
  it("is not any other page", () => {
    expect(bookingSlugOf("/")).toBeNull();
    expect(bookingSlugOf("/book")).toBeNull();
    expect(bookingSlugOf("/book/")).toBeNull();
    expect(bookingSlugOf("/book/dave/extra")).toBeNull();
    expect(bookingSlugOf("/settings/booking")).toBeNull();
  });
  it("refuses anything that is not a slug, rather than passing it on", () => {
    expect(bookingSlugOf("/book/../etc")).toBeNull();
    expect(bookingSlugOf("/book/a b")).toBeNull();
    expect(bookingSlugOf("/book/-leading")).toBeNull();
    expect(bookingSlugOf("/book/trailing-")).toBeNull();
    expect(bookingSlugOf("/book/" + "x".repeat(70))).toBeNull();
    expect(bookingSlugOf("/book/%E0%A4%A")).toBeNull();
    expect(bookingSlugOf("/book/<script>")).toBeNull();
  });
});

describe("cancelIdOf", () => {
  const ID = "3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b";

  it("reads the booking a cancel link names", () => {
    expect(cancelIdOf("?cancel=" + ID)).toBe(ID);
    expect(cancelIdOf("cancel=" + ID)).toBe(ID);
  });
  it("lower-cases it, so one link is one booking however it was typed", () => {
    expect(cancelIdOf("?cancel=" + ID.toUpperCase())).toBe(ID);
  });
  it("ignores everything else on the query string", () => {
    expect(cancelIdOf("?utm=mail&cancel=" + ID + "&x=1")).toBe(ID);
  });
  it("is null when the link does not name one at all", () => {
    expect(cancelIdOf("")).toBeNull();
    expect(cancelIdOf("?slug=abc")).toBeNull();
    expect(cancelIdOf("?cancel=")).toBeNull();
  });
  // A value that cannot be an id is a URL this app does not answer, rather
  // than a query sent on to be refused later. Same rule as the slug.
  it("is null for anything that is not a uuid, including a near miss", () => {
    expect(cancelIdOf("?cancel=1")).toBeNull();
    expect(cancelIdOf("?cancel=3f2a1c4e5b6d4e8f9a0b1c2d3e4f5a6b")).toBeNull();
    expect(cancelIdOf("?cancel=" + ID + "x")).toBeNull();
    expect(cancelIdOf("?cancel=' or 1=1 --")).toBeNull();
    expect(cancelIdOf("?cancel=../../etc/passwd")).toBeNull();
  });
});

describe("cancelUrl", () => {
  it("is the same public address, pointed at one booking", () => {
    expect(cancelUrl("https://jarvis.example", "wide-harbour", "bk-1"))
      .toBe("https://jarvis.example/book/wide-harbour?cancel=bk-1");
  });
  // The round trip is the thing that matters: what goes in an email has to
  // come back out of the URL that email opens.
  it("round-trips through the two parsers that read it", () => {
    const ID = "3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b";
    const u = new URL(cancelUrl("https://jarvis.example", "wide-harbour", ID));
    expect(bookingSlugOf(u.pathname)).toBe("wide-harbour");
    expect(cancelIdOf(u.search)).toBe(ID);
  });
});
