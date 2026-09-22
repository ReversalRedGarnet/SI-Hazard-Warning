/**
 * Exact schema from docs/PROJECT_HANDOFF.md's "Distribution" section:
 * "OutboundMessage: alert_id, recipient_id, channel, provider,
 * idempotency_key, attempt, provider_message_id, status (QUEUED /
 * SUBMITTED / ACCEPTED / DELIVERED / FAILED / UNKNOWN)".
 *
 * One OutboundMessage row represents one alert x recipient x channel
 * delivery attempt-in-progress — see idempotency.js for how the key that
 * identifies "the same send" (as opposed to "a new attempt at the same
 * send") is computed.
 */

export const OutboundMessageStatus = Object.freeze({
  QUEUED: "QUEUED",
  SUBMITTED: "SUBMITTED",
  ACCEPTED: "ACCEPTED",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  /** The provider call didn't return a definite accept/reject — e.g. a
   * network timeout. Distinct from FAILED: retrying is expected to be
   * necessary, but a retry must not be treated as "the first attempt
   * failed cleanly, so a fresh send is safe" — see NotificationService.js. */
  UNKNOWN: "UNKNOWN",
});

/**
 * @typedef {Object} OutboundMessage
 * @property {string} alert_id
 * @property {string} recipient_id
 * @property {string} channel               Free-text distribution channel (e.g. "sms") — not an enum, so Cell Broadcast/other channels can be added later without a schema change
 * @property {string} provider              Name of the provider that handled (or is handling) this attempt
 * @property {string} idempotency_key       Stable per alert x recipient x channel — see idempotency.js
 * @property {number} attempt               1 for the first try, incremented on each retry of the same idempotency_key
 * @property {string|null} provider_message_id
 * @property {string} status                One of OutboundMessageStatus
 */

const REQUIRED_FIELDS = ["alert_id", "recipient_id", "channel", "provider", "idempotency_key", "attempt", "status"];

/**
 * @param {Partial<OutboundMessage>} fields
 * @returns {Readonly<OutboundMessage>}
 */
export function createOutboundMessage(fields) {
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] === undefined || fields[key] === null) {
      throw new Error(`OutboundMessage is missing required field: ${key}`);
    }
  }
  if (!Object.values(OutboundMessageStatus).includes(fields.status)) {
    throw new Error(`OutboundMessage has invalid status: ${fields.status}`);
  }

  return Object.freeze({
    alert_id: fields.alert_id,
    recipient_id: fields.recipient_id,
    channel: fields.channel,
    provider: fields.provider,
    idempotency_key: fields.idempotency_key,
    attempt: fields.attempt,
    provider_message_id: fields.provider_message_id ?? null,
    status: fields.status,
  });
}
