import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sha256Hex } from "../shared/hash.js";
import { createAdministrativeUnit, BOUNDARY_STATUS } from "./AdministrativeUnit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data", "slb_provinces_2009.geojson");

/**
 * docs/PROJECT_HANDOFF.md names "the Pacific Data Hub" (pacificdata.org) as
 * the source for this dataset. pacificdata.org's own site and API are
 * behind Cloudflare bot protection that blocks non-browser fetches, so this
 * couldn't be pulled from there directly. What's bundled instead is UN
 * OCHA HDX's "cod-ab-slb" (Common Operational Dataset - Administrative
 * Boundaries, Solomon Islands): https://data.humdata.org/dataset/cod-ab-slb
 * — sourced from the *same* underlying agency and survey the doc names
 * (Solomon Islands National Statistics Office, 2009 Census of Population
 * and Housing), vetted by ITOS with USAID funding, and almost certainly
 * upstream of or identical to whatever Pacific Data Hub itself mirrors.
 * Flagging the substitution rather than presenting it as literally
 * Pacific Data Hub's own copy.
 *
 * Note the ADM1 (province) shapefile's actual publish/vetting date is
 * 2018-11-01 (from its own .shp.xml metadata), even though the underlying
 * survey geography traces back to the 2009 census the doc refers to as
 * "the 2009 boundaries" — `version` below reflects the product date, not
 * the census year, since that's what would actually change if SINSO
 * published a newer ADM1 product.
 *
 * Processing applied before checking the data into this repo (not done at
 * runtime — there's no shapefile/proj4 dependency here, only the derived
 * GeoJSON):
 *  1. Downloaded slb_admbnda_adm1.zip (SHP) from the HDX resource above.
 *  2. The shapefile's native CRS is a custom projection ("World_Mercator_150":
 *     Mercator, WGS84, central meridian 150°E, standard parallel 0°), not
 *     lon/lat — reprojected to WGS84 with proj4
 *     ("+proj=merc +lon_0=150 +lat_ts=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m
 *     +no_defs" -> "WGS84"). Verified against Honiara's known coordinates
 *     (expected ~159.95,-9.43; reprojected centroid landed at
 *     159.97,-9.43) before trusting it further.
 *  3. Simplified with Turf (Douglas-Peucker, tolerance 0.005° ≈ 500m) to
 *     bring ~201k vertices down to ~10k — province polygons include a lot
 *     of maritime area with dense coastline detail that's irrelevant at
 *     province-routing resolution. 500m error is negligible against
 *     province-sized polygons but means this data is not suitable for
 *     anything needing sub-500m precision.
 * Re-deriving this file means repeating those three steps against the same
 * HDX resource; there's no automated pipeline for it in this repo.
 */
const DATASET_PROVENANCE = Object.freeze({
  dataset_id: "hdx-cod-ab-slb-adm1",
  source_agency: "Solomon Islands National Statistics Office (SINSO)",
  version: "2018-11-01",
  effective_from: "2018-11-01",
  effective_to: null,
  license: "CC BY-IGO (Creative Commons Attribution for Intergovernmental Organisations)",
  boundary_status: BOUNDARY_STATUS.DEVELOPMENT_ONLY,
  // Fixed to when this file was actually fetched and converted, not
  // Date.now() at call time — retrieved_at is a fact about the data
  // snapshot, not about when this module happens to run.
  retrieved_at: "2026-09-22T05:27:15.206Z",
  /**
   * The doc's own provenance list includes this field but doesn't define
   * its values. "UNVERIFIED_PROTOTYPE" here means: sourced from a
   * recognized agency-vetted product (HDX/ITOS), but not independently
   * confirmed as current by SINSO — matching the doc's own open item to
   * "request current authoritative boundaries from SINSO... before
   * production."
   */
  verification_status: "UNVERIFIED_PROTOTYPE",
});

const COUNTRY_UNIT_ID = "SB";

let cached = null;

/**
 * Loads the bundled Solomon Islands province-level boundary dataset into
 * AdministrativeUnit form. Cached after the first call — the underlying
 * file doesn't change at runtime.
 *
 * @returns {{
 *   provenance: typeof DATASET_PROVENANCE & { geometry_hash: string },
 *   units: import("./AdministrativeUnit.js").AdministrativeUnit[],
 * }}
 */
export function loadBoundaryDataset() {
  if (cached) return cached;

  const raw = readFileSync(DATA_PATH, "utf8");
  const geojson = JSON.parse(raw);
  const geometryHash = sha256Hex(raw);

  const provenance = Object.freeze({ ...DATASET_PROVENANCE, geometry_hash: geometryHash });

  const country = createAdministrativeUnit({
    id: COUNTRY_UNIT_ID,
    unit_type: "country",
    parent_id: null,
    name: "Solomon Islands",
    geometry: null,
    dataset_version: provenance.version,
    boundary_status: provenance.boundary_status,
  });

  const provinces = geojson.features.map((feature) =>
    createAdministrativeUnit({
      id: feature.properties.ADM1_PCODE,
      // Honiara is the one ADM1 feature that isn't a province — modeling
      // it distinctly is the whole point of this being a typed graph
      // rather than "every unit is a province".
      unit_type: feature.properties.ADM1_NAME === "Honiara" ? "city" : "province",
      parent_id: COUNTRY_UNIT_ID,
      name: feature.properties.ADM1_NAME,
      geometry: feature.geometry,
      dataset_version: provenance.version,
      boundary_status: provenance.boundary_status,
    }),
  );

  cached = { provenance, units: [country, ...provinces] };
  return cached;
}
