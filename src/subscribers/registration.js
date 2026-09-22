import { randomUUID } from "node:crypto";
import { createSubscriber, ConsentStatus, RegistrationSource, SubscriberStatus } from "./Subscriber.js";

/**
 * Default consent posture per registration_source, applied only when the
 * caller doesn't explicitly pass consentStatus. docs/PROJECT_HANDOFF.md
 * treats the two v1 channels differently: a web form is the subscriber
 * acting for themselves (self-service opt-in, consent is immediate), while
 * the ICT Assistant channel "needs NDMO/MPGIS approval and defined consent
 * procedures, not an assumption" — since that approval flow is explicitly
 * out of scope for this stage, a registration through it defaults to
 * PENDING rather than defaulting to GRANTED on an assumption the doc itself
 * warns against. Judgment call — flagged here and in Subscriber.js.
 *
 * Any other registration_source (a future channel not yet named in the
 * doc) also defaults to PENDING, on the same "don't assume consent"
 * reasoning.
 *
 * @param {string} registrationSource
 * @returns {string}
 */
function defaultConsentStatusFor(registrationSource) {
  return registrationSource === RegistrationSource.WEB_FORM ? ConsentStatus.GRANTED : ConsentStatus.PENDING;
}

/**
 * Registers a new Subscriber. This is the data-model half of registration
 * only — no web form UI, no ICT Assistant approval workflow; those are
 * explicitly out of scope for this stage.
 *
 * @param {{
 *   phoneNumber: string,
 *   registeredAlertZone: string,
 *   registrationSource: string,
 *   consentStatus?: string,
 *   now?: string,
 * }} params
 * @returns {Readonly<import("./Subscriber.js").Subscriber>}
 */
export function registerSubscriber({ phoneNumber, registeredAlertZone, registrationSource, consentStatus, now }) {
  if (!phoneNumber) throw new Error("registerSubscriber requires phoneNumber");
  if (!registeredAlertZone) throw new Error("registerSubscriber requires registeredAlertZone");
  if (!registrationSource) throw new Error("registerSubscriber requires registrationSource");

  const timestamp = now ?? new Date().toISOString();

  return createSubscriber({
    subscriber_id: randomUUID(),
    phone_number: phoneNumber,
    registered_alert_zone: registeredAlertZone,
    consent_status: consentStatus ?? defaultConsentStatusFor(registrationSource),
    registration_source: registrationSource,
    status: SubscriberStatus.ACTIVE,
    created_at: timestamp,
    updated_at: timestamp,
  });
}
