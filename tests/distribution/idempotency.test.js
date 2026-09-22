import { describe, it, expect } from "vitest";
import { computeIdempotencyKey } from "../../src/distribution/idempotency.js";

describe("computeIdempotencyKey", () => {
  it("is stable for the same alert x recipient x channel", () => {
    const a = computeIdempotencyKey("alert-1", "sub-1", "sms");
    const b = computeIdempotencyKey("alert-1", "sub-1", "sms");
    expect(a).toBe(b);
  });

  it("differs if any of the three inputs differ", () => {
    const base = computeIdempotencyKey("alert-1", "sub-1", "sms");
    expect(computeIdempotencyKey("alert-2", "sub-1", "sms")).not.toBe(base);
    expect(computeIdempotencyKey("alert-1", "sub-2", "sms")).not.toBe(base);
    expect(computeIdempotencyKey("alert-1", "sub-1", "cell_broadcast")).not.toBe(base);
  });

  it("does not collide across a shifted delimiter (e.g. 'a1'+'b' vs 'a'+'1b')", () => {
    const a = computeIdempotencyKey("a1", "b", "sms");
    const b = computeIdempotencyKey("a", "1b", "sms");
    expect(a).not.toBe(b);
  });
});
