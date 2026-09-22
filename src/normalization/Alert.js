/**
 * The generic, multi-hazard Alert contract. Every HazardSource adapter
 * normalizes into this shape — downstream code (dedup, geo mapping,
 * distribution) must never depend on a raw CAP object or a cyclone-specific
 * field. Schema is fixed by docs/PROJECT_HANDOFF.md's "Data ingestion" section.
 *
 * @typedef {Object} AlertArea
 * @property {string} [description]   Free-text area description (CAP areaDesc)
 * @property {number[][]} [polygon]    Array of [lat, lon] pairs, ring closed
 * @property {{center: number[], radius: number}[]} [circle]
 * @property {{valueName: string, value: string}[]} [geocode]
 *
 * @typedef {Object} AlertReference
 * @property {string} sender
 * @property {string} identifier
 * @property {string} sent
 *
 * @typedef {Object} Alert
 * @property {string} alert_id                         Unique id for this specific message (CAP identifier)
 * @property {string} event_id                         Id linking related messages for the same real-world event
 * @property {string} hazard_type                      Free-text hazard type (e.g. "Strong Wind"), not an enum — stays generic across hazards
 * @property {string} sender                            Issuing entity/address (CAP sender)
 * @property {string} source                            Name of the HazardSource adapter that produced this Alert (e.g. "SIMS")
 * @property {string} status                            CAP status (Actual/Exercise/System/Test/Draft)
 * @property {string} msg_type                          CAP msgType (Alert/Update/Cancel/Ack/Error)
 * @property {string} severity
 * @property {string} urgency
 * @property {string} certainty
 * @property {string|null} effective                    ISO 8601 timestamp, or null if absent
 * @property {string|null} expires                      ISO 8601 timestamp, or null if absent
 * @property {AlertArea[]} alert_areas
 * @property {string|null} instructions
 * @property {AlertReference[]} references
 * @property {*} source_intensity                        Source's own native intensity measure, hazard-specific and opaque to this schema
 * @property {number|null} source_wind_speed
 * @property {string|null} source_category
 * @property {*} normalized_intensity                    Reserved for the normalization stage; ingestion never sets this
 * @property {boolean} authoritative_for_local_warning   Whether this source's word is sufficient to trigger local dissemination (true for SIMS, false for cross-check sources like RSMC/JTWC)
 * @property {string} raw_payload                        The raw fetched payload, verbatim, for audit trail
 * @property {Object} source_metadata                    Adapter-specific extras (e.g. RSS item fields) that don't belong in the generic schema
 * @property {string} raw_source_url                     URL the raw payload was fetched from
 * @property {string} retrieved_at                       ISO 8601 timestamp of when this adapter fetched the payload
 * @property {string} payload_hash                       SHA-256 hex digest of raw_payload
 */

const REQUIRED_FIELDS = [
  "alert_id",
  "event_id",
  "hazard_type",
  "sender",
  "source",
  "status",
  "msg_type",
  "severity",
  "urgency",
  "certainty",
  "alert_areas",
  "raw_payload",
  "raw_source_url",
  "retrieved_at",
  "payload_hash",
];

/**
 * Builds a validated, immutable Alert. Fields not passed in `fields` fall
 * back to the defaults below rather than being left undefined, so every
 * Alert instance carries the full schema.
 *
 * @param {Partial<Alert>} fields
 * @returns {Readonly<Alert>}
 */
export function createAlert(fields) {
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] === undefined || fields[key] === null) {
      throw new Error(`Alert is missing required field: ${key}`);
    }
  }

  /** @type {Alert} */
  const alert = {
    alert_id: fields.alert_id,
    event_id: fields.event_id,
    hazard_type: fields.hazard_type,
    sender: fields.sender,
    source: fields.source,
    status: fields.status,
    msg_type: fields.msg_type,
    severity: fields.severity,
    urgency: fields.urgency,
    certainty: fields.certainty,
    effective: fields.effective ?? null,
    expires: fields.expires ?? null,
    alert_areas: fields.alert_areas,
    instructions: fields.instructions ?? null,
    references: fields.references ?? [],
    source_intensity: fields.source_intensity ?? null,
    source_wind_speed: fields.source_wind_speed ?? null,
    source_category: fields.source_category ?? null,
    normalized_intensity: fields.normalized_intensity ?? null,
    authoritative_for_local_warning: fields.authoritative_for_local_warning ?? false,
    raw_payload: fields.raw_payload,
    source_metadata: fields.source_metadata ?? {},
    raw_source_url: fields.raw_source_url,
    retrieved_at: fields.retrieved_at,
    payload_hash: fields.payload_hash,
  };

  return Object.freeze(alert);
}
