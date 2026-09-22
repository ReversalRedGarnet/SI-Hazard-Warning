/**
 * Administrative geography as a typed graph, not a rigid province tree
 * (docs/PROJECT_HANDOFF.md, "Geofencing"): Honiara City Council is
 * administratively distinct from Guadalcanal Province even though both sit
 * at the same level and both have ward-level structure below them. The real
 * boundary data confirms this directly — Honiara is its own top-level
 * ADM1 feature, a sibling of Guadalcanal under the country, not nested
 * inside it (see boundaryDataset.js).
 */

/**
 * Not cosmetic: every AdministrativeUnit built from the bundled 2009-sourced
 * dataset carries this, so nothing downstream can quietly treat a prototype
 * boundary as production-authoritative. docs/PROJECT_HANDOFF.md is explicit
 * that production needs current boundaries requested from SINSO/electoral
 * authorities/provincial GIS offices, not this dataset.
 */
export const BOUNDARY_STATUS = Object.freeze({
  DEVELOPMENT_ONLY: "DEVELOPMENT_ONLY",
  PRODUCTION: "PRODUCTION",
});

/**
 * @typedef {Object} AdministrativeUnit
 * @property {string} id                 Stable code within its dataset (e.g. an ADM1 pcode, or "SB" for the country root)
 * @property {string} unit_type          "country" | "province" | "city" | "constituency" | "ward" | ... — open-ended, not an enum, since the graph can grow new levels
 * @property {string|null} parent_id     id of the containing unit, or null for a root (the country)
 * @property {string} name
 * @property {import("geojson").Geometry|null} geometry   null only for the country root, which has no geometry of its own in this dataset
 * @property {string} dataset_version    Which version of the source dataset this unit's geometry came from
 * @property {string} boundary_status    One of BOUNDARY_STATUS's values
 */

const REQUIRED_FIELDS = ["id", "unit_type", "name", "dataset_version", "boundary_status"];

/**
 * @param {Partial<AdministrativeUnit>} fields
 * @returns {Readonly<AdministrativeUnit>}
 */
export function createAdministrativeUnit(fields) {
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] === undefined || fields[key] === null) {
      throw new Error(`AdministrativeUnit is missing required field: ${key}`);
    }
  }

  return Object.freeze({
    id: fields.id,
    unit_type: fields.unit_type,
    parent_id: fields.parent_id ?? null,
    name: fields.name,
    geometry: fields.geometry ?? null,
    dataset_version: fields.dataset_version,
    boundary_status: fields.boundary_status,
  });
}
