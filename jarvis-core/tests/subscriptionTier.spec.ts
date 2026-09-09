// UP-LAUNCH-13: Subscription tier tests
import { describe, it, expect } from "vitest";
import {
  isValidTier,
  isTierPaid,
  isTierUnlimited,
  tierDisplayName,
  DEFAULT_TIER
} from "../src/core/subscriptionTier.js";
import type { SubscriptionTier } from "../src/core/subscriptionTier.js";

describe("Subscription Tier", () => {
  describe("isValidTier", () => {
    it("accepts 'god'", () => {
      expect(isValidTier("god")).toBe(true);
    });

    it("accepts 'paid'", () => {
      expect(isValidTier("paid")).toBe(true);
    });

    it("accepts 'free'", () => {
      expect(isValidTier("free")).toBe(true);
    });

    it("rejects invalid values", () => {
      expect(isValidTier("premium")).toBe(false);
      expect(isValidTier("gold")).toBe(false);
      expect(isValidTier("")).toBe(false);
    });
  });

  describe("isTierPaid", () => {
    it("returns true for 'paid'", () => {
      expect(isTierPaid("paid")).toBe(true);
    });

    it("returns true for 'god'", () => {
      expect(isTierPaid("god")).toBe(true);
    });

    it("returns false for 'free'", () => {
      expect(isTierPaid("free")).toBe(false);
    });
  });

  describe("isTierUnlimited", () => {
    it("returns true for 'god'", () => {
      expect(isTierUnlimited("god")).toBe(true);
    });

    it("returns false for 'paid'", () => {
      expect(isTierUnlimited("paid")).toBe(false);
    });

    it("returns false for 'free'", () => {
      expect(isTierUnlimited("free")).toBe(false);
    });
  });

  describe("tierDisplayName", () => {
    it("names 'god' correctly", () => {
      expect(tierDisplayName("god")).toBe("God (Unlimited)");
    });

    it("names 'paid' correctly", () => {
      expect(tierDisplayName("paid")).toBe("Paid");
    });

    it("names 'free' correctly", () => {
      expect(tierDisplayName("free")).toBe("Free");
    });
  });

  describe("DEFAULT_TIER", () => {
    it("defaults to 'free'", () => {
      expect(DEFAULT_TIER).toBe("free");
    });

    it("is a valid tier", () => {
      expect(isValidTier(DEFAULT_TIER)).toBe(true);
    });
  });

  describe("Integration: tier gating logic", () => {
    const tiers: SubscriptionTier[] = ["god", "paid", "free"];

    it("paid and god have features, free does not", () => {
      expect(isTierPaid("god")).toBe(true);
      expect(isTierPaid("paid")).toBe(true);
      expect(isTierPaid("free")).toBe(false);
    });

    it("only god is unlimited", () => {
      const unlimited = tiers.filter(isTierUnlimited);
      expect(unlimited).toEqual(["god"]);
    });
  });
});
