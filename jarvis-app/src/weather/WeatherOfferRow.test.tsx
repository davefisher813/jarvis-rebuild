// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WeatherOfferRow } from "./WeatherLine";
import { subscribeToast } from "../shared/toast";

// TODAY-F-05 (2026-09-05): "Allow" could not work on iOS (no
// NSLocationWhenInUseUsageDescription, so WebKit cannot request
// authorization) and every failure ran the same `dismiss` callback, which
// wrote "declined" and buried the offer for good. A refusal is a decision; a
// timeout or an unavailable fix is not.

const OFFER_KEY = "jarvis.weather.offer.v1";

function stubGeo(fail: { code: number } | null) {
  const getCurrentPosition = vi.fn((ok: PositionCallback, err?: PositionErrorCallback) => {
    if (fail) err?.(fail as GeolocationPositionError);
    else ok({ coords: { latitude: 40.7128, longitude: -74.006 } } as GeolocationPosition);
  });
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("WeatherOfferRow", () => {
  it("a location that could not be read leaves the offer standing, and says so", async () => {
    stubGeo({ code: 3 }); // timeout
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      render(<WeatherOfferRow />);
      fireEvent.click(screen.getByText("Allow"));
      await waitFor(() => expect(seen).toContain("Couldn't get your location · The offer stays"));
      expect(screen.getByText("Add Weather to Your Day")).toBeInTheDocument();
      expect(localStorage.getItem(OFFER_KEY)).toBeNull();
    } finally {
      stop();
    }
  });

  it("an actual refusal is remembered, and the offer goes", async () => {
    stubGeo({ code: 1 }); // PERMISSION_DENIED
    render(<WeatherOfferRow />);
    fireEvent.click(screen.getByText("Allow"));
    await waitFor(() => expect(screen.queryByText("Add Weather to Your Day")).not.toBeInTheDocument());
    expect(localStorage.getItem(OFFER_KEY)).toBe("declined");
  });

  it("granting stores the location and retires the offer", async () => {
    stubGeo(null);
    render(<WeatherOfferRow />);
    fireEvent.click(screen.getByText("Allow"));
    await waitFor(() => expect(localStorage.getItem(OFFER_KEY)).toBe("granted"));
    expect(screen.queryByText("Add Weather to Your Day")).not.toBeInTheDocument();
  });
});
