import { getApprovalPolicy } from "./approvalPolicy.js";
import { assertRole } from "./permissions.js";
import { Role } from "./Role.js";

export const ApprovalStatus = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

export const ApprovalDecision = Object.freeze({
  APPROVE: "APPROVE",
  REJECT: "REJECT",
});

/**
 * Thrown when a user attempts to approve (or reject) a request they
 * themselves submitted. docs/PROJECT_HANDOFF.md, verbatim: "an operator
 * can't approve their own send." This is checked structurally in
 * decide() — before role eligibility, before counting — so there's no
 * code path where a self-approval can be counted toward a request's
 * required approvals, for any profile, regardless of the submitter's or
 * approver's role.
 */
export class SelfApprovalError extends Error {
  constructor(userId) {
    super(`User ${userId} cannot approve or reject their own send`);
    this.name = "SelfApprovalError";
  }
}

/**
 * Who may submit a request for approval at all. Doesn't appear in
 * approvalPolicy.js because it isn't profile-specific — a Viewer can't
 * submit any send, regardless of which approval profile it would use.
 */
const ROLES_ALLOWED_TO_SUBMIT = Object.freeze([Role.OPERATOR, Role.APPROVER, Role.ADMINISTRATOR]);

/**
 * Tracks approval requests against the policies in approvalPolicy.js,
 * logging every role check and approval decision to an AuditLog. This is
 * the workflow layer only — it doesn't itself send anything; NotificationService
 * (src/distribution/NotificationService.js) is the thing that would check
 * a request's status is APPROVED before calling a provider.
 */
export class ApprovalWorkflow {
  /** @param {{ auditLog: import("./AuditLog.js").AuditLog }} deps */
  constructor({ auditLog }) {
    this.auditLog = auditLog;
    /** @type {Map<string, { id: string, profileId: string, operatorUserId: string, subject: *, decisions: Array<{userId: string, role: string, decision: string, at: string}>, status: string }>} */
    this.requestsById = new Map();
    this._counter = 0;
  }

  /**
   * @param {{ profileId: string, operator: import("./Role.js").User, subject: * }} params
   * @returns {{ id: string, profileId: string, operatorUserId: string, subject: *, decisions: [], status: string }}
   */
  submit({ profileId, operator, subject }) {
    getApprovalPolicy(profileId); // throws on an unknown profile before anything is recorded

    assertRole(operator, ROLES_ALLOWED_TO_SUBMIT, {
      auditLog: this.auditLog,
      action: "SUBMIT_FOR_APPROVAL_ROLE_CHECK",
      subject,
    });

    this._counter += 1;
    const id = `approval-${this._counter}`;
    const request = { id, profileId, operatorUserId: operator.user_id, subject, decisions: [], status: ApprovalStatus.PENDING };
    this.requestsById.set(id, request);

    this.auditLog.record({
      actorUserId: operator.user_id,
      actorRole: operator.role,
      action: "SUBMIT_FOR_APPROVAL",
      subject,
      outcome: ApprovalStatus.PENDING,
      details: { approvalRequestId: id, profileId },
    });

    return { ...request, decisions: [] };
  }

  /**
   * Records one approve/reject decision from a user against a pending
   * request, and returns the request's updated state. Throws
   * SelfApprovalError, or a plain Error for an ineligible role or an
   * already-resolved/unknown request — every one of those still gets
   * logged first (see the ordering below), so the audit trail shows the
   * attempt even when it's rejected outright.
   *
   * @param {string} requestId
   * @param {import("./Role.js").User} approver
   * @param {string} decision One of ApprovalDecision's values
   * @returns {{ id: string, profileId: string, operatorUserId: string, subject: *, decisions: Array, status: string }}
   */
  decide(requestId, approver, decision) {
    const request = this.requestsById.get(requestId);
    if (!request) throw new Error(`Unknown approval request: ${requestId}`);
    if (request.status !== ApprovalStatus.PENDING) {
      throw new Error(`Approval request ${requestId} is already resolved (${request.status})`);
    }
    if (!Object.values(ApprovalDecision).includes(decision)) {
      throw new Error(`Invalid approval decision: ${decision}`);
    }
    if (request.decisions.some((d) => d.userId === approver.user_id)) {
      // One decision per user per request — otherwise a single approver
      // could satisfy a "two distinct approvers" requirement (e.g.
      // MANUAL_EMERGENCY_MESSAGE) by deciding twice. The Set-based count in
      // this function already dedupes by userId so that couldn't actually
      // over-count approvals, but a silent second no-op call would hide a
      // real workflow mistake (an approver retrying, a UI double-submit)
      // rather than surfacing it.
      throw new Error(`User ${approver.user_id} has already recorded a decision on request ${requestId}`);
    }

    if (approver.user_id === request.operatorUserId) {
      this.auditLog.record({
        actorUserId: approver.user_id,
        actorRole: approver.role,
        action: "APPROVAL_DECISION",
        subject: request.subject,
        outcome: "REJECTED_SELF_APPROVAL",
        details: { approvalRequestId: requestId, attemptedDecision: decision },
      });
      throw new SelfApprovalError(approver.user_id);
    }

    const policy = getApprovalPolicy(request.profileId);
    assertRole(approver, policy.eligibleApproverRoles, {
      auditLog: this.auditLog,
      action: "APPROVAL_ROLE_CHECK",
      subject: request.subject,
    });

    request.decisions.push({ userId: approver.user_id, role: approver.role, decision, at: new Date().toISOString() });

    if (decision === ApprovalDecision.REJECT) {
      request.status = ApprovalStatus.REJECTED;
    } else {
      const distinctApprovers = new Set(
        request.decisions.filter((d) => d.decision === ApprovalDecision.APPROVE).map((d) => d.userId),
      );
      if (distinctApprovers.size >= policy.requiredApprovals) {
        request.status = ApprovalStatus.APPROVED;
      }
    }

    this.auditLog.record({
      actorUserId: approver.user_id,
      actorRole: approver.role,
      action: "APPROVAL_DECISION",
      subject: request.subject,
      outcome: decision,
      details: { approvalRequestId: requestId, resultingStatus: request.status },
    });

    return { ...request, decisions: [...request.decisions] };
  }

  /**
   * @param {string} requestId
   * @returns {{ id: string, profileId: string, operatorUserId: string, subject: *, decisions: Array, status: string }|null}
   */
  getRequest(requestId) {
    const request = this.requestsById.get(requestId);
    return request ? { ...request, decisions: [...request.decisions] } : null;
  }
}
