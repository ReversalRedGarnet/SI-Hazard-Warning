import { describe, it, expect } from "vitest";
import { compareSourceReadings } from "../../src/normalization/sourceHierarchy.js";
import { reissueOne } from "./fixtures.js";

/**
 * No second live adapter exists yet — this stubs a secondary source
 * (RSMC Nadi) reading manually given the same event_id as a SIMS reading, to
 * prove the hierarchy scaffold works once real cross-source correlation
 * exists (see sourceHierarchy.js's module comment on why that correlation
 * itself isn't built here).
 */
function fakeSecondarySourceReading(overrides = {}) {
  return reissueOne({
    alert_id: "urn:oid:fake-rsmc.1",
    source: "RSMC_NADI",
    sender: "rsmc-nadi@example.org",
    authoritative_for_local_warning: false,
    ...overrides,
  });
}

describe("compareSourceReadings", () => {
  it("flags no disagreement when a secondary source agrees with SIMS", () => {
    const sims = reissueOne();
    const secondary = fakeSecondarySourceReading({ event_id: sims.event_id });

    const comparison = compareSourceReadings([sims, secondary]);

    expect(comparison.disagreement).toBe(false);
    expect(comparison.readings).toHaveLength(2);
    expect(comparison.authoritative.source).toBe("SIMS");
  });

  it("flags disagreement without discarding either reading when severity differs", () => {
    const sims = reissueOne({ severity: "Severe" });
    const secondary = fakeSecondarySourceReading({ event_id: sims.event_id, severity: "Moderate" });

    const comparison = compareSourceReadings([sims, secondary]);

    expect(comparison.disagreement).toBe(true);
    expect(comparison.disagreementFields).toContain("severity");
    expect(comparison.readings).toEqual([sims, secondary]);
    expect(comparison.authoritative.source).toBe("SIMS");
  });

  it("marks no authoritative reading when none of the sources are authoritative", () => {
    const a = fakeSecondarySourceReading({ alert_id: "a" });
    const b = fakeSecondarySourceReading({ alert_id: "b" });

    const comparison = compareSourceReadings([a, b]);

    expect(comparison.authoritative).toBeNull();
  });

  it("throws on an empty group rather than silently returning a meaningless comparison", () => {
    expect(() => compareSourceReadings([])).toThrow();
  });
});
