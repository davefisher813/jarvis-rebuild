// @vitest-environment jsdom
// Music Tier 1 laws (addendum item 5): per-context memory, self-introducing
// (picker on first use, one tap after), self-deleting (Forget removes the
// memory), never auto-starts (every open is a user tap; the module exposes
// no way to open a link without one).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { musicFor, rememberMusic, forgetMusic, labelForUrl } from "./music";
import MusicChip from "./MusicChip";

beforeEach(() => localStorage.clear());

describe("the memory", () => {
  it("is per context", () => {
    rememberMusic("focus", { label: "Spotify Playlist", url: "https://open.spotify.com/playlist/x" });
    expect(musicFor("focus")!.label).toBe("Spotify Playlist");
    expect(musicFor("gym")).toBeNull();
  });

  it("forget deletes it", () => {
    rememberMusic("gym", { label: "Spotify", url: "https://open.spotify.com" });
    forgetMusic("gym");
    expect(musicFor("gym")).toBeNull();
  });

  it("labels a pasted link by host, plainly when unknown", () => {
    expect(labelForUrl("https://open.spotify.com/playlist/abc")).toBe("Spotify Playlist");
    expect(labelForUrl("https://music.apple.com/us/playlist/abc")).toBe("Apple Music Playlist");
    expect(labelForUrl("not a url")).toBe("Your Link");
  });
});

describe("the chip", () => {
  it("introduces itself: no memory shows Music, tap opens the picker, pick remembers and opens", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<MusicChip context="focus" />);
    fireEvent.click(screen.getByText("Music"));
    expect(screen.getByText("Spotify")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Spotify"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(musicFor("focus")!.label).toBe("Spotify");
    open.mockRestore();
  });

  it("with memory it is one tap straight to the link, and Change reaches the picker", () => {
    rememberMusic("focus", { label: "Spotify Playlist", url: "https://open.spotify.com/playlist/x" });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<MusicChip context="focus" />);
    fireEvent.click(screen.getByText("Spotify Playlist"));
    expect(open).toHaveBeenCalledWith("https://open.spotify.com/playlist/x", "_blank", "noopener");
    fireEvent.click(screen.getByText("Change"));
    expect(screen.getByText("Forget")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Forget"));
    expect(musicFor("focus")).toBeNull();
    open.mockRestore();
  });

  it("never opens anything without a tap", () => {
    rememberMusic("gym", { label: "Spotify", url: "https://open.spotify.com" });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<MusicChip context="gym" />);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
