// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { clearLocalData } from "./clearLocalData";

// S3-Q17 (2026-09-04): "Clear Local Data destroys things with no other
// copy." This proves the fix is namespaced correctly in both directions:
// every explicitly-safe cache/preload/dismissal key is actually removed,
// and every real queue or user decision the catalog named -- plus the
// live gym session and the S3-Q14 offline write queue -- survives.

beforeEach(() => {
  localStorage.clear();
});

const SAFE_SAMPLE = [
  "jarvis.backup.lastExport",
  "jarvis.seal.done.v1",
  "jarvis.brain.nightly.v1",
  "jarvis.recent-searches",
  "jarvis.chunk.reloaded.v1",
  "jarvis.overlap.kept.v1",
  "jarvis.attach.asked",
  "jarvis.location.v1",
  "jarvis.weather.v1",
  "jarvis.weather.offer.v1",
  "jarvis.today.ticker.v1",
  "jarvis.goalnudge.dismissed.v1",
  "jarvis.lastseen.v1",
  "jarvis.pattern.dismissed",
  "jarvis.whereyouwere.v1",
  "jarvis.whereyouwere.dismissed.v1",
  "jarvis.captures.v1",
  "jarvis.paste.dedupe.v1",
  "jarvis.people.lastcontact.v1",
  "jarvis.link.dismissed.v1",
  "jarvis.projstep.dismissed",
  "jarvis.firststep.dismissed",
  "jarvis.momentum.v1",
  "jarvis.overwhelmed.v1",
  "jarvis.sweep.last.v1",
  "jarvis.sweep.receipt.v1",
  "jarvis.sweep.offered.v2",
  "jarvis.sweep.dismissed.v1",
  "jarvis.notifications.dismissed.v1",
  "jarvis.pregen.v1",
  "jarvis.gcal.imported.v1",
  "jarvis.eventlog.imported.v1",
  "jarvis.mail.home.v1",
  "jarvis.mail.home.dismissed.v1",
  "jarvis.mail.waiting.cache.v1",
  "jarvis.mail.voice.v1",
  "jarvis.mail.triage.v3",
  "jarvis.mail.brief.v1",
  "jarvis.mail.tossasked.v1",
  "jarvis.mail.close.v1",
  "jarvis.mail.snooze.v1",
];

// The exact things the catalog evidence named as destroyed with no other
// copy, plus the live (not just pending) gym session -- the single most
// catastrophic possible loss in this whole list, since it is a workout in
// progress, not yet synced anywhere -- and the S3-Q14 offline write queue,
// which did not exist when this catalog item was written and must not be
// forgotten now that it does.
const PROTECTED_SAMPLE = [
  "jarvis.mail.outbox.v1", // unsent emails
  "jarvis.today.outbox.v1",
  "jarvis.gym.live.v1", // a workout IN PROGRESS, not just queued to sync
  "jarvis.gym.pending.v1", // finished workouts waiting to sync
  "jarvis.health.pending.v1", // pending health logs
  "jarvis.money.envelopes.v1", // budget envelopes
  "jarvis.corrections.v1", // learned rules in progress
  "jarvis.store.queue.u1.v1", // the core offline write queue (S3-Q14)
  "jarvis.mail.vip.v1",
  "jarvis.mail.rules.v1",
  "jarvis.mail.muted.v1",
  "jarvis.mail.letgo.v1",
  "jarvis.mail.autoreply.on.v1",
  "jarvis.gym.settings.v1", // real bar-weight/plate configuration
  "jarvis.appearance",
];

describe("clearLocalData", () => {
  it("removes every cache, preload and dismissal key it claims to", () => {
    for (const k of SAFE_SAMPLE) localStorage.setItem(k, "x");
    localStorage.setItem("jarvis.preload.v1.task", JSON.stringify({ owner: "u", items: [] }));
    clearLocalData();
    for (const k of SAFE_SAMPLE) expect(localStorage.getItem(k)).toBeNull();
    expect(localStorage.getItem("jarvis.preload.v1.task")).toBeNull();
  });

  it("never touches a queue or a real user decision", () => {
    for (const k of PROTECTED_SAMPLE) localStorage.setItem(k, "x");
    clearLocalData();
    for (const k of PROTECTED_SAMPLE) expect(localStorage.getItem(k)).toBe("x");
  });

  it("takes an injectable storage and never throws on a storage that rejects removeItem", () => {
    const removed: string[] = [];
    const fake: Pick<Storage, "removeItem"> = {
      removeItem: (k: string) => { removed.push(k); throw new Error("private mode"); },
    };
    expect(() => clearLocalData(fake)).not.toThrow();
    expect(removed).toContain("jarvis.backup.lastExport");
  });
});
