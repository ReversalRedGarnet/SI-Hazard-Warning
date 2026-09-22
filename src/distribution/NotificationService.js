import { createOutboundMessage, OutboundMessageStatus } from "./OutboundMessage.js";
import { computeIdempotencyKey } from "./idempotency.js";
import { GatewayTimeoutError } from "./SmsProvider.js";
import { ConstructionStatus } from "./messageConstruction.js";
import { EnvironmentMode, requireEnvironmentMode } from "../governance/EnvironmentMode.js";
import { syntheticPhoneNumberFor } from "../governance/testModeRecipients.js";

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
 *
 * Also the enforcement point for the environment-mode safety rail
 * (src/governance/EnvironmentMode.js): `environmentMode` is a required
 * constructor argument (validated via requireEnvironmentMode, which throws
 * rather than defaulting) so this can never silently run in an
 * unconfigured mode. When that mode is TEST, send() rewrites the outbound
 * phoneNumber to a synthetic one (src/governance/testModeRecipients.js)
 * *unconditionally*, inside send() itself, before the provider is ever
 * called — not as a check a caller could forget, but as the one code path
 * every send must go through to reach a provider at all. Passing real
 * subscriber data through in TEST mode still cannot reach a real number.
 *
 * Design decision — send() stays directly callable, with no approval
 * reference required here: making an approval token a required
 * constructor/call argument would be the safer default in isolation, but
 * this class already has ~15+ direct call sites across
 * tests/distribution/notificationService.test.js,
 * tests/subscribers/endToEnd.test.js, and
 * tests/governance/notificationServiceTestMode.test.js that test its own
 * retry/dedup/segment/environment-mode behavior in isolation from any
 * approval workflow — requiring a token here would force all of them to
 * fabricate one, which is exactly the "rebuild the module" this stage was
 * scoped to avoid. The actual RBAC enforcement point is
 * src/governance/ApprovedSend.js: it's the only path that both calls
 * send() and verifies a matching ApprovalWorkflow request reached
 * APPROVED first. The residual risk this leaves is real and explicit: any
 * future caller that reaches for `new NotificationService(...).send(...)`
 * directly (in non-test code) bypasses governance entirely, and nothing
 * in this class stops that. Closing that gap for good would mean either
 * this token requirement (with the test-scaffolding cost above) or an
 * unforgeable capability object only ApprovedSend.js can mint — both
 * bigger changes than "wire the two together," so neither was built here.
 */
export class NotificationService {
  /**
   * @param {{
   *   provider: import("./SmsProvider.js").SmsProvider,
   *   store: import("./OutboundMessageStore.js").OutboundMessageStore,
   *   environmentMode: string,
   *   auditLog?: import("../governance/AuditLog.js").AuditLog,
   * }} deps
   */
  constructor({ provider, store, environmentMode, auditLog }) {
    this.provider = provider;
    this.store = store;
    this.environmentMode = requireEnvironmentMode(environmentMode);
    this.auditLog = auditLog ?? null;
  }

  /**
   * Sends (or, if this exact alert x recipient x channel is already
   * in-flight or done, returns the existing record instead of resending).
   *
   * `triggeredBy` is optional and purely for audit attribution (who/what
   * role caused this particular send call) — it plays no role in the
   * approval decision itself. NotificationService only ever checks that
   * `message.status === APPROVED`; it doesn't know or care which
   * ApprovalWorkflow request produced that approval, so nothing here
   * re-verifies the approval workflow's role/approver rules. That
   * verification — checking a matching ApprovalWorkflow request actually
   * reached APPROVED, under the right profile, for this exact alert +
   * message, before ever calling send() — is done by the orchestrator,
   * src/governance/ApprovedSend.js (see this class's own docstring above),
   * not by this method itself.
   *
   * @param {{
   *   alertId: string,
   *   recipient: { recipientId: string, phoneNumber: string },
   *   channel: string,
   *   message: import("./messageConstruction.js").ConstructedMessage,
   *   triggeredBy?: import("../governance/Role.js").User,
   * }} params
   * @returns {Promise<{ outboundMessage: import("./OutboundMessage.js").OutboundMessage, deduped: boolean }>}
   */
  async send({ alertId, recipient, channel, message, triggeredBy }) {
    if (message.status !== ConstructionStatus.APPROVED) {
      throw new Error(`Cannot send a message that isn't APPROVED (status: ${message.status})`);
    }

    // recipient_id (an internal id, never a phone number) is left untouched
    // even in TEST mode, so the OutboundMessage record still shows who the
    // send was *intended* for — only the outbound phoneNumber actually
    // reaching the provider is replaced.
    const idempotencyKey = computeIdempotencyKey(alertId, recipient.recipientId, channel);
    const existing = this.store.findByIdempotencyKey(idempotencyKey);

    if (existing && IN_FLIGHT_OR_DONE.has(existing.status)) {
      return { outboundMessage: existing, deduped: true };
    }

    const effectiveRecipient =
      this.environmentMode === EnvironmentMode.TEST
        ? { ...recipient, phoneNumber: syntheticPhoneNumberFor(recipient.recipientId) }
        : recipient;

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
      const result = await this.provider.send(effectiveRecipient, message.text);
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

    this.auditLog?.record({
      actorUserId: triggeredBy?.user_id ?? null,
      actorRole: triggeredBy?.role ?? null,
      action: "SEND",
      subject: record.idempotency_key,
      outcome: record.status,
      details: {
        alertId,
        recipientId: recipient.recipientId,
        channel,
        attempt: record.attempt,
        environmentMode: this.environmentMode,
      },
    });

    return { outboundMessage: record, deduped: false };
  }
}
