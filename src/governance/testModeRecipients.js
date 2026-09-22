import { sha256Hex } from "../shared/hash.js";

/**
 * A small, obviously-fake phone number pool used only when
 * NotificationService is running in EnvironmentMode.TEST (see
 * src/distribution/NotificationService.js). None of these are dialable or
 * shaped like a real +677 (Solomon Islands) number on purpose — they exist
 * to make it visually obvious in logs/test output that a send was
 * redirected, not delivered.
 */
export const TEST_MODE_SYNTHETIC_PHONE_NUMBERS = Object.freeze([
  "+000000000001",
  "+000000000002",
  "+000000000003",
  "+000000000004",
  "+000000000005",
]);

/**
 * Deterministically maps a recipientId to one of the synthetic numbers
 * above. Deterministic (not random) so the same recipient always lands on
 * the same synthetic number within a test run — useful for asserting
 * "these two distinct recipients produced two distinct sends" even under
 * the TEST-mode override, without ever touching the recipient's real
 * phoneNumber field to do it.
 *
 * @param {string} recipientId
 * @returns {string}
 */
export function syntheticPhoneNumberFor(recipientId) {
  const digest = sha256Hex(recipientId);
  const index = parseInt(digest.slice(0, 8), 16) % TEST_MODE_SYNTHETIC_PHONE_NUMBERS.length;
  return TEST_MODE_SYNTHETIC_PHONE_NUMBERS[index];
}
