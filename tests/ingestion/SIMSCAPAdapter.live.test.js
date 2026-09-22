import { describe, it, expect } from "vitest";
import { SIMSCAPAdapter } from "../../src/ingestion/SIMSCAPAdapter.js";

const LIVE_TIMEOUT_MS = 20_000;

/**
 * These hit the real SIMS CAP feed over the network — no fixtures, no
 * mocking. The point is to prove the adapter parses whatever SIMS is
 * actually publishing right now, not a frozen sample. If SIMS is down or the
 * feed is empty, these will fail/skip rather than lie about coverage.
 */
describe("SIMSCAPAdapter against the live SIMS feed", () => {
  it(
    "fetches and parses the RSS index into items with a title and CAP link",
    async () => {
      const adapter = new SIMSCAPAdapter();
      const items = await adapter.fetchIndex();

      expect(items.length).toBeGreaterThan(0);
      const [first] = items;
      expect(typeof first.title).toBe("string");
      expect(first.link).toMatch(/^https:\/\/cap-sources\.s3\.amazonaws\.com\/sb-met-en\/.+\.xml$/);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "fetches the most recent CAP item and normalizes the confirmed fields into an Alert",
    async () => {
      const adapter = new SIMSCAPAdapter();
      const [item] = await adapter.fetchIndex();
      const alert = await adapter.fetchAlert(item);

      // Identity / provenance
      expect(alert.source).toBe("SIMS");
      expect(alert.alert_id).toBeTruthy();
      expect(alert.raw_source_url).toBe(item.link);
      expect(alert.raw_payload).toContain(alert.alert_id);
      expect(alert.payload_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(alert.authoritative_for_local_warning).toBe(true);

      // CAP fields confirmed live (docs/PROJECT_HANDOFF.md, "Data ingestion")
      expect(alert.status).toBe("Actual");
      expect(alert.msg_type).toBe("Alert");
      expect(alert.source_metadata.scope).toBe("Public");
      expect(["Minor", "Moderate", "Severe", "Extreme", "Unknown"]).toContain(alert.severity);
      expect(["Immediate", "Expected", "Future", "Past", "Unknown"]).toContain(alert.urgency);
      expect(["Observed", "Likely", "Possible", "Unlikely", "Unknown"]).toContain(alert.certainty);

      expect(alert.alert_areas.length).toBeGreaterThan(0);
      const [area] = alert.alert_areas;
      expect(typeof area.description).toBe("string");
      expect(area.polygon.length).toBeGreaterThan(0);
      const [firstRing] = area.polygon;
      expect(firstRing.length).toBeGreaterThan(0);
      const [firstPoint] = firstRing;
      expect(firstPoint).toHaveLength(2);
      expect(typeof firstPoint[0]).toBe("number");
      expect(typeof firstPoint[1]).toBe("number");

      expect(typeof alert.instructions).toBe("string");
      expect(alert.instructions.length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );
});
