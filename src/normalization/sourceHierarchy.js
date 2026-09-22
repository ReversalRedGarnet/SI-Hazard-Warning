/**
 * Scaffold for handling disagreement between sources reporting on the same
 * event (docs/PROJECT_HANDOFF.md, "Reliability & recovery": "When sources
 * disagree ... show the disagreement to the operator for context, while
 * keeping the official-source hierarchy for what actually goes out to the
 * public"; "Geofencing": "don't score severity by distance ... retain the
 * source's own severity/urgency/certainty instead of inventing a local
 * proxy"). Readings are never discarded or averaged away — every source's
 * own values are kept, and this module only flags where they differ and
 * which one is authoritative for distribution.
 *
 * This module doesn't decide which alerts belong to the same event — it
 * operates on a group of alerts that already share an event_id, however
 * that grouping was produced. dedup.js's isSameEvent only matches
 * same-source pairs (see its module comment): correlating a SIMS alert with
 * a JTWC bulletin about the same storm needs geographic/temporal alignment
 * across sources with no shared vocabulary, which is a geo-mapping concern,
 * out of scope here. Until that exists, cross-source grouping has to be
 * assigned some other way (e.g. an operator linking two readings by hand) —
 * this module is the scaffold for what happens once that grouping exists,
 * proven here against a stub secondary source rather than a second live
 * adapter.
 */

const COMPARABLE_FIELDS = ["severity", "urgency", "certainty"];

/**
 * @typedef {Object} SourceComparison
 * @property {import("./Alert.js").Alert[]} readings        All readings for the event, in the order given
 * @property {import("./Alert.js").Alert|null} authoritative  The reading whose source is authoritative_for_local_warning, or null if none is
 * @property {boolean} disagreement                          True if the readings differ on severity, urgency or certainty
 * @property {string[]} disagreementFields                    Which of those fields differ
 */

/**
 * Compares a group of same-event readings from possibly-different sources.
 *
 * If more than one reading is marked `authoritative_for_local_warning`, the
 * first one is returned as `authoritative` and this is treated as a
 * disagreement in its own right — that shouldn't happen given the doc's
 * source hierarchy (only SIMS is authoritative for local warnings) and is
 * surfaced rather than silently resolved, since silently picking one would
 * be exactly the kind of invented local proxy the doc warns against.
 *
 * @param {import("./Alert.js").Alert[]} readings
 * @returns {SourceComparison}
 */
export function compareSourceReadings(readings) {
  if (!readings || readings.length === 0) {
    throw new Error("compareSourceReadings requires at least one reading");
  }

  const authoritativeReadings = readings.filter((r) => r.authoritative_for_local_warning);
  const disagreementFields = COMPARABLE_FIELDS.filter((field) => {
    const values = new Set(readings.map((r) => r[field]));
    return values.size > 1;
  });

  if (authoritativeReadings.length > 1 && !disagreementFields.includes("source")) {
    disagreementFields.push("source");
  }

  return {
    readings,
    authoritative: authoritativeReadings[0] ?? null,
    disagreement: disagreementFields.length > 0,
    disagreementFields,
  };
}
