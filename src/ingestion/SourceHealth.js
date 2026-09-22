/**
 * docs/PROJECT_HANDOFF.md's acceptance criterion: "Stale source data
 * produces a SOURCE INTERRUPTION state" — modeled here as four states, not
 * one, since "the feed is behind" and "the feed is definitely down" call
 * for different operator responses. Named SOURCE_HEALTH rather than
 * SOURCE_INTERRUPTION as the concept's name, since it needs a value for
 * the normal case too, not only the interruption case.
 *
 * Pure domain concept, deliberately with no clock/state of its own — see
 * computeSourceHealth() below. Tracking *state over time* (when the last
 * successful poll was, whether the last attempt errored) is a composition
 * concern owned by whatever polls a HazardSource repeatedly
 * (HazardWarningSystem), not by this module or by the adapter itself
 * (consistent with HazardSource.js's own "kept intentionally thin" note).
 */
export const SourceHealthStatus = Object.freeze({
  /** Last poll succeeded within the expected cadence. */
  HEALTHY: "HEALTHY",
  /** Last successful poll is older than expected, but not alarmingly so — could be ordinary jitter. */
  DELAYED: "DELAYED",
  /** Last successful poll is old enough that the data can no longer be trusted as current. */
  STALE: "STALE",
  /** The most recent poll attempt itself failed outright, or there has never been a successful poll. */
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * docs/PROJECT_HANDOFF.md's own lifecycle.js commentary cites "polling
 * every 15 minutes" as the expected real cadence — used as the default
 * expected interval here. These threshold multiples (2x/4x) are this
 * stage's own judgment call, not specified anywhere in the doc: DELAYED at
 * 2x gives room for a single missed/slow poll cycle before raising any
 * concern; STALE at 4x means at least three consecutive poll cycles have
 * been missed, which is no longer plausibly just jitter. Named constants,
 * not magic numbers, specifically so a future tuning pass has one place to
 * change them.
 */
export const DEFAULT_EXPECTED_POLL_INTERVAL_MS = 15 * 60 * 1000;
export const DELAYED_AFTER_INTERVAL_MULTIPLE = 2;
export const STALE_AFTER_INTERVAL_MULTIPLE = 4;

/**
 * Pure function: given when the source was last polled successfully and
 * whether the most recent attempt (successful or not) errored outright,
 * computes the current health status. No I/O, no stored state — the caller
 * supplies `now` explicitly (so tests can use a fake clock instead of real
 * waiting) and is responsible for remembering `lastSuccessAt`/
 * `lastAttemptErrored` between calls.
 *
 * `lastAttemptErrored` takes priority over staleness: a source that just
 * failed outright is UNAVAILABLE *right now*, regardless of how recent its
 * last good poll was — a single failure after months of healthy polling is
 * still worth surfacing as "we don't currently know," not smoothed over by
 * a recent-looking `lastSuccessAt`. `lastSuccessAt === null` (never
 * successfully polled at all) is folded into UNAVAILABLE too, for the same
 * "we don't know" reasoning — there's no fifth state for "never tried yet"
 * since the doc only names the one interruption state to add.
 *
 * @param {{
 *   lastSuccessAt: number|null,
 *   lastAttemptErrored: boolean,
 *   now: number,
 *   expectedPollIntervalMs?: number,
 * }} params
 * @returns {string} One of SourceHealthStatus's values
 */
export function computeSourceHealth({ lastSuccessAt, lastAttemptErrored, now, expectedPollIntervalMs = DEFAULT_EXPECTED_POLL_INTERVAL_MS }) {
  if (lastAttemptErrored || lastSuccessAt === null || lastSuccessAt === undefined) {
    return SourceHealthStatus.UNAVAILABLE;
  }

  const elapsedMs = now - lastSuccessAt;
  if (elapsedMs >= expectedPollIntervalMs * STALE_AFTER_INTERVAL_MULTIPLE) {
    return SourceHealthStatus.STALE;
  }
  if (elapsedMs >= expectedPollIntervalMs * DELAYED_AFTER_INTERVAL_MULTIPLE) {
    return SourceHealthStatus.DELAYED;
  }
  return SourceHealthStatus.HEALTHY;
}
