import { describe, it, expect } from "vitest";
import { bookingSlugOf } from "./publicRoute";

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
