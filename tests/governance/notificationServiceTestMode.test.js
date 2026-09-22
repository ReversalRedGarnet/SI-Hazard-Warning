import { describe, it, expect } from "vitest";
import { NotificationService } from "../../src/distribution/NotificationService.js";
import { OutboundMessageStore } from "../../src/distribution/OutboundMessageStore.js";
import { MockSMSProvider } from "../../src/distribution/MockSMSProvider.js";
import { buildMessage, approveMessage } from "../../src/distribution/messageConstruction.js";
import { AuditLog } from "../../src/governance/AuditLog.js";
import { EnvironmentMode } from "../../src/governance/EnvironmentMode.js";
import { TEST_MODE_SYNTHETIC_PHONE_NUMBERS, syntheticPhoneNumberFor } from "../../src/governance/testModeRecipients.js";
import { Role, createUser } from "../../src/governance/Role.js";

function approvedTestMessage() {
  return approveMessage(
    buildMessage({
      templateId: "hazard-warning",
      language: "en",
      variables: {
        hazardType: "Strong Wind",
        severity: "Severe",
        province: "Western Province",
        time: "4pm today",
        instruction: "Move to higher ground.",
        infoLink: "met.gov.sb",
      },
    }),
  );
}

describe("NotificationService environment-mode safety rail", () => {
  it("throws on construction rather than defaulting when environmentMode is omitted", () => {
    const store = new OutboundMessageStore();
    const provider = new MockSMSProvider({ script: [{ type: "accept" }] });
    expect(() => new NotificationService({ provider, store })).toThrow();
  });

  it("throws for an unrecognized environmentMode value rather than silently proceeding", () => {
    const store = new OutboundMessageStore();
    const provider = new MockSMSProvider({ script: [{ type: "accept" }] });
    expect(() => new NotificationService({ provider, store, environmentMode: "STAGING" })).toThrow();
  });

  it("TEST mode never reaches a real recipient, even when a real-looking phone number is passed in", async () => {
    // Deliberately shaped like a real Solomon Islands +677 number — the
    // point of this test is that it must not matter what's passed in.
    const REAL_LOOKING_RECIPIENT = { recipientId: "real-subscriber-1", phoneNumber: "+67788123456" };

    const store = new OutboundMessageStore();
    const provider = new MockSMSProvider({ script: [{ type: "accept", providerMessageId: "prov-test-1" }] });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.TEST });

    await service.send({
      alertId: "urn:oid:test-alert",
      recipient: REAL_LOOKING_RECIPIENT,
      channel: "sms",
      message: approvedTestMessage(),
    });

    expect(provider.callLog).toHaveLength(1);
    const dialedNumber = provider.callLog[0].recipient.phoneNumber;
    expect(dialedNumber).not.toBe("+67788123456");
    expect(TEST_MODE_SYNTHETIC_PHONE_NUMBERS).toContain(dialedNumber);
    expect(dialedNumber).toBe(syntheticPhoneNumberFor("real-subscriber-1"));
  });

  it("TEST mode still records the intended recipient_id on the OutboundMessage, only the dialed number is substituted", async () => {
    const store = new OutboundMessageStore();
    const provider = new MockSMSProvider({ script: [{ type: "accept" }] });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.TEST });

    const { outboundMessage } = await service.send({
      alertId: "urn:oid:test-alert",
      recipient: { recipientId: "real-subscriber-2", phoneNumber: "+67799999999" },
      channel: "sms",
      message: approvedTestMessage(),
    });

    expect(outboundMessage.recipient_id).toBe("real-subscriber-2");
  });

  it("DEVELOPMENT and PRODUCTION modes pass the real phoneNumber through unchanged", async () => {
    for (const mode of [EnvironmentMode.DEVELOPMENT, EnvironmentMode.PRODUCTION]) {
      const store = new OutboundMessageStore();
      const provider = new MockSMSProvider({ script: [{ type: "accept" }] });
      const service = new NotificationService({ provider, store, environmentMode: mode });

      await service.send({
        alertId: "urn:oid:test-alert",
        recipient: { recipientId: "sub-x", phoneNumber: "+67788123456" },
        channel: "sms",
        message: approvedTestMessage(),
      });

      expect(provider.callLog[0].recipient.phoneNumber).toBe("+67788123456");
    }
  });

  it("logs the send action to an AuditLog when one is supplied, attributing the environment mode used", async () => {
    const store = new OutboundMessageStore();
    const provider = new MockSMSProvider({ script: [{ type: "accept" }] });
    const auditLog = new AuditLog();
    const triggeredBy = createUser({ user_id: "op-1", role: Role.OPERATOR });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.TEST, auditLog });

    await service.send({
      alertId: "urn:oid:test-alert",
      recipient: { recipientId: "sub-y", phoneNumber: "+67712340000" },
      channel: "sms",
      message: approvedTestMessage(),
      triggeredBy,
    });

    const sendEntries = auditLog.getEntries().filter((e) => e.action === "SEND");
    expect(sendEntries).toHaveLength(1);
    expect(sendEntries[0].actor_user_id).toBe("op-1");
    expect(sendEntries[0].details.environmentMode).toBe(EnvironmentMode.TEST);
    expect(auditLog.verifyChain()).toEqual({ valid: true });
  });
});
