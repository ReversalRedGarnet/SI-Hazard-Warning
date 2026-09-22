import * as turf from "@turf/turf";
import { createAlert } from "../../src/normalization/Alert.js";
import { loadBoundaryDataset } from "../../src/geo/boundaryDataset.js";
import { sha256Hex } from "../../src/shared/hash.js";
import { MAILA_WARNINGS } from "./mailaWarnings.js";

/**
 * No real CAP polygon exists for any Maila warning (see mailaWarnings.js's
 * module comment), so hazard geometry here is synthetic: a convex hull
 * around each named province's own real boundary (from src/geo's bundled
 * dataset), buffered by a small margin — something roughly as coarse as a
 * forecaster-drawn hazard polygon. This guarantees the geo-mapping stage
 * resolves to exactly the provinces this dataset says a warning names — it
 * is not a claim about Maila's actual wind-field shape, which no source
 * here captures.
 *
 * Convex hull, not a buffer of the exact multi-island boundary: Western
 * Province alone is ~968 separate island polygons, and turf.buffer()
 * against that full shape measured at 47 SECONDS for one province — a
 * real performance trap in this fixture, not in src/geo/mapping.js (which
 * only ever receives the already-computed hull, and does no buffering
 * itself). The convex hull captures the same "this province and the sea
 * around it" footprint the buffer was going for, in about 30ms.
 *
 * A per-province hull is *not* clipped against neighboring provinces —
 * that was tried and measured to make no difference. Honiara sits fully
 * inside Guadalcanal's convex hull (confirmed: the overlap area exactly
 * equals Honiara's whole area, not just a shared border), so no clip can
 * separate them short of hand-carving Honiara's exact boundary out of
 * every Guadalcanal-naming warning. Any polygon that reasonably represents
 * "Guadalcanal is under warning" — synthetic or a real forecaster's own
 * drawing — will geometrically cover Honiara too, since it's a small
 * enclave inside Guadalcanal's extent. That makes "Honiara" showing up in
 * the replay's results a real, expected finding, not a fixture artifact —
 * see the replay report for the implication. Hulls are still built per
 * named province and combined as separate polygon entries rather than one
 * hull spanning all of them: a single hull across e.g. Western and Temotu
 * (opposite ends of the country, both named in warning #6) would swallow
 * everything geographically between them, which *would* be a fixture
 * artifact.
 */
const HULL_BUFFER_KM = 5;

/** @type {Map<string, GeoJSON.Feature>} */
const provinceGeometryCache = new Map();

function provinceHazardGeometry(name, units) {
  if (provinceGeometryCache.has(name)) return provinceGeometryCache.get(name);

  const unit = units.find((u) => u.name === name);
  if (!unit) throw new Error(`Unknown province in replay dataset: ${name}`);

  const hull = turf.buffer(turf.convex(turf.feature(unit.geometry)), HULL_BUFFER_KM, { units: "kilometers" });

  provinceGeometryCache.set(name, hull);
  return hull;
}

/** CAP polygon order is [lat, lon] (see src/geo/mapping.js) — GeoJSON is [lon, lat]. */
function geometryToCapRings(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rings = [];
  for (const poly of polygons) {
    const exterior = poly[0];
    rings.push(exterior.map(([lon, lat]) => [lat, lon]));
  }
  return rings;
}

function buildHazardArea(provinceNames, units) {
  const rings = [];
  for (const name of provinceNames) {
    const geom = provinceHazardGeometry(name, units);
    rings.push(...geometryToCapRings(geom.geometry));
  }
  return {
    description: provinceNames.join(", "),
    polygon: rings,
    circle: [],
    geocode: [],
  };
}

/**
 * Builds the full TC Maila warning sequence as real Alert objects, in
 * chronological order — the shape ingestion would have produced, had a
 * real CAP feed existed for this event.
 *
 * @returns {import("../../src/normalization/Alert.js").Alert[]}
 */
export function buildMailaAlerts() {
  const { units } = loadBoundaryDataset();

  return MAILA_WARNINGS.map((warning) => {
    const area = buildHazardArea(warning.provinces, units);
    const issuedAt = new Date(warning.issuedAt);
    const expires = new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000).toISOString();
    const alertId = `urn:oid:reconstructed.tc-maila.warning-${warning.number}`;
    const rawPayload = `RECONSTRUCTED (not a real CAP payload) — ${warning.headline} — ${warning.citation}`;

    return createAlert({
      alert_id: alertId,
      // Left equal to alert_id, same as real ingestion's placeholder —
      // the whole point of running this through DedupService is to see
      // whether it correctly collapses these onto a shared event_id.
      event_id: alertId,
      hazard_type: "Tropical Cyclone",
      sender: "forecast@met.gov.sb",
      source: "SIMS",
      status: "Actual",
      msg_type: warning.msgType,
      severity: warning.severity,
      urgency: warning.urgency,
      certainty: warning.certainty,
      effective: null,
      expires,
      alert_areas: [area],
      instructions: warning.instruction,
      references: [],
      authoritative_for_local_warning: true,
      raw_payload: rawPayload,
      source_metadata: {
        scope: "Public",
        sent: issuedAt.toISOString(),
        // No real eventCode is known for this event (nothing to source it
        // from) — left empty so dedup falls back to hazard_type matching,
        // exactly as it would for a source that never populates eventCode.
        eventCode: [],
        replay: {
          warningNumber: warning.number,
          category: warning.category,
          provenance: warning.provenance,
          citation: warning.citation,
          headline: warning.headline,
        },
      },
      raw_source_url: `reconstructed://tc-maila-2026/warning-${warning.number}`,
      retrieved_at: issuedAt.toISOString(),
      payload_hash: sha256Hex(rawPayload),
    });
  });
}
