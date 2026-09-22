/**
 * Subscriber domain model. docs/PROJECT_HANDOFF.md, "Subscriber management":
 * "Subscriber data is personal data ... Keep the table minimal:
 * phone_number, registered_alert_zone, consent_status, registration_source,
 * timestamps, status — avoid collecting names or other personal attributes
 * unless operationally required and separately approved."
 *
 * `subscriber_id` is the one field added beyond that literal list — the doc
 * doesn't name an id, but distribution (NotificationService, idempotency)
 * needs a stable recipient_id per subscriber that isn't the phone number
 * itself (phone numbers can be reassigned/changed; the doc also treats
 * phone_number as sensitive enough to keep out of things like idempotency
 * hashing where avoidable elsewhere in this codebase). Flagging this as an
 * addition, not something read out of the handoff doc verbatim.
 */

/**
 * The doc doesn't define consent_status's values. Modeled as three states
 * because the two registration sources have genuinely different consent
 * postures (see registration.js): a web form is explicit self-service
 * opt-in (GRANTED immediately), while the doc says the ICT Assistant channel
 * "needs NDMO/MPGIS approval and defined consent procedures, not an
 * assumption" — which isn't built yet (out of scope for this stage), so a
 * subscriber registered through that channel is modeled as PENDING until
 * that real approval step exists, rather than assuming consent. This is a
 * judgment call, not a spec'd requirement.
 */
export const ConsentStatus = Object.freeze({
  GRANTED: "GRANTED",
  PENDING: "PENDING",
  REVOKED: "REVOKED",
});

/**
 * The doc names "status" as a required column but doesn't define its
 * values either. Two-way SMS isn't available on the +677 aggregator routes
 * the doc names (no "reply STOP"), so unsubscribing has to happen through
 * some other channel (e.g. the web form, or an ICT Assistant) — this field
 * is what that action would flip, independently of consent_status (which
 * tracks whether collection/use of the number was ever authorized in the
 * first place).
 */
export const SubscriberStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  UNSUBSCRIBED: "UNSUBSCRIBED",
});

/**
 * Known registration_source values. Modeled the same way unit_type is on
 * AdministrativeUnit and channel is on OutboundMessage — open-ended,
 * not a closed enum — since the doc frames these two as a starting set
 * ("Opt-in options for v1"), not an exhaustive list; community/radio-driven
 * registration paths are mentioned in the doc as reaching people without
 * their own registration channel.
 *
 * @type {{ WEB_FORM: string, PROVINCIAL_ICT_ASSISTANT: string }}
 */
export const RegistrationSource = Object.freeze({
  WEB_FORM: "web_form",
  PROVINCIAL_ICT_ASSISTANT: "provincial_ict_assistant",
});

/**
 * @typedef {Object} Subscriber
 * @property {string} subscriber_id
 * @property {string} phone_number             E.164-ish string (e.g. "+67712345678") — never a real number outside production data
 * @property {string} registered_alert_zone     An AdministrativeUnit id (src/geo/AdministrativeUnit.js) — the subscriber's registered province/ward, not their live location
 * @property {string} consent_status            One of ConsentStatus
 * @property {string} registration_source       Free-text (see RegistrationSource for known values)
 * @property {string} status                    One of SubscriberStatus
 * @property {string} created_at                ISO 8601 timestamp
 * @property {string} updated_at                ISO 8601 timestamp
 */

const REQUIRED_FIELDS = [
  "subscriber_id",
  "phone_number",
  "registered_alert_zone",
  "consent_status",
  "registration_source",
  "status",
  "created_at",
  "updated_at",
];

/**
 * @param {Partial<Subscriber>} fields
 * @returns {Readonly<Subscriber>}
 */
export function createSubscriber(fields) {
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] === undefined || fields[key] === null) {
      throw new Error(`Subscriber is missing required field: ${key}`);
    }
  }
  if (!Object.values(ConsentStatus).includes(fields.consent_status)) {
    throw new Error(`Subscriber has invalid consent_status: ${fields.consent_status}`);
  }
  if (!Object.values(SubscriberStatus).includes(fields.status)) {
    throw new Error(`Subscriber has invalid status: ${fields.status}`);
  }

  return Object.freeze({
    subscriber_id: fields.subscriber_id,
    phone_number: fields.phone_number,
    registered_alert_zone: fields.registered_alert_zone,
    consent_status: fields.consent_status,
    registration_source: fields.registration_source,
    status: fields.status,
    created_at: fields.created_at,
    updated_at: fields.updated_at,
  });
}
