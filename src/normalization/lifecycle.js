/**
 * Alert lifecycle state machine (docs/PROJECT_HANDOFF.md, "Governance,
 * security & operating modes"): NEW -> WATCH -> WARNING -> ESCALATED ->
 * UPDATED -> CANCELLED/ALL CLEAR, with explicit send-triggers (new warning,
 * severity increase, affected-area increase, material forecast change,
 * cancellation).
 *
 * The doc names these six states and five triggers but doesn't define
 * severity thresholds, what counts as a "material forecast change", or
 * whether the arrows are a strict enforced order. This module makes those
 * calls explicitly rather than silently — see the comments below and the
 * summary handed back with this change for the full list.
 */

export const LifecycleState = Object.freeze({
  NEW: "NEW",
  WATCH: "WATCH",
  WARNING: "WARNING",
  ESCALATED: "ESCALATED",
  UPDATED: "UPDATED",
  CANCELLED: "CANCELLED",
  ALL_CLEAR: "ALL_CLEAR",
});

const SEVERITY_ORDER = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };

/** Judgment call: no real SIMS message has ever been below Severe, so this
 * boundary is untested against live data. Minor/Moderate -> WATCH tier,
 * Severe/Extreme -> WARNING tier, matching common met-agency usage. */
const WARNING_TIER_SEVERITIES = new Set(["Severe", "Extreme"]);

function severityRank(severity) {
  return SEVERITY_ORDER[severity] ?? SEVERITY_ORDER.Unknown;
}

function tierFor(severity) {
  return WARNING_TIER_SEVERITIES.has(severity) ? LifecycleState.WARNING : LifecycleState.WATCH;
}

function areaCount(alert) {
  return alert.alert_areas?.length ?? 0;
}

/**
 * Proxy for "affected-area increase": compares how many area entries are
 * listed, not actual geographic coverage. Real area-in-km^2 comparison needs
 * polygon geometry math, which belongs to the geo-mapping stage (out of
 * scope here) — this is a stand-in until that exists.
 */
function hasAreaIncrease(previous, current) {
  return areaCount(current) > areaCount(previous);
}

/**
 * "Material forecast change" isn't defined by the doc beyond naming it
 * alongside "severity increase" and "affected-area increase" as distinct
 * triggers, so it's read here as: urgency or certainty changed at all
 * (either direction). Severity itself is deliberately excluded since it's
 * already its own named trigger.
 *
 * An expiry-extension check was tried and dropped: real reissues routinely
 * push `expires` out by ~15h as part of normal cadence (confirmed against
 * the real 217 reissue pair — see fixtures.js), so "expiry moved out" can't
 * distinguish a material change from a routine "still active" reissue
 * without a cadence baseline this module doesn't have. Telling a genuinely
 * surprising expiry extension apart from a routine one is left unsolved
 * here rather than guessed at.
 */
function hasMaterialForecastChange(previous, current) {
  if (previous.urgency !== current.urgency) return true;
  if (previous.certainty !== current.certainty) return true;
  return false;
}

/**
 * Derives the lifecycle transition for a same-event alert given the
 * previous message for that event (or null if this is the first message
 * seen for that event_id — establish that with dedup.js's DedupService
 * before calling this). Pure function: no I/O, no mutation.
 *
 * The doc's arrow notation (NEW -> WATCH -> WARNING -> ...) reads like an
 * enforced sequence, but real SIMS data can't satisfy that literally: every
 * observed first message already arrives at Severe/Immediate, i.e. straight
 * into WARNING tier, with no WATCH-tier message ever preceding it. This
 * function therefore treats the six labels as a per-transition
 * classification (what kind of change just happened), not a strict FSM that
 * forbids skipping a state.
 *
 * ALL_CLEAR is deliberately never returned automatically. The doc is
 * explicit that an all-clear must come from an authorized source, not be
 * inferred from feed data (NDMO kept operations active past a cancelled
 * warning for exactly this reason) — so that transition belongs to the
 * human-approval workflow, not this function. A msgType=Cancel message
 * still produces CANCELLED here; promoting a cancellation to an all-clear is
 * an operator decision this module doesn't make.
 *
 * @param {import("./Alert.js").Alert|null} previous
 * @param {import("./Alert.js").Alert} current
 * @returns {{ state: string, sendTrigger: boolean, reasons: string[] }}
 */
export function deriveLifecycleTransition(previous, current) {
  if (current.msg_type === "Cancel") {
    return { state: LifecycleState.CANCELLED, sendTrigger: true, reasons: ["cancellation"] };
  }

  if (!previous) {
    return { state: LifecycleState.NEW, sendTrigger: true, reasons: ["new warning"] };
  }

  const reasons = [];
  if (severityRank(current.severity) > severityRank(previous.severity)) reasons.push("severity increase");
  if (hasAreaIncrease(previous, current)) reasons.push("affected-area increase");
  if (hasMaterialForecastChange(previous, current)) reasons.push("material forecast change");

  if (reasons.length > 0) {
    return { state: LifecycleState.ESCALATED, sendTrigger: true, reasons };
  }

  if (severityRank(current.severity) < severityRank(previous.severity)) {
    // Downgrade: not one of the doc's five named triggers, but suppressing
    // news that a threat has lessened seems like the wrong default: judgment
    // call, flagged.
    return { state: LifecycleState.WATCH, sendTrigger: true, reasons: ["downgrade"] };
  }

  return { state: LifecycleState.UPDATED, sendTrigger: false, reasons: [] };
}

export { tierFor };
