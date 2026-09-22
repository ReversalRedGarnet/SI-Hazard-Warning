import { describe, it, expect } from "vitest";
import { HazardWarningSystem } from "../../src/system/HazardWarningSystem.js";
import { SIMSCAPAdapter } from "../../src/ingestion/SIMSCAPAdapter.js";
import { SubscriberStore } from "../../src/subscribers/SubscriberStore.js";
import { registerSubscriber } from "../../src/subscribers/registration.js";
import { RegistrationSource } from "../../src/subscribers/Subscriber.js";
import { MockSMSProvider } from "../../src/distribution/MockSMSProvider.js";
import { OutboundMessageStatus } from "../../src/distribution/OutboundMessage.js";
import { buildMessage, approveMessage } from "../../src/distribution/messageConstruction.js";
import { EnvironmentMode } from "../../src/governance/EnvironmentMode.js";
import { Role, createUser } from "../../src/governance/Role.js";
import { ApprovalProfile } from "../../src/governance/approvalPolicy.js";
import { ApprovalDecision } from "../../src/governance/ApprovalWorkflow.js";
import { RateLimiter, RateLimitExceededError } from "../../src/governance/RateLimiter.js";
import { TEST_MODE_SYNTHETIC_PHONE_NUMBERS } from "../../src/governance/testModeRecipients.js";
import { RSS_URL, buildStubFetch } from "./rawCapFixtures.js";

const operator = createUser({ user_id: "op-1", role: Role.OPERATOR });
const approver = createUser({ user_id: "appr-1", role: Role.APPROVER });

function buildSystem({ environmentMode = EnvironmentMode.TEST, rateLimiter, subscriberStore } = {}) {
  const hazardSource = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl: buildStubFetch() });
  const store = subscriberStore ?? new SubscriberStore();
  const provider = new MockSMSProvider({ defaultOutcome: { type: "accept" } });

  const system = new HazardWarningSystem({
    hazardSource,
    provider,
    subscriberStore: store,
    environmentMode,
    rateLimiter,
  });

  return { system, store, provider };
}

function approvedHazardWarningMessage(province) {
  return approveMessage(
    buildMessage({
      templateId: "hazard-warning",
      language: "en",
      variables: {
        hazardType: "Strong Wind",
        severity: "Severe",
        province,
        time: "4pm today",
        instruction: "Move to higher ground.",
        infoLink: "met.gov.sb",
      },
    }),
  );
}

describe("HazardWarningSystem — full synthetic pipeline", () => {
  it("runs raw CAP-shaped input through ingestion, dedup, geo mapping, subscriber resolution, governance, and dispatch — with no real network calls", async () => {
    const guadalcanalSubscriber = registerSubscriber({
      phoneNumber: "+67799900040",
      registeredAlertZone: "SB06", // Guadalcanal
      registrationSource: RegistrationSource.WEB_FORM,
    });
    const westernSubscriber = registerSubscriber({
      phoneNumber: "+67799900041",
      registeredAlertZone: "SB02", // Western — the fixture's polygon doesn't reach here
      registrationSource: RegistrationSource.WEB_FORM,
    });

    const store = new SubscriberStore();
    store.save(guadalcanalSubscriber);
    store.save(westernSubscriber);

    const { system, provider } = buildSystem({ subscriberStore: store });

    // Stage 1-4: ingestion (real RSS+CAP parsing on synthetic XML) -> dedup
    // -> geo mapping -> candidate recipients.
    const [processed] = await system.ingestAndProcess();

    expect(processed.alert.hazard_type).toBe("Strong Wind");
    expect(processed.alert.source).toBe("SIMS");
    expect(processed.lifecycle.state).toBe("NEW");
    expect(processed.affectedUnits.map((u) => u.name)).toContain("Guadalcanal");
    expect(processed.affectedUnits.map((u) => u.name)).not.toContain("Western");
    expect(processed.candidateRecipients).toEqual([
      { recipientId: guadalcanalSubscriber.subscriber_id, phoneNumber: "+67799900040" },
    ]);

    // Stage 5: governance — submit, approve.
    const message = approvedHazardWarningMessage("Guadalcanal");
    const request = system.submitForApproval({
      profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      operator,
      alertId: processed.alert.alert_id,
      message,
    });
    system.decideApproval(request.id, approver, ApprovalDecision.APPROVE);
    expect(system.getApprovalRequest(request.id).status).toBe("APPROVED");

    // Stage 6: dispatch — the only exposed send path.
    const results = await system.sendApproved({
      approvalRequestId: request.id,
      expectedProfileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      alertId: processed.alert.alert_id,
      message,
      channel: "sms",
      recipients: processed.candidateRecipients,
      triggeredBy: operator,
    });

    expect(results).toHaveLength(1);
    expect(results[0].outboundMessage.status).toBe(OutboundMessageStatus.ACCEPTED);
    expect(provider.callLog).toHaveLength(1);

    // Environment-mode safety rail is wired through the whole composed
    // system too: TEST mode means the number actually dialed is synthetic,
    // never the subscriber's own (synthetic-but-realistic-looking) number.
    expect(provider.callLog[0].recipient.phoneNumber).not.toBe("+67799900040");
    expect(TEST_MODE_SYNTHETIC_PHONE_NUMBERS).toContain(provider.callLog[0].recipient.phoneNumber);

    // Audited: the approval decision and the send are traceable via a
    // shared alertId, and the whole chain verifies.
    const alertId = processed.alert.alert_id;
    const approvalEntries = system
      .getAuditEntries()
      .filter((e) => e.action === "APPROVAL_DECISION" && e.subject?.alertId === alertId);
    const sendEntries = system.getAuditEntries().filter((e) => e.action === "SEND" && e.details?.alertId === alertId);

    expect(approvalEntries.length).toBeGreaterThan(0);
    expect(sendEntries).toHaveLength(1);
    expect(system.verifyAuditChain()).toEqual({ valid: true });
  });
});

describe("HazardWarningSystem — rate limiting", () => {
  it("blocks a burst of sends beyond the configured per-user, per-channel limit", async () => {
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900042",
      registeredAlertZone: "SB06",
      registrationSource: RegistrationSource.WEB_FORM,
    });
    const store = new SubscriberStore();
    store.save(subscriber);

    const rateLimiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
    const { system, provider } = buildSystem({ subscriberStore: store, rateLimiter });

    const [processed] = await system.ingestAndProcess();
    const recipients = [{ recipientId: subscriber.subscriber_id, phoneNumber: subscriber.phone_number }];

    // Three independent approved requests, each for a distinct alertId
    // (three separate outbound sends, not three retries of the same one —
    // NotificationService's own idempotency would otherwise dedupe a
    // second identical alert+recipient+channel send before it ever reaches
    // the provider, which would confound this test with a different
    // mechanism than the rate limiter this test is isolating), all
    // triggered by the same operator on the same channel.
    const attempts = await Promise.all(
      [1, 2, 3].map(async (n) => {
        const alertId = `${processed.alert.alert_id}::burst-${n}`;
        const message = approvedHazardWarningMessage(`Guadalcanal (attempt ${n})`);
        const request = system.submitForApproval({
          profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
          operator,
          alertId,
          message,
        });
        system.decideApproval(request.id, approver, ApprovalDecision.APPROVE);
        return { request, message, alertId };
      }),
    );

    const outcomes = [];
    for (const { request, message, alertId } of attempts) {
      try {
        await system.sendApproved({
          approvalRequestId: request.id,
          expectedProfileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
          alertId,
          message,
          channel: "sms",
          recipients,
          triggeredBy: operator,
        });
        outcomes.push("sent");
      } catch (err) {
        outcomes.push(err instanceof RateLimitExceededError ? "rate-limited" : `error: ${err.message}`);
      }
    }

    expect(outcomes).toEqual(["sent", "sent", "rate-limited"]);
    expect(provider.callLog).toHaveLength(2); // the third attempt never reached the provider

    const deniedEntries = system.getAuditEntries().filter((e) => e.action === "RATE_LIMIT_CHECK" && e.outcome === "DENIED");
    expect(deniedEntries).toHaveLength(1);
    expect(deniedEntries[0].actor_user_id).toBe("op-1");
  });

  it("keys the limit per-user — a different operator's send under the same channel is unaffected by another user's exhausted limit", async () => {
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900043",
      registeredAlertZone: "SB06",
      registrationSource: RegistrationSource.WEB_FORM,
    });
    const store = new SubscriberStore();
    store.save(subscriber);

    const rateLimiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    const { system } = buildSystem({ subscriberStore: store, rateLimiter });
    const [processed] = await system.ingestAndProcess();
    const recipients = [{ recipientId: subscriber.subscriber_id, phoneNumber: subscriber.phone_number }];
    const otherOperator = createUser({ user_id: "op-2", role: Role.OPERATOR });

    async function submitApproveSend(triggeredBy, variant) {
      // Distinct alertId per call, same reasoning as the burst test above —
      // isolates the rate limiter from NotificationService's own
      // same-alert+recipient+channel idempotency dedup.
      const alertId = `${processed.alert.alert_id}::${variant}`;
      const message = approvedHazardWarningMessage(`Guadalcanal (${variant})`);
      const request = system.submitForApproval({
        profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
        operator: triggeredBy,
        alertId,
        message,
      });
      system.decideApproval(request.id, approver, ApprovalDecision.APPROVE);
      return system.sendApproved({
        approvalRequestId: request.id,
        expectedProfileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
        alertId,
        message,
        channel: "sms",
        recipients,
        triggeredBy,
      });
    }

    await submitApproveSend(operator, "op-1-first");
    await expect(submitApproveSend(operator, "op-1-second")).rejects.toThrow(RateLimitExceededError);
    // A different operator, same channel, same system — not blocked.
    await expect(submitApproveSend(otherOperator, "op-2-first")).resolves.toBeTruthy();
  });
});

describe("HazardWarningSystem — no raw send path", () => {
  it("exposes no property or method other than sendApproved that could reach the provider", () => {
    const { system } = buildSystem();

    // The NotificationService is a private (#) field — not an own,
    // enumerable, or even reflectively-discoverable property.
    expect(system.notificationService).toBeUndefined();
    expect(system.provider).toBeUndefined();
    expect(Object.getOwnPropertyNames(system)).not.toContain("notificationService");
    expect(Object.getOwnPropertyNames(system)).not.toContain("#notificationService");

    // The full public method surface is exactly the small set this stage
    // specified — nothing else exists that could be called to dispatch.
    const publicMethods = Object.getOwnPropertyNames(HazardWarningSystem.prototype).filter((name) => name !== "constructor");
    expect(publicMethods.sort()).toEqual(
      ["decideApproval", "getApprovalRequest", "getAuditEntries", "ingestAndProcess", "sendApproved", "submitForApproval", "verifyAuditChain"].sort(),
    );
  });

  it("the only method whose result reflects a provider call is sendApproved", async () => {
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900044",
      registeredAlertZone: "SB06",
      registrationSource: RegistrationSource.WEB_FORM,
    });
    const store = new SubscriberStore();
    store.save(subscriber);
    const { system, provider } = buildSystem({ subscriberStore: store });

    const [processed] = await system.ingestAndProcess();
    expect(provider.callLog).toHaveLength(0); // ingestion/geo/subscriber resolution alone never dispatches

    const message = approvedHazardWarningMessage("Guadalcanal");
    const request = system.submitForApproval({
      profileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      operator,
      alertId: processed.alert.alert_id,
      message,
    });
    expect(provider.callLog).toHaveLength(0); // submitting for approval alone never dispatches

    system.decideApproval(request.id, approver, ApprovalDecision.APPROVE);
    expect(provider.callLog).toHaveLength(0); // approving alone never dispatches

    await system.sendApproved({
      approvalRequestId: request.id,
      expectedProfileId: ApprovalProfile.TRUSTED_OFFICIAL_RELAY,
      alertId: processed.alert.alert_id,
      message,
      channel: "sms",
      recipients: [{ recipientId: subscriber.subscriber_id, phoneNumber: subscriber.phone_number }],
      triggeredBy: operator,
    });
    expect(provider.callLog).toHaveLength(1); // only sendApproved() ever reaches the provider
  });
});
