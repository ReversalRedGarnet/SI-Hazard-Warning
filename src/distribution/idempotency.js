import { sha256Hex } from "../shared/hash.js";

/**
 * A stable key per alert x recipient x channel (docs/PROJECT_HANDOFF.md:
 * "a timeout after a gateway accepts a request can cause a retry and
 * duplicate delivery. Track a stable key per alert x recipient x
 * channel"). Deliberately a pure hash of the three identifiers — no
 * randomness, no timestamp, no counter — so recomputing it from the same
 * three inputs always finds the same record, including from a fresh
 * process after a restart (this in-memory prototype's store wouldn't
 * survive that, but the key itself is designed for a persistent store
 * that would).
 *
 * @param {string} alertId
 * @param {string} recipientId
 * @param {string} channel
 * @returns {string}
 */
export function computeIdempotencyKey(alertId, recipientId, channel) {
  // NUL-separated, not e.g. ":" — alert_id/recipient_id could plausibly
  // contain punctuation (CAP identifiers are URNs), and a collidable
  // separator would let two different triples hash to the same key.
  return sha256Hex(`${alertId}\u0000${recipientId}\u0000${channel}`);
}
