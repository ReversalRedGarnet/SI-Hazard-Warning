import { ConsentStatus, SubscriberStatus } from "./Subscriber.js";

/**
 * Walks a zone id up its AdministrativeUnit.parent_id chain (including the
 * zone itself) and checks whether any unit along the way is in the affected
 * set. This is what makes the graph model in src/geo/AdministrativeUnit.js
 * actually pay off here: src/geo/mapping.js currently only resolves alerts
 * down to province/city level (ward-level geometry isn't loaded yet — see
 * boundaryDataset.js), but a subscriber's registered_alert_zone is allowed
 * to be any unit in the graph, present or future (a ward, once that data
 * exists). A subscriber registered at a ward under an affected province
 * must still match on the province-level result; walking parent_id is what
 * makes that work without this function needing to know about levels.
 *
 * It's also what keeps Honiara and Guadalcanal correctly separate: they're
 * siblings under the country root, not nested, so a subscriber under one
 * never walks into the other's id by accident.
 *
 * Returns false (rather than throwing) for a zone id not found in
 * `allUnits` — e.g. a subscriber registered against a unit id from an
 * older dataset_version that a boundary-data update has since removed or
 * renumbered. That's still the right thing for this function to do in
 * isolation (an unresolvable zone genuinely isn't "in" the affected set),
 * but it means this function's `false` can't by itself distinguish "zone
 * resolved, not affected" from "zone unresolved" — callers that care about
 * that distinction (resolveRecipientSubscribers, below) must check
 * `isZoneKnown` separately rather than relying on this return value alone.
 *
 * @param {string} zoneId
 * @param {Set<string>} affectedIds
 * @param {import("../geo/AdministrativeUnit.js").AdministrativeUnit[]} allUnits
 * @returns {boolean}
 */
export function zoneIsAffected(zoneId, affectedIds, allUnits) {
  const unitsById = new Map(allUnits.map((unit) => [unit.id, unit]));

  let current = unitsById.get(zoneId);
  const visited = new Set();

  while (current) {
    if (affectedIds.has(current.id)) return true;
    if (visited.has(current.id)) break; // defends against a malformed cyclic dataset, not an expected case
    visited.add(current.id);
    current = current.parent_id ? unitsById.get(current.parent_id) : undefined;
  }

  return false;
}

/**
 * Whether a zone id exists at all in the current AdministrativeUnit graph.
 * This is what makes an unresolvable registered_alert_zone (dataset version
 * drift — a unit id renumbered or removed since a subscriber registered)
 * distinguishable from a zone that resolved fine but genuinely isn't
 * affected. Previously resolveRecipientSubscribers had no way to tell these
 * apart: both silently produced "not in the recipient list," so a
 * dataset-drift subscriber vanished with no trace instead of surfacing as
 * an operational problem to fix.
 *
 * @param {string} zoneId
 * @param {import("../geo/AdministrativeUnit.js").AdministrativeUnit[]} allUnits
 * @returns {boolean}
 */
export function isZoneKnown(zoneId, allUnits) {
  return allUnits.some((unit) => unit.id === zoneId);
}

/**
 * The geo-output-becomes-a-recipient-list function: given the
 * AdministrativeUnits an Alert affects (mapAlertToAdministrativeUnits's
 * `affectedUnits`) and the full subscriber base, returns both who should be
 * notified and who couldn't be evaluated at all.
 *
 * Filters out anything that isn't a live, consented subscription before
 * even looking at zone:
 * - status must be ACTIVE (UNSUBSCRIBED subscribers are never notified)
 * - consent_status must be GRANTED — a PENDING ICT-Assistant registration
 *   (see registration.js) is deliberately excluded here, since sending to
 *   someone whose consent hasn't actually been confirmed would defeat the
 *   point of modeling PENDING at all. This is the enforcement point for
 *   that judgment call.
 *
 * Among the remaining (ACTIVE, GRANTED) subscribers, a registered_alert_zone
 * that isn't found in `allUnits` is reported separately in
 * `unresolvedZoneSubscribers` rather than being folded into "not affected."
 * An unresolved zone is an operational problem (their zone id needs
 * reconciling against the current boundary dataset) — it isn't evidence
 * they're outside the hazard area, so it must never look identical to a
 * genuine non-match to the caller.
 *
 * @param {import("../geo/AdministrativeUnit.js").AdministrativeUnit[]} affectedUnits
 * @param {import("./Subscriber.js").Subscriber[]} subscribers
 * @param {import("../geo/AdministrativeUnit.js").AdministrativeUnit[]} allUnits
 * @returns {{
 *   recipients: import("./Subscriber.js").Subscriber[],
 *   unresolvedZoneSubscribers: import("./Subscriber.js").Subscriber[],
 * }}
 */
export function resolveRecipientSubscribers(affectedUnits, subscribers, allUnits) {
  const affectedIds = new Set(affectedUnits.map((unit) => unit.id));

  const recipients = [];
  const unresolvedZoneSubscribers = [];

  for (const subscriber of subscribers) {
    if (subscriber.status !== SubscriberStatus.ACTIVE || subscriber.consent_status !== ConsentStatus.GRANTED) {
      continue;
    }

    if (!isZoneKnown(subscriber.registered_alert_zone, allUnits)) {
      unresolvedZoneSubscribers.push(subscriber);
      continue;
    }

    if (zoneIsAffected(subscriber.registered_alert_zone, affectedIds, allUnits)) {
      recipients.push(subscriber);
    }
  }

  return { recipients, unresolvedZoneSubscribers };
}

/**
 * Produces the exact `{recipientId, phoneNumber}` shape
 * NotificationService.send() expects (src/distribution/NotificationService.js).
 * This is the one place that shape gets constructed from a Subscriber, so
 * a future schema change on either side only needs one edit.
 *
 * @param {import("./Subscriber.js").Subscriber} subscriber
 * @returns {{ recipientId: string, phoneNumber: string }}
 */
export function toRecipient(subscriber) {
  return { recipientId: subscriber.subscriber_id, phoneNumber: subscriber.phone_number };
}
