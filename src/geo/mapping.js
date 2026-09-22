import * as turf from "@turf/turf";

/**
 * CAP itself uses "lat,lon" point order (confirmed against live SIMS data
 * and the CAP 1.2 spec) and capParser.js preserves that order as-is onto
 * Alert.alert_areas, so it has to be swapped to [lon, lat] here for
 * GeoJSON/Turf. Also defensively closes an unclosed ring rather than
 * letting Turf throw — real SIMS polygons observed so far are always
 * closed, but nothing guarantees every future source will be.
 */
function ringToLonLat(ring) {
  const converted = ring.map(([lat, lon]) => [lon, lat]);
  const [firstLon, firstLat] = converted[0];
  const [lastLon, lastLat] = converted[converted.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    converted.push([firstLon, firstLat]);
  }
  return converted;
}

/**
 * Converts one AlertArea's CAP polygon/circle entries into Turf polygon
 * features. docs/PROJECT_HANDOFF.md: prioritize CAP's own polygon/circle —
 * the actual hazard footprint — over a forecast-track cone (not built here;
 * no source needing that fallback exists yet).
 *
 * geocode entries are intentionally not handled: no real SIMS example has
 * ever included one, and there's no confirmed code scheme to map a geocode
 * value against an AdministrativeUnit id — inventing one would be a guess,
 * not an implementation. If a source starts publishing geocode, this needs
 * a real mapping table, not a heuristic.
 *
 * @param {import("../normalization/Alert.js").AlertArea} area
 * @returns {import("geojson").Feature[]}
 */
function hazardGeometriesForArea(area) {
  const geometries = [];

  for (const ring of area.polygon ?? []) {
    if (ring.length < 3) continue; // degenerate, not a real polygon
    geometries.push(turf.polygon([ringToLonLat(ring)]));
  }

  for (const circle of area.circle ?? []) {
    const [lat, lon] = circle.center;
    geometries.push(turf.circle([lon, lat], circle.radius, { units: "kilometers", steps: 32 }));
  }

  return geometries;
}

/**
 * Core geofencing function: which administrative units does this Alert's
 * official hazard geometry actually intersect? docs/PROJECT_HANDOFF.md,
 * "Geofencing": map the warning's own geometry, not a forecast-track cone
 * — rain, surge and wind can extend outside a cyclone's track cone.
 *
 * Only units with geometry are matched against (the country root from
 * boundaryDataset.js has none and is skipped automatically) — pass
 * loadBoundaryDataset().units directly. "Intersects" means boolean
 * touch-or-overlap (Turf's booleanIntersects), not a coverage percentage:
 * the doc asks which province(s) an alert affects, not how much of each —
 * computing exposed population/settlements/infrastructure within that
 * overlap is later situational-awareness work, out of scope here.
 *
 * Pass `boundaryProvenance` (loadBoundaryDataset().provenance) so the
 * result carries which exact boundary dataset version and geometry_hash
 * produced it — docs/PROJECT_HANDOFF.md asks for this specifically so a
 * past alert's affected-area result can be reconstructed later against the
 * boundary version that existed when it was sent, even after the dataset
 * is updated. Persisting that alongside the result is a distribution/audit
 * concern, out of scope here — this function only makes sure the
 * information is available to whoever does.
 *
 * @param {import("../normalization/Alert.js").Alert} alert
 * @param {import("./AdministrativeUnit.js").AdministrativeUnit[]} units
 * @param {{ boundaryProvenance?: { dataset_id: string, version: string, geometry_hash?: string } }} [options]
 * @returns {{
 *   affectedUnits: import("./AdministrativeUnit.js").AdministrativeUnit[],
 *   perAreaMatches: { areaDescription: string|null, matchedUnitIds: string[] }[],
 *   boundaryStatus: string|null,
 *   boundaryDatasetVersion: { dataset_id: string, version: string, geometry_hash?: string }|null,
 * }}
 */
export function mapAlertToAdministrativeUnits(alert, units, options = {}) {
  const geographicUnits = units.filter((unit) => unit.geometry !== null);
  const matchedIds = new Set();
  const perAreaMatches = [];

  for (const area of alert.alert_areas ?? []) {
    const hazardGeometries = hazardGeometriesForArea(area);
    const matchedForArea = new Set();

    for (const hazardGeometry of hazardGeometries) {
      for (const unit of geographicUnits) {
        if (matchedForArea.has(unit.id)) continue;
        if (turf.booleanIntersects(hazardGeometry, unit.geometry)) {
          matchedForArea.add(unit.id);
          matchedIds.add(unit.id);
        }
      }
    }

    perAreaMatches.push({
      areaDescription: area.description ?? null,
      matchedUnitIds: [...matchedForArea],
    });
  }

  const affectedUnits = geographicUnits.filter((unit) => matchedIds.has(unit.id));
  const boundaryStatus = geographicUnits[0]?.boundary_status ?? null;

  const boundaryDatasetVersion = options.boundaryProvenance
    ? {
        dataset_id: options.boundaryProvenance.dataset_id,
        version: options.boundaryProvenance.version,
        geometry_hash: options.boundaryProvenance.geometry_hash,
      }
    : null;

  return { affectedUnits, perAreaMatches, boundaryStatus, boundaryDatasetVersion };
}
