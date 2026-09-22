import { describe, it, expect } from "vitest";
import { createAlert } from "../../src/normalization/Alert.js";
import { loadBoundaryDataset } from "../../src/geo/boundaryDataset.js";
import { mapAlertToAdministrativeUnits } from "../../src/geo/mapping.js";
import { EASTERN_REGION_AREA } from "../../tests/geo/fixtures.js";
import { registerSubscriber } from "../../src/subscribers/registration.js";
import { RegistrationSource } from "../../src/subscribers/Subscriber.js";
import { resolveRecipientSubscribers, toRecipient } from "../../src/subscribers/matching.js";
import { NotificationService } from "../../src/distribution/NotificationService.js";
import { OutboundMessageStore } from "../../src/distribution/OutboundMessageStore.js";
import { MockSMSProvider } from "../../src/distribution/MockSMSProvider.js";
import { OutboundMessageStatus } from "../../src/distribution/OutboundMessage.js";
import { buildMessage, approveMessage } from "../../src/distribution/messageConstruction.js";
import { EnvironmentMode } from "../../src/governance/EnvironmentMode.js";

/**
 * Full pipeline wiring test: geo mapping -> subscriber matching -> recipient
 * list -> NotificationService, using the real bundled boundary dataset and
 * a real captured CAP polygon (tests/geo/fixtures.js's EASTERN_REGION_AREA,
 * which mapping.test.js already hand-verifies resolves to Guadalcanal,
 * Makira-Ulawa, Rennell-Bell and Temotu — not Western, and not Honiara).
 * Subscriber phone numbers and zones here are synthetic, per
 * docs/PROJECT_HANDOFF.md's explicit warning against real subscriber data
 * in this repo.
 */
describe("geo -> subscribers -> distribution end-to-end wiring", () => {
  it("notifies a subscriber registered in an affected province and skips one in an unaffected province", async () => {
    const { units } = loadBoundaryDataset();

    const alert = createAlert({
      alert_id: "urn:oid:test.subscribers-e2e",
      event_id: "urn:oid:test.subscribers-e2e",
      hazard_type: "Strong Wind",
      sender: "forecast@met.gov.sb",
      source: "SIMS",
      status: "Actual",
      msg_type: "Alert",
      severity: "Severe",
      urgency: "Immediate",
      certainty: "Likely",
      alert_areas: [EASTERN_REGION_AREA],
      authoritative_for_local_warning: true,
      raw_payload: "<cap:alert>placeholder</cap:alert>",
      raw_source_url: "https://cap-sources.s3.amazonaws.com/sb-met-en/test.xml",
      retrieved_at: "2026-09-22T00:00:00Z",
      payload_hash: "0".repeat(64),
    });

    const { affectedUnits } = mapAlertToAdministrativeUnits(alert, units);
    const affectedNames = affectedUnits.map((u) => u.name);
    expect(affectedNames).toContain("Guadalcanal");
    expect(affectedNames).not.toContain("Western");

    const subscriberInGuadalcanal = registerSubscriber({
      phoneNumber: "+67799900020",
      registeredAlertZone: "SB06", // Guadalcanal
      registrationSource: RegistrationSource.WEB_FORM,
    });
    const subscriberInWestern = registerSubscriber({
      phoneNumber: "+67799900021",
      registeredAlertZone: "SB02", // Western — not affected by this area
      registrationSource: RegistrationSource.WEB_FORM,
    });

    const { recipients: matchedSubscribers, unresolvedZoneSubscribers } = resolveRecipientSubscribers(
      affectedUnits,
      [subscriberInGuadalcanal, subscriberInWestern],
      units,
    );
    expect(unresolvedZoneSubscribers).toHaveLength(0);

    const recipients = matchedSubscribers.map(toRecipient);

    expect(recipients).toEqual([{ recipientId: subscriberInGuadalcanal.subscriber_id, phoneNumber: "+67799900020" }]);

    const message = approveMessage(
      buildMessage({
        templateId: "hazard-warning",
        language: "en",
        variables: {
          hazardType: alert.hazard_type,
          severity: alert.severity,
          province: "Guadalcanal",
          time: "4pm today",
          instruction: "Move to higher ground.",
          infoLink: "met.gov.sb",
        },
      }),
    );

    const store = new OutboundMessageStore();
    const provider = new MockSMSProvider({ script: [{ type: "accept", providerMessageId: "prov-e2e-1" }] });
    const service = new NotificationService({ provider, store, environmentMode: EnvironmentMode.DEVELOPMENT });

    const results = await Promise.all(
      recipients.map((recipient) =>
        service.send({ alertId: alert.alert_id, recipient, channel: "sms", message }),
      ),
    );

    expect(results).toHaveLength(1);
    expect(results[0].outboundMessage.status).toBe(OutboundMessageStatus.ACCEPTED);
    expect(results[0].outboundMessage.recipient_id).toBe(subscriberInGuadalcanal.subscriber_id);
    expect(provider.callLog).toHaveLength(1);
    expect(provider.callLog[0].recipient.phoneNumber).toBe("+67799900020");
  });
});
