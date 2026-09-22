import { describe, it, expect, beforeEach } from "vitest";
import { isSameEvent, isSuspiciouslyStale, REPLAY_STALENESS_GRACE_MS, DedupService } from "../../src/normalization/dedup.js";
import { deriveLifecycleTransition } from "../../src/normalization/lifecycle.js";
import {
  reissueOne,
  reissueTwo,
  reissueWithDivergentHazardPhrasing,
  unrelatedHazardType,
  unrelatedLaterEpisode,
} from "./fixtures.js";

describe("isSameEvent", () => {
  it("matches two real reissues of the same warning despite non-overlapping windows", () => {
    expect(isSameEvent(reissueOne(), reissueTwo())).toBe(true);
  });

  it("matches on eventCode even when hazard_type phrasing disagrees", () => {
    const divergent = reissueWithDivergentHazardPhrasing();
    expect(divergent.hazard_type).not.toBe(reissueOne().hazard_type);
    expect(isSameEvent(reissueOne(), divergent)).toBe(true);
  });

  it("does not match a different hazard type in the same window", () => {
    expect(isSameEvent(reissueOne(), unrelatedHazardType())).toBe(false);
  });

  it("does not match the same hazard type separated by months", () => {
    expect(isSameEvent(reissueOne(), unrelatedLaterEpisode())).toBe(false);
  });

  it("does not match across sources, even with identical hazard/time fields", () => {
    const secondary = reissueTwo({ source: "RSMC_NADI", authoritative_for_local_warning: false });
    expect(isSameEvent(reissueOne(), secondary)).toBe(false);
  });

  it("treats an identical alert_id as trivially the same event", () => {
    const alert = reissueOne();
    expect(isSameEvent(alert, alert)).toBe(true);
  });
});

describe("isSuspiciouslyStale", () => {
  it("is false for a real alert whose expires is comfortably after retrieved_at", () => {
    expect(isSuspiciouslyStale(reissueOne())).toBe(false);
  });

  it("flags an alert whose expires is well in the past relative to its own retrieved_at", () => {
    // A stale/previously-expired warning being replayed by a compromised
    // or misconfigured source: expired two days before it was "retrieved".
    const stale = reissueOne({
      expires: "2026-09-19T08:00:00+11:00",
      retrieved_at: "2026-09-21T08:35:00+11:00",
    });
    expect(isSuspiciouslyStale(stale)).toBe(true);
  });

  it("does not flag a timing gap within the grace window (ordinary clock skew/poll delay)", () => {
    const barelyPast = reissueOne({
      expires: "2026-09-21T08:34:00+11:00", // 1 minute before retrieved_at
      retrieved_at: "2026-09-21T08:35:00+11:00",
    });
    expect(isSuspiciouslyStale(barelyPast, { replayGraceMs: REPLAY_STALENESS_GRACE_MS })).toBe(false);
  });

  it("does not flag when either timestamp is missing — that's a different (malformed-input) concern", () => {
    expect(isSuspiciouslyStale(reissueOne({ expires: null }))).toBe(false);
  });
});

describe("DedupService", () => {
  /** @type {DedupService} */
  let service;

  beforeEach(() => {
    service = new DedupService();
  });

  it("collapses two reissues onto one event_id", () => {
    const first = service.ingest(reissueOne());
    const second = service.ingest(reissueTwo());

    expect(first.isReissue).toBe(false);
    expect(second.isReissue).toBe(true);
    expect(second.alert.event_id).toBe(first.alert.event_id);
    expect(second.matchedAlert.alert_id).toBe(first.alert.alert_id);
  });

  it("does not produce a duplicate onward alert for a reissue with no material change", () => {
    const first = service.ingest(reissueOne());
    const second = service.ingest(reissueTwo());

    const transition = deriveLifecycleTransition(first.alert, second.alert);

    expect(transition.state).toBe("UPDATED");
    expect(transition.sendTrigger).toBe(false);
  });

  it("keeps a genuinely new alert on its own event_id", () => {
    const first = service.ingest(reissueOne());
    const unrelated = service.ingest(unrelatedHazardType());

    expect(unrelated.isReissue).toBe(false);
    expect(unrelated.alert.event_id).not.toBe(first.alert.event_id);
  });

  it("retains every reading for an event, not just the latest", () => {
    const first = service.ingest(reissueOne());
    service.ingest(reissueTwo());

    const readings = service.getReadingsForEvent(first.alert.event_id);
    expect(readings).toHaveLength(2);
  });

  it("surfaces isSuspiciouslyStale on ingest() without discarding the alert", () => {
    const stale = reissueOne({
      alert_id: "urn:oid:test.stale-replay",
      event_id: "urn:oid:test.stale-replay",
      expires: "2026-09-19T08:00:00+11:00",
      retrieved_at: "2026-09-21T08:35:00+11:00",
    });

    const result = service.ingest(stale);

    expect(result.isSuspiciouslyStale).toBe(true);
    expect(result.alert.alert_id).toBe("urn:oid:test.stale-replay"); // flagged, not dropped
  });

  it("does not flag an ordinary reissue as suspiciously stale", () => {
    const result = service.ingest(reissueOne());
    expect(result.isSuspiciouslyStale).toBe(false);
  });
});
