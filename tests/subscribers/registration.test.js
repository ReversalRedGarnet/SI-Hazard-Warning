import { describe, it, expect } from "vitest";
import { registerSubscriber } from "../../src/subscribers/registration.js";
import { ConsentStatus, RegistrationSource, SubscriberStatus } from "../../src/subscribers/Subscriber.js";

// Synthetic only — never a real phone number or zone, per docs/PROJECT_HANDOFF.md's
// explicit warning against putting real subscriber data into this repo.
const SYNTHETIC_PHONE = "+67799900001";
const SYNTHETIC_ZONE = "SB06"; // Guadalcanal pcode from the bundled boundary dataset — used only as an id string here

describe("registerSubscriber", () => {
  it("registers a web_form subscriber as ACTIVE with consent GRANTED by default", () => {
    const subscriber = registerSubscriber({
      phoneNumber: SYNTHETIC_PHONE,
      registeredAlertZone: SYNTHETIC_ZONE,
      registrationSource: RegistrationSource.WEB_FORM,
      now: "2026-09-22T00:00:00Z",
    });

    expect(subscriber.registration_source).toBe("web_form");
    expect(subscriber.consent_status).toBe(ConsentStatus.GRANTED);
    expect(subscriber.status).toBe(SubscriberStatus.ACTIVE);
    expect(subscriber.phone_number).toBe(SYNTHETIC_PHONE);
    expect(subscriber.registered_alert_zone).toBe(SYNTHETIC_ZONE);
    expect(subscriber.created_at).toBe("2026-09-22T00:00:00Z");
    expect(subscriber.updated_at).toBe("2026-09-22T00:00:00Z");
    expect(subscriber.subscriber_id).toBeTruthy();
  });

  it("registers a provincial_ict_assistant subscriber as PENDING by default, not GRANTED", () => {
    // docs/PROJECT_HANDOFF.md: that channel "needs NDMO/MPGIS approval and
    // defined consent procedures, not an assumption" — the approval flow
    // itself is out of scope for this stage, so consent must not default
    // to GRANTED just because a registration record exists.
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900002",
      registeredAlertZone: SYNTHETIC_ZONE,
      registrationSource: RegistrationSource.PROVINCIAL_ICT_ASSISTANT,
    });

    expect(subscriber.registration_source).toBe("provincial_ict_assistant");
    expect(subscriber.consent_status).toBe(ConsentStatus.PENDING);
    expect(subscriber.status).toBe(SubscriberStatus.ACTIVE);
  });

  it("allows an explicit consentStatus override regardless of source's default", () => {
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900003",
      registeredAlertZone: SYNTHETIC_ZONE,
      registrationSource: RegistrationSource.PROVINCIAL_ICT_ASSISTANT,
      consentStatus: ConsentStatus.GRANTED,
    });

    expect(subscriber.consent_status).toBe(ConsentStatus.GRANTED);
  });

  it("throws rather than silently registering with a missing required input", () => {
    expect(() =>
      registerSubscriber({ registeredAlertZone: SYNTHETIC_ZONE, registrationSource: RegistrationSource.WEB_FORM }),
    ).toThrow();
    expect(() =>
      registerSubscriber({ phoneNumber: SYNTHETIC_PHONE, registrationSource: RegistrationSource.WEB_FORM }),
    ).toThrow();
    expect(() =>
      registerSubscriber({ phoneNumber: SYNTHETIC_PHONE, registeredAlertZone: SYNTHETIC_ZONE }),
    ).toThrow();
  });

  it("produces distinct subscriber_ids across separate registrations", () => {
    const a = registerSubscriber({
      phoneNumber: "+67799900004",
      registeredAlertZone: SYNTHETIC_ZONE,
      registrationSource: RegistrationSource.WEB_FORM,
    });
    const b = registerSubscriber({
      phoneNumber: "+67799900005",
      registeredAlertZone: SYNTHETIC_ZONE,
      registrationSource: RegistrationSource.WEB_FORM,
    });
    expect(a.subscriber_id).not.toBe(b.subscriber_id);
  });
});
