import { describe, it, expect, beforeEach } from "vitest";
import { NotificationService } from "../../src/distribution/NotificationService.js";
import { OutboundMessageStore } from "../../src/distribution/OutboundMessageStore.js";
import { MockSMSProvider } from "../../src/distribution/MockSMSProvider.js";
import { OutboundMessageStatus } from "../../src/distribution/OutboundMessage.js";
import { buildMessage, approveMessage } from "../../src/distribution/messageConstruction.js";
import { EnvironmentMode } from "../../src/governance/EnvironmentMode.js";

// These tests exercise NotificationService's own send/retry/dedup logic, not
// the TEST-mode recipient override (that has its own dedicated test file:
// tests/governance/notificationServiceTestMode.test.js) — DEVELOPMENT mode
// here means recipient.phoneNumber passes through unchanged, matching this
// suite's original assertions.

const RECIPIENT = { recipientId: "sub-1", phoneNumber: "+67712345678" };
const ALERT_ID = "urn:oid:test-alert-1";
const CHANNEL = "sms";

function approvedTestMessage() {
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
    },
  });
  return approveMessage(built);
}

describe("NotificationService", () => {
  /** @type {OutboundMessageStore} */
  let store;

  beforeEach(() => {
    store = new OutboundMessageStore();
  });

  it("accepts a message and records ACCEPTED with a provider_message_id", async () => {
    const provider = new MockSMSProvider({ script: [{ type: "accept", providerMessageId: "prov-1" }] });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.DEVELOPMENT });

    const { outboundMessage, deduped } = await service.send({
      alertId: ALERT_ID,
      recipient: RECIPIENT,
      channel: CHANNEL,
      message: approvedTestMessage(),
    });

    expect(deduped).toBe(false);
    expect(outboundMessage.status).toBe(OutboundMessageStatus.ACCEPTED);
    expect(outboundMessage.provider_message_id).toBe("prov-1");
    expect(outboundMessage.attempt).toBe(1);
    expect(store.getAll()).toHaveLength(1);
  });

  it("does not produce a duplicate OutboundMessage when a retry follows a gateway timeout", async () => {
    // First call times out (gateway response unknown); second call (the
    // caller's retry after the timeout) succeeds. This is the doc's
    // specific scenario: "a timeout after a gateway accepts a request can
    // cause a retry and duplicate delivery."
    const provider = new MockSMSProvider({
      script: [{ type: "timeout" }, { type: "accept", providerMessageId: "prov-2" }],
    });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.DEVELOPMENT });
    const message = approvedTestMessage();

    const first = await service.send({ alertId: ALERT_ID, recipient: RECIPIENT, channel: CHANNEL, message });
    expect(first.outboundMessage.status).toBe(OutboundMessageStatus.UNKNOWN);
    expect(first.outboundMessage.attempt).toBe(1);

    const second = await service.send({ alertId: ALERT_ID, recipient: RECIPIENT, channel: CHANNEL, message });
    expect(second.outboundMessage.status).toBe(OutboundMessageStatus.ACCEPTED);
    expect(second.outboundMessage.attempt).toBe(2);
    expect(second.deduped).toBe(false);

    // The whole point: one logical send, two provider calls, one row.
    expect(store.getAll()).toHaveLength(1);
    expect(provider.callLog).toHaveLength(2);
    expect(store.getAll()[0].idempotency_key).toBe(first.outboundMessage.idempotency_key);
  });

  it("does not re-submit to the provider for an already-accepted send (idempotent no-op)", async () => {
    const provider = new MockSMSProvider({ script: [{ type: "accept", providerMessageId: "prov-3" }] });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.DEVELOPMENT });
    const message = approvedTestMessage();

    await service.send({ alertId: ALERT_ID, recipient: RECIPIENT, channel: CHANNEL, message });
    const repeat = await service.send({ alertId: ALERT_ID, recipient: RECIPIENT, channel: CHANNEL, message });

    expect(repeat.deduped).toBe(true);
    expect(repeat.outboundMessage.status).toBe(OutboundMessageStatus.ACCEPTED);
    expect(provider.callLog).toHaveLength(1); // the provider was never called a second time
    expect(store.getAll()).toHaveLength(1);
  });

  it("allows a fresh attempt after a definite FAILED outcome, still on the same OutboundMessage row", async () => {
    const provider = new MockSMSProvider({
      script: [
        { type: "reject", failureReason: "invalid number" },
        { type: "accept", providerMessageId: "prov-4" },
      ],
    });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.DEVELOPMENT });
    const message = approvedTestMessage();

    const first = await service.send({ alertId: ALERT_ID, recipient: RECIPIENT, channel: CHANNEL, message });
    expect(first.outboundMessage.status).toBe(OutboundMessageStatus.FAILED);

    const retry = await service.send({ alertId: ALERT_ID, recipient: RECIPIENT, channel: CHANNEL, message });
    expect(retry.outboundMessage.status).toBe(OutboundMessageStatus.ACCEPTED);
    expect(retry.outboundMessage.attempt).toBe(2);
    expect(store.getAll()).toHaveLength(1);
  });

  it("treats the same alert to a different recipient (or a different channel) as a distinct send", async () => {
    const provider = new MockSMSProvider({ script: [{ type: "accept" }, { type: "accept" }] });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.DEVELOPMENT });
    const message = approvedTestMessage();

    await service.send({ alertId: ALERT_ID, recipient: RECIPIENT, channel: CHANNEL, message });
    await service.send({ alertId: ALERT_ID, recipient: { recipientId: "sub-2", phoneNumber: "+67787654321" }, channel: CHANNEL, message });

    expect(store.getAll()).toHaveLength(2);
  });

  it("refuses to send a message that hasn't been approved", async () => {
    const provider = new MockSMSProvider();
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.DEVELOPMENT });
    const unapproved = buildMessage({
      templateId: "hazard-warning",
      language: "en",
      variables: {
        hazardType: "Strong Wind",
        severity: "Severe",
        province: "Western",
        time: "4pm",
        instruction: "Move now.",
        infoLink: "met.gov.sb",
      },
    });

    await expect(
      service.send({ alertId: ALERT_ID, recipient: RECIPIENT, channel: CHANNEL, message: unapproved }),
    ).rejects.toThrow();
    expect(store.getAll()).toHaveLength(0);
  });
});
