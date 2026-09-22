import { createAlert } from "./Alert.js";

/**
 * Grace period added to an interval-overlap check between two alerts'
 * validity windows. Real SIMS reissues don't produce strictly overlapping
 * windows — e.g. one observed "Number 217" reissue arrived 1h32m after the
 * prior message's own `expires` had already passed (16:00 -> next sent at
 * 17:32). A strict overlap check would treat that as two different events,
 * which is wrong.
 *
 * Originally set to 6h (the doc's stated *lower* bound for reissue cadence,
 * "roughly every 6-24 hours"). The TC Maila replay (tests/replay/) caught
 * this as too tight: a late-cycle reissue landed ~16h after the prior
 * message's expiry — well within the doc's own normal range — and 6h grace
 * incorrectly split one continuous event into two event_ids. Using the
 * lower bound as the grace period was the bug: the grace period has to
 * cover the full documented cadence range, not just its fast end. Set to
 * the doc's stated *upper* bound instead.
 */
export const DEFAULT_ADJACENCY_GRACE_MS = 24 * 60 * 60 * 1000;

function toEpochMs(isoString) {
  if (!isoString) return null;
  const ms = Date.parse(isoString);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * CAP's `effective` defaults to `sent` when absent (CAP 1.2 spec) — but
 * SIMS never populates `effective` at all, and `sent` isn't part of the
 * Alert schema (docs/PROJECT_HANDOFF.md's field list has no slot for it).
 * `retrieved_at` is the closest proxy actually on the schema: it's set at
 * fetch time, which for a polled feed is minutes behind the real `sent`
 * time, not hours — close enough for a 6h-grade window check. If ingestion
 * starts carrying CAP `sent` in source_metadata, prefer that over this.
 */
function validityWindow(alert) {
  const start = toEpochMs(alert.effective) ?? toEpochMs(alert.retrieved_at);
  const end = toEpochMs(alert.expires);
  return { start, end };
}

function windowsOverlapWithGrace(a, b, graceMs) {
  const winA = validityWindow(a);
  const winB = validityWindow(b);
  if (winA.start === null || winA.end === null || winB.start === null || winB.end === null) {
    return false;
  }
  return winA.start <= winB.end + graceMs && winB.start <= winA.end + graceMs;
}

function sameHazardType(a, b) {
  if (!a.hazard_type || !b.hazard_type) return false;
  return a.hazard_type.trim().toLowerCase() === b.hazard_type.trim().toLowerCase();
}

function eventCodesOf(alert) {
  return alert.source_metadata?.eventCode ?? [];
}

/**
 * Compares CAP `eventCode` entries (each `{valueName, value}`) between two
 * alerts. Returns `null`, not `false`, when either side has none — that's
 * the "not applicable, fall back" signal matchesEventPattern uses, distinct
 * from "compared and didn't match".
 */
function sameEventCode(a, b) {
  const codesA = eventCodesOf(a);
  const codesB = eventCodesOf(b);
  if (codesA.length === 0 || codesB.length === 0) return null;
  return codesA.some((ca) => codesB.some((cb) => ca.valueName === cb.valueName && ca.value === cb.value));
}

/**
 * The "eventCode/headline pattern" half of the match, preferring eventCode
 * when both alerts have one and falling back to hazard_type when either
 * doesn't (e.g. a source/older payload that never populated it).
 */
function matchesEventPattern(a, b) {
  const eventCodeResult = sameEventCode(a, b);
  if (eventCodeResult !== null) return eventCodeResult;
  return sameHazardType(a, b);
}

/**
 * True if `a` and `b` are reissues of the same underlying warning episode
 * rather than two independent events. Pure — no I/O, no store lookups.
 *
 * Approach, and why it isn't exactly what the handoff doc describes:
 *
 * - The doc says to match on "eventCode/headline pattern". SIMS's CAP
 *   `eventCode` (e.g. "OET-218") turns out to stay constant across an
 *   entire reissue episode (verified live: three consecutive reissues
 *   numbered 216-218 in their headlines all carried eventCode "OET-218"),
 *   so it's used as the primary signal now that ingestion carries it in
 *   source_metadata. `hazard_type` (CAP's `<event>`, e.g. "Strong Wind") is
 *   the fallback for a source or older payload that doesn't populate
 *   eventCode: for every SIMS sample seen, it's exactly the stable
 *   substring of the headline left after stripping the sequence number and
 *   alert-color suffix, so it serves the same "headline pattern" role
 *   without needing raw headline text, which isn't on the Alert schema.
 * - "Overlapping validity window" is read as "overlapping, or separated by
 *   no more than DEFAULT_ADJACENCY_GRACE_MS" — see that constant's comment.
 *   A strict overlap check fails against real observed data.
 * - Only same-source pairs are matched. Cross-source correlation (a SIMS
 *   alert and a JTWC bulletin describing the same storm) would need
 *   geographic alignment across sources with no shared vocabulary or
 *   identifier scheme, which is a geo-mapping concern and out of scope
 *   here. sourceHierarchy.js instead works on alerts that already share an
 *   event_id, however that grouping was decided.
 *
 * @param {import("./Alert.js").Alert} a
 * @param {import("./Alert.js").Alert} b
 * @param {{ adjacencyGraceMs?: number }} [options]
 * @returns {boolean}
 */
export function isSameEvent(a, b, options = {}) {
  const adjacencyGraceMs = options.adjacencyGraceMs ?? DEFAULT_ADJACENCY_GRACE_MS;

  if (a.alert_id === b.alert_id) return true;
  if (a.source !== b.source) return false;

  return matchesEventPattern(a, b) && windowsOverlapWithGrace(a, b, adjacencyGraceMs);
}

/**
 * Runs incoming alerts against a store of recently-seen ones, assigning each
 * a real, shared `event_id` when it matches a prior reading (per
 * isSameEvent) rather than leaving the ingestion-stage placeholder
 * (event_id = alert_id) in place. Matching a prior reading means "same
 * event_id" — it does not mean "suppress this alert"; whether a matched
 * reissue is worth sending onward is a lifecycle.js decision, not this
 * service's.
 *
 * Keeps every reading per event (not just the latest) so sourceHierarchy.js
 * can compare them later.
 */
export class DedupService {
  /**
   * @param {{ adjacencyGraceMs?: number }} [options]
   */
  constructor(options = {}) {
    this.adjacencyGraceMs = options.adjacencyGraceMs ?? DEFAULT_ADJACENCY_GRACE_MS;
    /** @type {Map<string, import("./Alert.js").Alert[]>} */
    this.readingsByEventId = new Map();
  }

  /**
   * @param {import("./Alert.js").Alert} alert
   * @returns {{
   *   alert: import("./Alert.js").Alert,
   *   isReissue: boolean,
   *   matchedAlert: import("./Alert.js").Alert|null,
   *   priorReadingsForEvent: import("./Alert.js").Alert[],
   * }}
   */
  ingest(alert) {
    const matchedAlert = this.findMatch(alert);
    const eventId = matchedAlert ? matchedAlert.event_id : alert.event_id;
    const resolvedAlert = eventId === alert.event_id ? alert : createAlert({ ...alert, event_id: eventId });

    const priorReadingsForEvent = this.readingsByEventId.get(eventId) ?? [];
    this.readingsByEventId.set(eventId, [...priorReadingsForEvent, resolvedAlert]);

    return {
      alert: resolvedAlert,
      isReissue: Boolean(matchedAlert),
      matchedAlert: matchedAlert ?? null,
      priorReadingsForEvent,
    };
  }

  /**
   * Compares against the most recent reading of each known event, not every
   * historical reading — same rationale as chaining reissues one after
   * another rather than all-pairs.
   *
   * @param {import("./Alert.js").Alert} alert
   * @returns {import("./Alert.js").Alert|null}
   */
  findMatch(alert) {
    for (const readings of this.readingsByEventId.values()) {
      const mostRecent = readings[readings.length - 1];
      if (isSameEvent(mostRecent, alert, { adjacencyGraceMs: this.adjacencyGraceMs })) {
        return mostRecent;
      }
    }
    return null;
  }

  /**
   * @param {string} eventId
   * @returns {import("./Alert.js").Alert[]}
   */
  getReadingsForEvent(eventId) {
    return this.readingsByEventId.get(eventId) ?? [];
  }
}
