import { createAlert } from "../../src/normalization/Alert.js";

/**
 * Fixtures modeled on real SIMS CAP items fetched live on 2026-09-22
 * (identifiers, timestamps and the expires/re-sent gap are the real
 * observed values — see dedup.js's DEFAULT_ADJACENCY_GRACE_MS comment for
 * why that gap matters). Not full CAP XML — these build straight into
 * Alert objects, since normalization operates on Alerts, not raw payloads.
 */

let counter = 0;
function placeholderHash() {
  counter += 1;
  return counter.toString(16).padStart(64, "0");
}

/** Real eventCode observed live across the whole 216-218 reissue episode. */
const STRONG_WIND_EVENT_CODE = [{ valueName: "OET:v1.2", value: "OET-218" }];

function baseFields(overrides = {}) {
  return createAlert({
    alert_id: overrides.alert_id ?? `urn:oid:test.${counter}`,
    event_id: overrides.event_id ?? overrides.alert_id ?? `urn:oid:test.${counter}`,
    hazard_type: "Strong Wind",
    sender: "forecast@met.gov.sb",
    source: "SIMS",
    status: "Actual",
    msg_type: "Alert",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Likely",
    effective: null,
    expires: "2026-09-21T16:00:00+11:00",
    alert_areas: [
      {
        description: "Eastern region, south Russell and Guadalcanal",
        polygon: [[[-9.3466, 159.2842], [-9.3558, 158.9722]]],
        circle: [],
        geocode: [],
      },
    ],
    instructions: "Sea travelers are urged to consider safety actions.",
    references: [],
    authoritative_for_local_warning: true,
    raw_payload: "<cap:alert>placeholder</cap:alert>",
    source_metadata: { scope: "Public", sent: "2026-09-21T08:32:20+11:00", eventCode: STRONG_WIND_EVENT_CODE },
    raw_source_url: "https://cap-sources.s3.amazonaws.com/sb-met-en/test.xml",
    retrieved_at: "2026-09-21T08:35:00+11:00",
    payload_hash: placeholderHash(),
    ...overrides,
  });
}

/** "Strong Wind Warning Number 217" — real timestamps, sent 2026-09-21T08:32:20+11:00 */
export function reissueOne(overrides = {}) {
  return baseFields({
    alert_id: "urn:oid:2.49.0.1.90.0.2026.9.20.21.32.20",
    raw_source_url: "https://cap-sources.s3.amazonaws.com/sb-met-en/2026-09-20-21-32-20.xml",
    expires: "2026-09-21T16:00:00+11:00",
    retrieved_at: "2026-09-21T08:35:00+11:00",
    source_metadata: { scope: "Public", sent: "2026-09-21T08:32:20+11:00", eventCode: STRONG_WIND_EVENT_CODE },
    ...overrides,
  });
}

/**
 * "Strong Wind Warning Number 217" reissue — real timestamps, sent
 * 2026-09-21T17:32:45+11:00. Note this arrives 1h32m after reissueOne's own
 * `expires` (16:00) already passed: real data, not strictly overlapping.
 * Carries the same real eventCode as reissueOne, per the live-feed check.
 */
export function reissueTwo(overrides = {}) {
  return baseFields({
    alert_id: "urn:oid:2.49.0.1.90.0.2026.9.21.6.32.45",
    raw_source_url: "https://cap-sources.s3.amazonaws.com/sb-met-en/2026-09-21-06-32-45.xml",
    expires: "2026-09-22T07:00:00+11:00",
    retrieved_at: "2026-09-21T17:35:00+11:00",
    source_metadata: { scope: "Public", sent: "2026-09-21T17:32:45+11:00", eventCode: STRONG_WIND_EVENT_CODE },
    ...overrides,
  });
}

/**
 * Same eventCode as the Strong Wind episode, but phrased as a completely
 * different hazard_type string. Exercises the "eventCode wins over
 * hazard_type" preference: a real source wouldn't actually relabel the same
 * warning series like this, but this isolates that eventCode alone is
 * sufficient to correlate even when the hazard-type text disagrees.
 */
export function reissueWithDivergentHazardPhrasing(overrides = {}) {
  return reissueTwo({
    hazard_type: "Severe Weather Advisory",
    ...overrides,
  });
}

/**
 * Same hazard type, same rough time window, but a different hazard — must
 * not merge with the Strong Wind episode. No eventCode, so the match falls
 * back to hazard_type: this isolates that fallback path from eventCode,
 * which now takes priority when present.
 */
export function unrelatedHazardType(overrides = {}) {
  return baseFields({
    alert_id: "urn:oid:test.unrelated-hazard",
    hazard_type: "Heavy Rain",
    expires: "2026-09-21T18:00:00+11:00",
    retrieved_at: "2026-09-21T09:00:00+11:00",
    source_metadata: { scope: "Public", sent: "2026-09-21T08:58:00+11:00", eventCode: [] },
    ...overrides,
  });
}

/**
 * Same hazard type, but a genuinely separate episode months later — must
 * not merge just because the text matches. No eventCode, isolating the
 * validity-window fallback path being tested here from eventCode.
 */
export function unrelatedLaterEpisode(overrides = {}) {
  return baseFields({
    alert_id: "urn:oid:test.unrelated-later",
    expires: "2026-12-15T16:00:00+11:00",
    retrieved_at: "2026-12-15T08:00:00+11:00",
    source_metadata: { scope: "Public", sent: "2026-12-15T07:58:00+11:00", eventCode: [] },
    ...overrides,
  });
}

export { baseFields };
