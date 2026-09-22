import { describe, it, expect, beforeEach } from "vitest";
import { AuditLog } from "../../src/governance/AuditLog.js";
import { ApprovalWorkflow, ApprovalStatus, ApprovalDecision, SelfApprovalError } from "../../src/governance/ApprovalWorkflow.js";
import { ApprovalProfile } from "../../src/governance/approvalPolicy.js";
import { Role, createUser } from "../../src/governance/Role.js";

const operator = createUser({ user_id: "op-1", role: Role.OPERATOR });
const approverA = createUser({ user_id: "appr-a", role: Role.APPROVER });
const approverB = createUser({ user_id: "appr-b", role: Role.APPROVER });
const admin = createUser({ user_id: "admin-1", role: Role.ADMINISTRATOR });
const viewer = createUser({ user_id: "view-1", role: Role.VIEWER });

describe("ApprovalWorkflow", () => {
  /** @type {AuditLog} */
  let auditLog;
  /** @type {ApprovalWorkflow} */
  let workflow;

  beforeEach(() => {
    auditLog = new AuditLog();
    workflow = new ApprovalWorkflow({ auditLog });
  });

  it("rejects an operator attempting to approve their own submitted send", () => {
    const request = workflow.submit({
      profileId: ApprovalProfile.TRANSFORMED_LOCALIZED_MESSAGE,
      operator,
      subject: "alert-1",
    });

    expect(() => workflow.decide(request.id, operator, ApprovalDecision.APPROVE)).toThrow(SelfApprovalError);

    // The request must still be PENDING — a rejected self-approval attempt
    // must not accidentally count toward anything.
    expect(workflow.getRequest(request.id).status).toBe(ApprovalStatus.PENDING);

    // And the attempt itself is on the record, not silently swallowed.
    const selfApprovalEntries = auditLog.getEntries().filter((e) => e.outcome === "REJECTED_SELF_APPROVAL");
    expect(selfApprovalEntries).toHaveLength(1);
    expect(selfApprovalEntries[0].actor_user_id).toBe("op-1");
  });

  it("self-approval is rejected even when the operator also holds an Approver-eligible role identity", () => {
    // Same user_id submitting and approving, even if we construct their
    // "approver" User object with role APPROVER — the check is on
    // user_id equality, not role, since role alone can't prevent someone
    // from approving their own request if they're dual-hatted.
    const dualHatted = createUser({ user_id: "dual-1", role: Role.APPROVER });
    const request = workflow.submit({
      profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      operator: dualHatted,
      subject: "alert-2",
    });

    expect(() => workflow.decide(request.id, dualHatted, ApprovalDecision.APPROVE)).toThrow(SelfApprovalError);
  });

  it("TRUSTED_OFFICIAL_RELAY: a single Operator-role approval (from a different user) is enough", () => {
    const request = workflow.submit({ profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY, operator, subject: "alert-3" });
    const otherOperator = createUser({ user_id: "op-2", role: Role.OPERATOR });

    const result = workflow.decide(request.id, otherOperator, ApprovalDecision.APPROVE);
    expect(result.status).toBe(ApprovalStatus.APPROVED);
  });

  it("TRANSFORMED_LOCALIZED_MESSAGE: an Operator-role approval does not count; only Approver/Administrator do", () => {
    const request = workflow.submit({ profileId: ApprovalProfile.TRANSFORMED_LOCALIZED_MESSAGE, operator, subject: "alert-4" });
    const otherOperator = createUser({ user_id: "op-2", role: Role.OPERATOR });

    expect(() => workflow.decide(request.id, otherOperator, ApprovalDecision.APPROVE)).toThrow();
    expect(workflow.getRequest(request.id).status).toBe(ApprovalStatus.PENDING);

    const result = workflow.decide(request.id, approverA, ApprovalDecision.APPROVE);
    expect(result.status).toBe(ApprovalStatus.APPROVED);
  });

  it("MANUAL_EMERGENCY_MESSAGE: requires two distinct Approver/Administrator approvals, not one", () => {
    const request = workflow.submit({ profileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE, operator, subject: "alert-5" });

    const afterFirst = workflow.decide(request.id, approverA, ApprovalDecision.APPROVE);
    expect(afterFirst.status).toBe(ApprovalStatus.PENDING);

    const afterSecond = workflow.decide(request.id, admin, ApprovalDecision.APPROVE);
    expect(afterSecond.status).toBe(ApprovalStatus.APPROVED);
  });

  it("MANUAL_EMERGENCY_MESSAGE: the same approver approving twice does not satisfy the two-person requirement", () => {
    const request = workflow.submit({ profileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE, operator, subject: "alert-6" });

    workflow.decide(request.id, approverA, ApprovalDecision.APPROVE);
    expect(() => workflow.decide(request.id, approverA, ApprovalDecision.APPROVE)).toThrow(
      /already resolved|already/i,
    );
    // Not resolved as APPROVED — the request is still PENDING after one
    // distinct approver, and the second call above didn't move it forward.
    expect(workflow.getRequest(request.id).status).toBe(ApprovalStatus.PENDING);
  });

  it("a REJECT decision from an eligible approver resolves the request as REJECTED, not PENDING", () => {
    const request = workflow.submit({ profileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE, operator, subject: "alert-7" });
    const result = workflow.decide(request.id, approverA, ApprovalDecision.REJECT);
    expect(result.status).toBe(ApprovalStatus.REJECTED);

    // A resolved request can't be decided on again.
    expect(() => workflow.decide(request.id, admin, ApprovalDecision.APPROVE)).toThrow();
  });

  it("a Viewer cannot submit a request for approval at all", () => {
    expect(() =>
      workflow.submit({ profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY, operator: viewer, subject: "alert-8" }),
    ).toThrow();

    const deniedEntries = auditLog.getEntries().filter((e) => e.outcome === "DENIED");
    expect(deniedEntries).toHaveLength(1);
    expect(deniedEntries[0].actor_user_id).toBe("view-1");
  });

  it("every role check and approval decision is logged, and the resulting chain verifies", () => {
    const request = workflow.submit({ profileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE, operator, subject: "alert-9" });
    workflow.decide(request.id, approverA, ApprovalDecision.APPROVE);
    workflow.decide(request.id, approverB, ApprovalDecision.APPROVE);

    expect(auditLog.getEntries().length).toBeGreaterThanOrEqual(4); // submit role-check, submit, and 2x (role-check + decision)
    expect(auditLog.verifyChain()).toEqual({ valid: true });
  });
});
