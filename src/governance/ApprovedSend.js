import { sha256Hex } from "../shared/hash.js";
import { ApprovalStatus } from "./ApprovalWorkflow.js";
import { ConstructionStatus } from "../distribution/messageConstruction.js";
import { RateLimitExceededError } from "./RateLimiter.js";

/**
 * The subject an ApprovalWorkflow request must carry to authorize sending
 * a specific alert + rendered message through sendApproved(). Binding on
 * the rendered text (not just templateId/language) ties the approval to
 * the exact content a human reviewed — approving "the hazard-warning
 * template in English" in the abstract would not be enough to authorize a
 * differently-worded render of it later (different variables, a template
 * edit between submission and send, etc.).
 *
 * Callers must pass this same value as `subject` when calling
 * ApprovalWorkflow.submit() for a send that will go through sendApproved() —
 * sendApproved() recomputes it independently from the alertId + message it's
 * actually given and rejects a mismatch, rather than trusting whatever
 * subject the request happens to carry.
 *
 * @param {string} alertId
 * @param {import("../distribution/messageConstruction.js").ConstructedMessage} message
 * @returns {{ alertId: string, templateId: string, language: string, textHash: string }}
 */
export function approvalSubjectFor(alertId, message) {
  return {
    alertId,
    templateId: message.templateId,
    language: message.language,
    textHash: sha256Hex(message.text),
  };
}

function subjectsMatch(a, b) {
  return (
    !!a &&
    !!b &&
    a.alertId === b.alertId &&
    a.templateId === b.templateId &&
    a.language === b.language &&
    a.textHash === b.textHash
  );
}

/**
 * The gap this closes: src/governance/ApprovalWorkflow.js (RBAC/approval)
 * and src/distribution/NotificationService.js (dispatch) were built as
 * separate stages and were never wired together — nothing previously
 * stopped code from calling NotificationService.send() regardless of
 * whether any approval had ever happened. This is the one path in the
 * codebase that sends through NotificationService while actually enforcing
 * that a specific ApprovalWorkflow request reached APPROVED, under the
 * correct profile, for this exact alert + message, before doing so.
 *
 * NotificationService.send() itself remains directly callable — see the
 * "NotificationService.send() stays directly callable" decision recorded
 * in its own module comment. This function is what makes going through
 * the approval workflow the structurally-enforced path for real dispatch,
 * without changing NotificationService's own contract: every check below
 * happens before notificationService.send() is ever invoked, so a message
 * that fails any of them never reaches the provider at all.
 *
 * Fans out to every recipient under the one approval request — one
 * approval authorizes the alert+message as content, not a single
 * recipient, matching how NotificationService.send() itself is called once
 * per recipient.
 *
 * Rate limiting (docs/PROJECT_HANDOFF.md's threat model: a control against
 * a compromised/malicious account sending excessively) is checked once per
 * call to this function — i.e. once per broadcast, not once per recipient
 * in the fan-out below — keyed on `triggeredBy` + `channel`, immediately
 * before the fan-out loop and so before any provider call. It's optional
 * (only enforced when a `rateLimiter` is supplied) so existing callers that
 * don't pass one keep their prior behavior exactly; `triggeredBy` becomes
 * required the moment a `rateLimiter` is supplied, since there's no user to
 * key the limit on otherwise. Every check (allowed or denied) is logged to
 * `approvalWorkflow`'s own audit log, so a rejection is on the record, not
 * just a thrown error the caller has to remember to report.
 *
 * @param {{
 *   approvalWorkflow: import("./ApprovalWorkflow.js").ApprovalWorkflow,
 *   approvalRequestId: string,
 *   expectedProfileId: string,
 *   notificationService: import("../distribution/NotificationService.js").NotificationService,
 *   alertId: string,
 *   message: import("../distribution/messageConstruction.js").ConstructedMessage,
 *   channel: string,
 *   recipients: { recipientId: string, phoneNumber: string }[],
 *   triggeredBy?: import("./Role.js").User,
 *   rateLimiter?: import("./RateLimiter.js").RateLimiter,
 * }} params
 * @returns {Promise<Array<{ outboundMessage: import("../distribution/OutboundMessage.js").OutboundMessage, deduped: boolean }>>}
 */
export async function sendApproved({
  approvalWorkflow,
  approvalRequestId,
  expectedProfileId,
  notificationService,
  alertId,
  message,
  channel,
  recipients,
  triggeredBy,
  rateLimiter,
}) {
  const request = approvalWorkflow.getRequest(approvalRequestId);
  if (!request) {
    throw new Error(`No approval request found for id: ${approvalRequestId}`);
  }
  if (request.status !== ApprovalStatus.APPROVED) {
    throw new Error(`Approval request ${approvalRequestId} is not APPROVED (status: ${request.status})`);
  }
  if (request.profileId !== expectedProfileId) {
    throw new Error(
      `Approval request ${approvalRequestId} was approved under profile "${request.profileId}", ` +
        `not the expected "${expectedProfileId}" for this message`,
    );
  }

  const expectedSubject = approvalSubjectFor(alertId, message);
  if (!subjectsMatch(request.subject, expectedSubject)) {
    throw new Error(
      `Approval request ${approvalRequestId}'s subject does not match this exact alert/message — ` +
        `an approval for different content cannot authorize this send`,
    );
  }

  // Belt-and-suspenders: NotificationService.send() checks this too, but
  // failing here means a bad message never even reaches the per-recipient
  // loop below.
  if (message.status !== ConstructionStatus.APPROVED) {
    throw new Error(`Cannot send a message that isn't APPROVED at the construction level (status: ${message.status})`);
  }

  if (!recipients || recipients.length === 0) {
    throw new Error("sendApproved requires at least one recipient");
  }

  if (rateLimiter) {
    if (!triggeredBy) {
      throw new Error("sendApproved requires triggeredBy when a rateLimiter is supplied, to know whose limit to check");
    }

    const rateLimitOutcome = rateLimiter.check(triggeredBy.user_id, channel);
    approvalWorkflow.auditLog?.record({
      actorUserId: triggeredBy.user_id,
      actorRole: triggeredBy.role,
      action: "RATE_LIMIT_CHECK",
      subject: expectedSubject,
      outcome: rateLimitOutcome.allowed ? "ALLOWED" : "DENIED",
      details: { channel, limit: rateLimiter.limit, windowMs: rateLimiter.windowMs, retryAfterMs: rateLimitOutcome.retryAfterMs },
    });

    if (!rateLimitOutcome.allowed) {
      throw new RateLimitExceededError(rateLimiter.keyFor(triggeredBy.user_id, channel), rateLimitOutcome.retryAfterMs);
    }
  }

  const results = [];
  for (const recipient of recipients) {
    results.push(await notificationService.send({ alertId, recipient, channel, message, triggeredBy }));
  }
  return results;
}
