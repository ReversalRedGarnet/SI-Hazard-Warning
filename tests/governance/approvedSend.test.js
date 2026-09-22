import { describe, it, expect, beforeEach } from "vitest";
import { sendApproved, approvalSubjectFor } from "../../src/governance/ApprovedSend.js";
import { AuditLog } from "../../src/governance/AuditLog.js";
import { ApprovalWorkflow, ApprovalDecision } from "../../src/governance/ApprovalWorkflow.js";
import { ApprovalProfile } from "../../src/governance/approvalPolicy.js";
import { Role, createUser } from "../../src/governance/Role.js";
import { NotificationService } from "../../src/distribution/NotificationService.js";
import { OutboundMessageStore } from "../../src/distribution/OutboundMessageStore.js";
import { MockSMSProvider } from "../../src/distribution/MockSMSProvider.js";
import { OutboundMessageStatus } from "../../src/distribution/OutboundMessage.js";
import { EnvironmentMode } from "../../src/governance/EnvironmentMode.js";
import { buildMessage, approveMessage } from "../../src/distribution/messageConstruction.js";

const ALERT_ID = "urn:oid:test-approved-send";
const RECIPIENT = { recipientId: "sub-1", phoneNumber: "+67799900030" };

const operator = createUser({ user_id: "op-1", role: Role.OPERATOR });
const approver = createUser({ user_id: "appr-1", role: Role.APPROVER });
const admin = createUser({ user_id: "admin-1", role: Role.ADMINISTRATOR });

function approvedConstructedMessage(overrides = {}) {
  const built = buildMessage({
    templateId: "hazard-warning",
    language: "en",
    variables: {
      hazardType: "Strong Wind",
      severity: "Severe",
      province: "Western Province",
      time: "4pm today",
      instruction: "Move to higher ground.",
      infoLink: "met.gov.sb",
      ...overrides.variables,
    },
  });
  return approveMessage(built);
}

describe("sendApproved", () => {
  /** @type {AuditLog} */
  let auditLog;
  /** @type {ApprovalWorkflow} */
  let workflow;
  /** @type {OutboundMessageStore} */
  let store;
  /** @type {MockSMSProvider} */
  let provider;
  /** @type {NotificationService} */
  let notificationService;

  beforeEach(() => {
    auditLog = new AuditLog();
    workflow = new ApprovalWorkflow({ auditLog });
    store = new OutboundMessageStore();
    provider = new MockSMSProvider({ script: [{ type: "accept", providerMessageId: "prov-approved-1" }] });
    notificationService = new NotificationService({
      provider,
      store,
      environmentMode: EnvironmentMode.DEVELOPMENT,
      auditLog,
    });
  });

  it("refuses to send when the approval request is still PENDING", async () => {
    const message = approvedConstructedMessage();
    const request = workflow.submit({
      profileId: ApprovalProfile.TRANSFORMED_LOCALIZED_MESSAGE,
      operator,
      subject: approvalSubjectFor(ALERT_ID, message),
    });

    await expect(
      sendApproved({
        approvalWorkflow: workflow,
        approvalRequestId: request.id,
        expectedProfileId: ApprovalProfile.TRANSFORMED_LOCALIZED_MESSAGE,
        notificationService,
        alertId: ALERT_ID,
        message,
        channel: "sms",
        recipients: [RECIPIENT],
      }),
    ).rejects.toThrow(/not APPROVED/);

    expect(provider.callLog).toHaveLength(0);
    expect(store.getAll()).toHaveLength(0);
  });

  it("refuses to send when the request was rejected", async () => {
    const message = approvedConstructedMessage();
    const request = workflow.submit({
      profileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE,
      operator,
      subject: approvalSubjectFor(ALERT_ID, message),
    });
    workflow.decide(request.id, approver, ApprovalDecision.REJECT);

    await expect(
      sendApproved({
        approvalWorkflow: workflow,
        approvalRequestId: request.id,
        expectedProfileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE,
        notificationService,
        alertId: ALERT_ID,
        message,
        channel: "sms",
        recipients: [RECIPIENT],
      }),
    ).rejects.toThrow(/not APPROVED/);

    expect(provider.callLog).toHaveLength(0);
  });

  it("refuses to send when approved under the wrong profile (trusted-relay approval used for a manually authored message)", async () => {
    const message = approvedConstructedMessage();
    // Approved as a fast-path trusted relay...
    const request = workflow.submit({
      profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      operator,
      subject: approvalSubjectFor(ALERT_ID, message),
    });
    workflow.decide(request.id, approver, ApprovalDecision.APPROVE);
    expect(workflow.getRequest(request.id).status).toBe("APPROVED");

    // ...but the caller declares this message is actually manually
    // authored emergency content, which needed the strongest profile.
    await expect(
      sendApproved({
        approvalWorkflow: workflow,
        approvalRequestId: request.id,
        expectedProfileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE,
        notificationService,
        alertId: ALERT_ID,
        message,
        channel: "sms",
        recipients: [RECIPIENT],
      }),
    ).rejects.toThrow(/expected/);

    expect(provider.callLog).toHaveLength(0);
  });

  it("refuses to send when the approved request's subject doesn't match this exact alert/message", async () => {
    const message = approvedConstructedMessage();
    const request = workflow.submit({
      profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      operator,
      subject: approvalSubjectFor("urn:oid:a-different-alert", message),
    });
    workflow.decide(request.id, approver, ApprovalDecision.APPROVE);

    await expect(
      sendApproved({
        approvalWorkflow: workflow,
        approvalRequestId: request.id,
        expectedProfileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
        notificationService,
        alertId: ALERT_ID, // different from what was approved
        message,
        channel: "sms",
        recipients: [RECIPIENT],
      }),
    ).rejects.toThrow(/does not match/);

    expect(provider.callLog).toHaveLength(0);
  });

  it("refuses to send when the approved request's subject was for different rendered text (same alert, different content)", async () => {
    const approvedMessage = approvedConstructedMessage({ variables: { instruction: "Move to higher ground." } });
    const laterMessage = approvedConstructedMessage({ variables: { instruction: "Evacuate low-lying areas now." } });

    const request = workflow.submit({
      profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      operator,
      subject: approvalSubjectFor(ALERT_ID, approvedMessage),
    });
    workflow.decide(request.id, approver, ApprovalDecision.APPROVE);

    await expect(
      sendApproved({
        approvalWorkflow: workflow,
        approvalRequestId: request.id,
        expectedProfileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
        notificationService,
        alertId: ALERT_ID,
        message: laterMessage, // different text than what was actually approved
        channel: "sms",
        recipients: [RECIPIENT],
      }),
    ).rejects.toThrow(/does not match/);
  });

  it("sends successfully once fully approved under the correct profile, and both the approval and send are linked in the same audit log", async () => {
    const message = approvedConstructedMessage();
    const subject = approvalSubjectFor(ALERT_ID, message);

    const request = workflow.submit({
      profileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE,
      operator,
      subject,
    });
    workflow.decide(request.id, approver, ApprovalDecision.APPROVE);
    workflow.decide(request.id, admin, ApprovalDecision.APPROVE);
    expect(workflow.getRequest(request.id).status).toBe("APPROVED");

    const results = await sendApproved({
      approvalWorkflow: workflow,
      approvalRequestId: request.id,
      expectedProfileId: ApprovalProfile.MANUAL_EMERGENCY_MESSAGE,
      notificationService,
      alertId: ALERT_ID,
      message,
      channel: "sms",
      recipients: [RECIPIENT],
      triggeredBy: admin,
    });

    expect(results).toHaveLength(1);
    expect(results[0].outboundMessage.status).toBe(OutboundMessageStatus.ACCEPTED);
    expect(provider.callLog).toHaveLength(1);

    // Traceability: the approval decision entries carry this exact
    // alertId in their subject, and the SEND entry carries the same
    // alertId in its details — a consistent link between the two without
    // either module needing to know about the other's internal shape.
    const approvalEntries = auditLog.getEntries().filter((e) => e.action === "APPROVAL_DECISION" && e.outcome === "APPROVE");
    const sendEntries = auditLog.getEntries().filter((e) => e.action === "SEND");

    expect(approvalEntries.length).toBeGreaterThan(0);
    expect(sendEntries).toHaveLength(1);
    expect(approvalEntries.every((e) => e.subject.alertId === ALERT_ID)).toBe(true);
    expect(sendEntries[0].details.alertId).toBe(ALERT_ID);
    expect(sendEntries[0].actor_user_id).toBe("admin-1");

    // The whole chain (submit role-check, submit, 2x role-check+decision, send) verifies.
    expect(auditLog.verifyChain()).toEqual({ valid: true });
  });

  it("sends to every recipient under one approved request (fan-out), not just the first", async () => {
    const message = approvedConstructedMessage();
    const request = workflow.submit({
      profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      operator,
      subject: approvalSubjectFor(ALERT_ID, message),
    });
    workflow.decide(request.id, approver, ApprovalDecision.APPROVE);

    const multiProvider = new MockSMSProvider({ script: [{ type: "accept" }, { type: "accept" }] });
    const multiService = new NotificationService({
      provider: multiProvider,
      store,
      environmentMode: EnvironmentMode.DEVELOPMENT,
      auditLog,
    });

    const results = await sendApproved({
      approvalWorkflow: workflow,
      approvalRequestId: request.id,
      expectedProfileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      notificationService: multiService,
      alertId: ALERT_ID,
      message,
      channel: "sms",
      recipients: [RECIPIENT, { recipientId: "sub-2", phoneNumber: "+67799900031" }],
    });

    expect(results).toHaveLength(2);
    expect(multiProvider.callLog).toHaveLength(2);
  });

  it("rejects an unknown approval request id outright", async () => {
    const message = approvedConstructedMessage();
    await expect(
      sendApproved({
        approvalWorkflow: workflow,
        approvalRequestId: "approval-does-not-exist",
        expectedProfileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
        notificationService,
        alertId: ALERT_ID,
        message,
        channel: "sms",
        recipients: [RECIPIENT],
      }),
    ).rejects.toThrow(/No approval request found/);
  });
});
