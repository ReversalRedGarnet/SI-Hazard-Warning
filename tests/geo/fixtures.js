/** Mirrors capParser.js's own polygon-text parsing, so these fixtures use the exact same [lat, lon] shape Alert.alert_areas carries. */
function parseCapPolygonText(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));
}

/**
 * Real CAP polygon from SIMS "Strong Wind Warning Number 218", fetched live
 * 2026-09-22. Its own areaDesc names Guadalcanal directly, which makes it a
 * good hand-verifiable case: computed against the bundled boundary data, it
 * resolves to Guadalcanal, Makira-Ulawa, Rennell-Bell and Temotu — the
 * south/east side of the country — and not the north/west provinces or
 * Malaita, which is a reasonable real result for "Eastern region, south
 * Russell and Guadalcanal".
 */
export const EASTERN_REGION_AREA = {
  description: "Eastern region, south Russell and Guadalcanal",
  polygon: [
    parseCapPolygonText(
      "-9.3466,159.2842 -9.3558,158.9722 -12.4516,159.0645 -12.4859,167.7305 -12.4731,171.1494 -9.9256,171.0088 -9.5054,168.0205 -9.5011,163.1250 -9.8909,163.1228 -9.7237,161.8336 -9.9440,161.8088 -9.9191,161.5078 -9.8779,161.0442 -9.8498,160.2532 -9.7589,159.6907 -9.3293,159.5775 -9.3466,159.2842",
    ),
  ],
  circle: [],
  geocode: [],
};

/**
 * Real CAP polygon from SIMS "Strong Wind Warning Number 216", fetched live
 * 2026-09-22 — its own areaDesc is literally "All waters", covering the
 * entire EEZ. Good universal-coverage case: every province plus Honiara.
 */
export const ALL_WATERS_AREA = {
  description: "All waters",
  polygon: [
    parseCapPolygonText(
      "-5.7734,168.7236 -5.7865,166.6406 -5.6466,163.0898 -5.6291,159.1260 -5.6400,156.1948 -6.1799,156.1597 -6.7584,156.0212 -6.8321,155.9202 -6.8992,155.8257 -6.9297,155.7092 -6.9864,155.5961 -7.3799,155.1050 -9.1064,155.3159 -9.0934,155.6653 -9.0804,156.0146 -9.2583,156.2783 -9.2236,156.7354 -9.2019,157.1660 -9.4534,157.5439 -10.4100,157.6187 -13.0474,157.6582 -13.9490,157.6934 -13.7058,158.7305 -13.6075,159.5215 -13.6033,159.9170 -13.5819,160.7344 -13.0345,162.2461 -12.4816,165.4365 -12.5031,167.1943 -12.5052,168.1611 -12.8589,169.2488 -12.8932,170.2090 -12.7475,171.0220 -12.1510,171.1143 -11.8372,171.1406 -11.4929,171.1143 -9.9083,171.1318 -7.9940,171.3208 -7.9635,170.3145 -7.9200,168.8203 -5.7734,168.7236",
    ),
  ],
  circle: [],
  geocode: [],
};

/**
 * Synthetic — SIMS has never published a circle live (docs/PROJECT_HANDOFF.md:
 * "no cyclone-category example seen yet"), so there's no real one to
 * capture. Centered right on the Honiara/Guadalcanal boundary (checked by
 * hand against the bundled boundary data during development — see
 * boundaryDataset.js's conversion notes) with a 2km radius, deliberately
 * straddling both.
 */
export const BORDER_STRADDLING_CIRCLE_AREA = {
  description: "Synthetic border-straddling test area",
  polygon: [],
  circle: [{ center: [-9.438, 160.0227], radius: 2 }],
  geocode: [],
};

/** Synthetic — small radius entirely inside Honiara, nowhere near the Guadalcanal border. */
export const HONIARA_ONLY_CIRCLE_AREA = {
  description: "Synthetic Honiara-only test area",
  polygon: [],
  circle: [{ center: [-9.4353, 159.9785], radius: 1 }],
  geocode: [],
};
