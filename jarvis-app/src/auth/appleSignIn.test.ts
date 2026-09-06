import { describe, it, expect } from "vitest";
import { rawNonce, hashedNonce, fullName, isPrivateRelay, signInWithAppleNative } from "./appleSignIn";

// UP-LAUNCH-10 (2026-09-05). The two things that break this flow in the field
// and cannot be caught by reading it: the nonce going to the wrong side, and
// the name being thrown away on the one authorization that carries it.

describe("the nonce", () => {
  it("is fresh every time and long enough to be one", () => {
    const a = rawNonce();
    expect(a).toHaveLength(64); // 32 bytes as hex
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(a).not.toBe(rawNonce());
  });

  it("is hashed for Apple and raw for Supabase, never the same value twice", async () => {
    // Send Apple the raw one and every sign-in fails with a nonce mismatch,
    // which is the single most confusing failure this flow has.
    const raw = "abc123";
    const hashed = await hashedNonce(raw);
    expect(hashed).toBe("6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d2392593af6a84118090");
    expect(hashed).not.toBe(raw);
  });

  it("hands Apple the hash and returns the raw one to the caller", async () => {
    let sentToApple = "";
    const out = await signInWithAppleNative({
      makeNonce: () => "fixed-raw-nonce",
      authorize: async (o) => {
        sentToApple = o.nonce ?? "";
        return { response: { identityToken: "tok" } };
      },
    });
    expect(out.nonce).toBe("fixed-raw-nonce");
    expect(sentToApple).toBe(await hashedNonce("fixed-raw-nonce"));
  });
});

describe("the name Apple sends once", () => {
  it("joins the two parts, and is empty when there are none", () => {
    expect(fullName({ givenName: "Alex", familyName: "Fisher" })).toBe("Alex Fisher");
    expect(fullName({ givenName: "Alex" })).toBe("Alex");
    expect(fullName({})).toBe("");
    expect(fullName({ givenName: "  ", familyName: "  " })).toBe("");
  });

  it("comes back from the sheet, because a second sign-in will not carry it", async () => {
    const out = await signInWithAppleNative({
      authorize: async () => ({ response: { identityToken: "tok", givenName: "Alex", familyName: "Fisher", email: "a@b.com" } }),
    });
    expect(out.name).toBe("Alex Fisher");
    expect(out.email).toBe("a@b.com");
  });
});

describe("Hide My Email", () => {
  it("is recognisable, which is why Sign In warns before it happens", () => {
    expect(isPrivateRelay("abc123@privaterelay.appleid.com")).toBe(true);
    expect(isPrivateRelay("ABC@PrivateRelay.AppleID.com")).toBe(true);
    expect(isPrivateRelay("dave@gmail.com")).toBe(false);
    expect(isPrivateRelay(undefined)).toBe(false);
  });
});

describe("when it does not work", () => {
  it("calls a cancelled sheet a choice, not a failure", async () => {
    await expect(signInWithAppleNative({
      authorize: async () => { throw new Error("The operation was canceled."); },
    })).rejects.toThrow("Sign-in cancelled");
  });

  it("says something a person can read when the plugin is not in the build", async () => {
    await expect(signInWithAppleNative({
      authorize: async () => { throw new Error('"SignInWithApple" plugin is not implemented on ios'); },
    })).rejects.toThrow(/Couldn't reach Apple/);
  });

  it("refuses a response with no token rather than signing nobody in", async () => {
    await expect(signInWithAppleNative({
      authorize: async () => ({ response: { identityToken: "" } }),
    })).rejects.toThrow(/did not return a sign-in token/);
  });
});
