import { describe, it, expect } from "vitest";
import {
  computeSourceHealth,
  SourceHealthStatus,
  DEFAULT_EXPECTED_POLL_INTERVAL_MS,
  DELAYED_AFTER_INTERVAL_MULTIPLE,
  STALE_AFTER_INTERVAL_MULTIPLE,
} from "../../src/ingestion/SourceHealth.js";

const INTERVAL = DEFAULT_EXPECTED_POLL_INTERVAL_MS;

describe("computeSourceHealth", () => {
  it("is HEALTHY right after a successful poll", () => {
    const now = 1_000_000;
    expect(
      computeSourceHealth({ lastSuccessAt: now, lastAttemptErrored: false, now, expectedPollIntervalMs: INTERVAL }),
    ).toBe(SourceHealthStatus.HEALTHY);
  });

  it("is HEALTHY just under the DELAYED threshold", () => {
    const lastSuccessAt = 0;
    const now = INTERVAL * DELAYED_AFTER_INTERVAL_MULTIPLE - 1;
    expect(
      computeSourceHealth({ lastSuccessAt, lastAttemptErrored: false, now, expectedPollIntervalMs: INTERVAL }),
    ).toBe(SourceHealthStatus.HEALTHY);
  });

  it("becomes DELAYED exactly at 2x the expected poll interval", () => {
    const lastSuccessAt = 0;
    const now = INTERVAL * DELAYED_AFTER_INTERVAL_MULTIPLE;
    expect(
      computeSourceHealth({ lastSuccessAt, lastAttemptErrored: false, now, expectedPollIntervalMs: INTERVAL }),
    ).toBe(SourceHealthStatus.DELAYED);
  });

  it("becomes STALE exactly at 4x the expected poll interval", () => {
    const lastSuccessAt = 0;
    const now = INTERVAL * STALE_AFTER_INTERVAL_MULTIPLE;
    expect(
      computeSourceHealth({ lastSuccessAt, lastAttemptErrored: false, now, expectedPollIntervalMs: INTERVAL }),
    ).toBe(SourceHealthStatus.STALE);
  });

  it("is UNAVAILABLE when the last attempt errored outright, even if the last success was recent", () => {
    const now = 1_000_000;
    expect(
      computeSourceHealth({ lastSuccessAt: now - 1, lastAttemptErrored: true, now, expectedPollIntervalMs: INTERVAL }),
    ).toBe(SourceHealthStatus.UNAVAILABLE);
  });

  it("is UNAVAILABLE when there has never been a successful poll", () => {
    const now = 1_000_000;
    expect(
      computeSourceHealth({ lastSuccessAt: null, lastAttemptErrored: false, now, expectedPollIntervalMs: INTERVAL }),
    ).toBe(SourceHealthStatus.UNAVAILABLE);
  });

  it("uses DEFAULT_EXPECTED_POLL_INTERVAL_MS when none is given", () => {
    const now = 1_000_000;
    expect(computeSourceHealth({ lastSuccessAt: now, lastAttemptErrored: false, now })).toBe(
      SourceHealthStatus.HEALTHY,
    );
  });
});
