import { performance } from "node:perf_hooks";
import { DedupService } from "../../src/normalization/dedup.js";
import { deriveLifecycleTransition } from "../../src/normalization/lifecycle.js";
import { mapAlertToAdministrativeUnits } from "../../src/geo/mapping.js";
import { loadBoundaryDataset } from "../../src/geo/boundaryDataset.js";
import { buildMailaAlerts } from "./buildAlerts.js";

/**
 * docs/PROJECT_HANDOFF.md's own stated ground truth for TC Maila's impact
 * on Solomon Islands (independently confirmed live against ECHO's 9 Apr
 * 2026 sitrep during this replay's construction — see mailaWarnings.js).
 */
export const GROUND_TRUTH_PROVINCES = ["Western", "Choiseul", "Isabel", "Guadalcanal", "Central"];

function summarizeLatency(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = samplesMs.reduce((s, v) => s + v, 0);
  return {
    count: samplesMs.length,
    meanMs: sum / samplesMs.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

/**
 * Replays the TC Maila warning sequence through ingestion's output shape ->
 * dedup -> lifecycle -> geo mapping, in chronological order, as if this
 * pipeline had been running live during the event. No fixture is skipped
 * or special-cased: whatever the pipeline actually does with each warning
 * is what gets reported, including any divergence from the doc's ground
 * truth — that divergence is the point of running this before a real
 * cyclone, not something to smooth over.
 */
export function runMailaReplay() {
  const alerts = buildMailaAlerts();
  const { units, provenance } = loadBoundaryDataset();
  const dedupService = new DedupService();

  const lastAlertByEventId = new Map();
  const timeline = [];
  const latencies = { dedup: [], lifecycle: [], geo: [] };

  for (const alert of alerts) {
    const t0 = performance.now();
    const dedupResult = dedupService.ingest(alert);
    const t1 = performance.now();

    const previous = lastAlertByEventId.get(dedupResult.alert.event_id) ?? null;
    const lifecycleResult = deriveLifecycleTransition(previous, dedupResult.alert);
    const t2 = performance.now();

    const geoResult = mapAlertToAdministrativeUnits(dedupResult.alert, units, { boundaryProvenance: provenance });
    const t3 = performance.now();

    lastAlertByEventId.set(dedupResult.alert.event_id, dedupResult.alert);

    latencies.dedup.push(t1 - t0);
    latencies.lifecycle.push(t2 - t1);
    latencies.geo.push(t3 - t2);

    const replayMeta = alert.source_metadata.replay;

    timeline.push({
      warningNumber: replayMeta.warningNumber,
      issuedAt: alert.source_metadata.sent,
      provenance: replayMeta.provenance,
      headline: replayMeta.headline,
      category: replayMeta.category,
      msgType: alert.msg_type,
      severity: alert.severity,
      alertId: alert.alert_id,
      eventId: dedupResult.alert.event_id,
      isReissue: dedupResult.isReissue,
      lifecycleState: lifecycleResult.state,
      sendTrigger: lifecycleResult.sendTrigger,
      lifecycleReasons: lifecycleResult.reasons,
      affectedProvinces: geoResult.affectedUnits.map((u) => u.name).sort(),
      boundaryStatus: geoResult.boundaryStatus,
      latenciesMs: { dedup: t1 - t0, lifecycle: t2 - t1, geo: t3 - t2 },
    });
  }

  const distinctEventIds = new Set(timeline.map((entry) => entry.eventId));
  const cumulativeAffectedProvinces = new Set();
  for (const entry of timeline) {
    for (const province of entry.affectedProvinces) cumulativeAffectedProvinces.add(province);
  }

  const cumulativeList = [...cumulativeAffectedProvinces].sort();
  const falseNegatives = GROUND_TRUTH_PROVINCES.filter((p) => !cumulativeAffectedProvinces.has(p));
  const falsePositives = cumulativeList.filter((p) => !GROUND_TRUTH_PROVINCES.includes(p));

  return {
    timeline,
    totalWarnings: timeline.length,
    distinctEventIdCount: distinctEventIds.size,
    distinctEventIds: [...distinctEventIds],
    groundTruthProvinces: GROUND_TRUTH_PROVINCES,
    cumulativeAffectedProvinces: cumulativeList,
    falseNegatives,
    falsePositives,
    boundaryProvenance: provenance,
    latencySummary: {
      dedup: summarizeLatency(latencies.dedup),
      lifecycle: summarizeLatency(latencies.lifecycle),
      geo: summarizeLatency(latencies.geo),
    },
  };
}
