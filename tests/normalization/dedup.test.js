import { describe, it, expect, beforeEach } from "vitest";
import { isSameEvent, DedupService } from "../../src/normalization/dedup.js";
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
});
