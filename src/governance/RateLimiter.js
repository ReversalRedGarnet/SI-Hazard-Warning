/**
 * docs/PROJECT_HANDOFF.md's threat model names "a compromised admin account"
 * and "malicious insider or unauthorized operator" as things to design
 * against, with "rate limits" listed alongside MFA/RBAC/audit logging as a
 * control each needing "a testable acceptance test — not just that they
 * exist." This is that control: a basic per-user, per-channel limiter, not
 * a distributed/production-grade one (no shared backing store — a real
 * deployment running more than one process needs this backed by something
 * like Redis, same caveat as AuditLog's in-memory array).
 *
 * Fixed-window, not token-bucket: simpler to reason about and test
 * deterministically (a token bucket's continuous refill needs either a
 * controllable clock or non-deterministic timing tolerances in tests; a
 * fixed window just needs "how many calls landed in the current window").
 * The tradeoff is the standard fixed-window one — a burst straddling a
 * window boundary can briefly allow close to 2x the nominal limit — judged
 * acceptable for a first pass at this control.
 */

export class RateLimitExceededError extends Error {
  constructor(key, retryAfterMs) {
    super(`Rate limit exceeded for ${key}; retry after ~${retryAfterMs}ms`);
    this.name = "RateLimitExceededError";
    this.retryAfterMs = retryAfterMs;
  }
}

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 60_000;

export class RateLimiter {
  /**
   * @param {{ limit?: number, windowMs?: number, now?: () => number }} [options]
   */
  constructor(options = {}) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? Date.now;
    /** @type {Map<string, { windowStart: number, count: number }>} */
    this.bucketsByKey = new Map();
  }

  /**
   * @param {string} userId
   * @param {string} channel
   * @returns {string}
   */
  keyFor(userId, channel) {
    return `${userId}\u0000${channel}`;
  }

  /**
   * Checks (and, if allowed, consumes) one unit of this user+channel's
   * current window. One call to this represents one "send action" — see
   * ApprovedSend.js, which calls this once per sendApproved() invocation
   * (i.e. once per broadcast, not once per recipient), since the threat
   * this defends against is a compromised account triggering excessive
   * *send actions*, not a legitimate large broadcast's fan-out.
   *
   * @param {string} userId
   * @param {string} channel
   * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
   */
  check(userId, channel) {
    const key = this.keyFor(userId, channel);
    const now = this.now();
    let bucket = this.bucketsByKey.get(key);

    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      bucket = { windowStart: now, count: 0 };
      this.bucketsByKey.set(key, bucket);
    }

    if (bucket.count >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterMs: bucket.windowStart + this.windowMs - now };
    }

    bucket.count += 1;
    return { allowed: true, remaining: this.limit - bucket.count, retryAfterMs: 0 };
  }
}
