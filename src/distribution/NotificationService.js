import { createOutboundMessage, OutboundMessageStatus } from "./OutboundMessage.js";
import { computeIdempotencyKey } from "./idempotency.js";
import { GatewayTimeoutError } from "./SmsProvider.js";
import { ConstructionStatus } from "./messageConstruction.js";

/**
 * Statuses where a record already represents an in-flight-or-done send —
 * calling send() again for the same alert x recipient x channel must not
 * re-submit to the provider while in one of these. FAILED and UNKNOWN are
 * the two statuses where a retry is exactly the right thing to do: FAILED
 * means the gateway gave a definite rejection (a fresh attempt may still
 * be worth trying), UNKNOWN means the gateway's answer was never learned
 * (docs/PROJECT_HANDOFF.md's specific "timeout after accept" scenario).
 */
const IN_FLIGHT_OR_DONE = new Set([
  OutboundMessageStatus.QUEUED,
  OutboundMessageStatus.SUBMITTED,
  OutboundMessageStatus.ACCEPTED,
  OutboundMessageStatus.DELIVERED,
]);

/**
 * The provider-agnostic sender. docs/PROJECT_HANDOFF.md: "Build a
 * swappable provider layer, don't hard-code a gateway" and the
 * idempotency requirement ("a timeout after a gateway accepts a request
 * can cause a retry and duplicate delivery"). Owns the retry/dedup
 * decision itself — it does not rely on the provider being idempotent,
 * since MockSMSProvider (and likely a real aggregator) has no reason to
 * deduplicate on our behalf.
 */
export class NotificationService {
  /**
   * @param {{ provider: import("./SmsProvider.js").SmsProvider, store: import("./OutboundMessageStore.js").OutboundMessageStore }} deps
   */
  constructor({ provider, store }) {
    this.provider = provider;
    this.store = store;
  }

  /**
   * Sends (or, if this exact alert x recipient x channel is already
   * in-flight or done, returns the existing record instead of resending).
   *
   * @param {{
   *   alertId: string,
   *   recipient: { recipientId: string, phoneNumber: string },
   *   channel: string,
   *   message: import("./messageConstruction.js").ConstructedMessage,
   * }} params
   * @returns {Promise<{ outboundMessage: import("./OutboundMessage.js").OutboundMessage, deduped: boolean }>}
   */
  async send({ alertId, recipient, channel, message }) {
    if (message.status !== ConstructionStatus.APPROVED) {
      throw new Error(`Cannot send a message that isn't APPROVED (status: ${message.status})`);
    }

    const idempotencyKey = computeIdempotencyKey(alertId, recipient.recipientId, channel);
    const existing = this.store.findByIdempotencyKey(idempotencyKey);

    if (existing && IN_FLIGHT_OR_DONE.has(existing.status)) {
      return { outboundMessage: existing, deduped: true };
    }

    let record = createOutboundMessage({
      alert_id: alertId,
      recipient_id: recipient.recipientId,
      channel,
      provider: this.provider.providerName,
      idempotency_key: idempotencyKey,
      attempt: existing ? existing.attempt + 1 : 1,
      provider_message_id: existing?.provider_message_id ?? null,
      status: OutboundMessageStatus.QUEUED,
    });
    this.store.save(record);

    record = createOutboundMessage({ ...record, status: OutboundMessageStatus.SUBMITTED });
    this.store.save(record);

    try {
      const result = await this.provider.send(recipient, message.text);
      record = createOutboundMessage({
        ...record,
        status: result.accepted ? OutboundMessageStatus.ACCEPTED : OutboundMessageStatus.FAILED,
        provider_message_id: result.providerMessageId ?? record.provider_message_id,
      });
    } catch (err) {
      if (!(err instanceof GatewayTimeoutError)) throw err;
      record = createOutboundMessage({ ...record, status: OutboundMessageStatus.UNKNOWN });
    }

    this.store.save(record);
    return { outboundMessage: record, deduped: false };
  }
}
