import { describe, it, expect } from "vitest";
import { RateLimiter } from "../../src/governance/RateLimiter.js";

describe("RateLimiter", () => {
  it("allows up to the configured limit, then denies further checks in the same window", () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });

    expect(limiter.check("user-1", "sms")).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.check("user-1", "sms")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check("user-1", "sms")).toMatchObject({ allowed: true, remaining: 0 });

    const denied = limiter.check("user-1", "sms");
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("keys independently per user — one user's exhausted limit doesn't affect another's", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });

    expect(limiter.check("user-1", "sms").allowed).toBe(true);
    expect(limiter.check("user-1", "sms").allowed).toBe(false);
    expect(limiter.check("user-2", "sms").allowed).toBe(true);
  });

  it("keys independently per channel — the same user on a different channel has a separate budget", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });

    expect(limiter.check("user-1", "sms").allowed).toBe(true);
    expect(limiter.check("user-1", "sms").allowed).toBe(false);
    expect(limiter.check("user-1", "cell_broadcast").allowed).toBe(true);
  });

  it("resets the window after windowMs has elapsed", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ limit: 1, windowMs: 1_000, now: () => now });

    expect(limiter.check("user-1", "sms").allowed).toBe(true);
    expect(limiter.check("user-1", "sms").allowed).toBe(false);

    now += 1_000; // exactly one window later
    expect(limiter.check("user-1", "sms").allowed).toBe(true);
  });

  it("uses default limit/window when none are configured", () => {
    const limiter = new RateLimiter();
    expect(limiter.limit).toBeGreaterThan(0);
    expect(limiter.windowMs).toBeGreaterThan(0);
    expect(limiter.check("user-1", "sms").allowed).toBe(true);
  });
});
