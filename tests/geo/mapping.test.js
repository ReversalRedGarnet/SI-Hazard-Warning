import { describe, it, expect } from "vitest";
import { mapAlertToAdministrativeUnits } from "../../src/geo/mapping.js";
import { loadBoundaryDataset } from "../../src/geo/boundaryDataset.js";
import { BOUNDARY_STATUS } from "../../src/geo/AdministrativeUnit.js";
import { baseFields } from "../normalization/fixtures.js";
import {
  EASTERN_REGION_AREA,
  ALL_WATERS_AREA,
  BORDER_STRADDLING_CIRCLE_AREA,
  HONIARA_ONLY_CIRCLE_AREA,
} from "./fixtures.js";

const { units, provenance } = loadBoundaryDataset();

function affectedNames(result) {
  return result.affectedUnits.map((u) => u.name).sort();
}

describe("mapAlertToAdministrativeUnits", () => {
  it("resolves a real SIMS polygon named after Guadalcanal to Guadalcanal, among others", () => {
    const alert = baseFields({ alert_areas: [EASTERN_REGION_AREA] });
    const result = mapAlertToAdministrativeUnits(alert, units);

    expect(affectedNames(result)).toEqual(["Guadalcanal", "Makira-Ulawa", "Rennell-Bell", "Temotu"]);
  });

  it("resolves a real SIMS 'All waters' polygon to every province and Honiara", () => {
    const alert = baseFields({ alert_areas: [ALL_WATERS_AREA] });
    const result = mapAlertToAdministrativeUnits(alert, units);

    expect(affectedNames(result)).toHaveLength(10);
    expect(affectedNames(result)).toContain("Honiara");
  });

  it("matches both sides of a border-straddling circle (Honiara and Guadalcanal)", () => {
    const alert = baseFields({ alert_areas: [BORDER_STRADDLING_CIRCLE_AREA] });
    const result = mapAlertToAdministrativeUnits(alert, units);

    expect(affectedNames(result)).toEqual(["Guadalcanal", "Honiara"]);
  });

  it("matches only Honiara for a circle entirely inside it, not its Guadalcanal neighbor", () => {
    const alert = baseFields({ alert_areas: [HONIARA_ONLY_CIRCLE_AREA] });
    const result = mapAlertToAdministrativeUnits(alert, units);

    expect(affectedNames(result)).toEqual(["Honiara"]);
  });

  it("reports which unit ids each individual area matched, not just the flattened total", () => {
    const alert = baseFields({ alert_areas: [EASTERN_REGION_AREA] });
    const result = mapAlertToAdministrativeUnits(alert, units);

    expect(result.perAreaMatches).toHaveLength(1);
    expect(result.perAreaMatches[0].areaDescription).toBe(EASTERN_REGION_AREA.description);
    expect(result.perAreaMatches[0].matchedUnitIds).toHaveLength(4);
  });

  it("surfaces BOUNDARY_STATUS in the result so nothing downstream can miss it", () => {
    const alert = baseFields({ alert_areas: [EASTERN_REGION_AREA] });
    const result = mapAlertToAdministrativeUnits(alert, units);

    expect(result.boundaryStatus).toBe(BOUNDARY_STATUS.DEVELOPMENT_ONLY);
    expect(result.boundaryStatus).toBe("DEVELOPMENT_ONLY");
  });

  it("carries the exact boundary dataset version/hash used, for later replay", () => {
    const alert = baseFields({ alert_areas: [EASTERN_REGION_AREA] });
    const result = mapAlertToAdministrativeUnits(alert, units, { boundaryProvenance: provenance });

    expect(result.boundaryDatasetVersion).toEqual({
      dataset_id: provenance.dataset_id,
      version: provenance.version,
      geometry_hash: provenance.geometry_hash,
    });
  });

  it("returns a null boundaryDatasetVersion when provenance isn't passed, rather than guessing one", () => {
    const alert = baseFields({ alert_areas: [EASTERN_REGION_AREA] });
    const result = mapAlertToAdministrativeUnits(alert, units);

    expect(result.boundaryDatasetVersion).toBeNull();
  });

  it("matches nothing for an alert with no areas", () => {
    const alert = baseFields({ alert_areas: [] });
    const result = mapAlertToAdministrativeUnits(alert, units);

    expect(result.affectedUnits).toEqual([]);
    expect(result.perAreaMatches).toEqual([]);
  });
});
