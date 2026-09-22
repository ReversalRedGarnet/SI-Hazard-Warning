import { describe, it, expect } from "vitest";
import { createAdministrativeUnit, BOUNDARY_STATUS } from "../../src/geo/AdministrativeUnit.js";
import { registerSubscriber } from "../../src/subscribers/registration.js";
import { RegistrationSource } from "../../src/subscribers/Subscriber.js";
import { zoneIsAffected, isZoneKnown, resolveRecipientSubscribers, toRecipient } from "../../src/subscribers/matching.js";

/**
 * A small synthetic graph mirroring the real shape (country -> province,
 * with Honiara modeled as a sibling of Guadalcanal, not nested inside it —
 * see src/geo/boundaryDataset.js) plus one ward level that doesn't exist in
 * the bundled real dataset yet, to prove registered_alert_zone can point
 * below province level even before ward geometry is loaded.
 */
function buildUnitGraph() {
  const country = createAdministrativeUnit({
    id: "SB",
    unit_type: "country",
    parent_id: null,
    name: "Solomon Islands",
    geometry: null,
    dataset_version: "test-v1",
    boundary_status: BOUNDARY_STATUS.DEVELOPMENT_ONLY,
  });
  const guadalcanal = createAdministrativeUnit({
    id: "SB06",
    unit_type: "province",
    parent_id: "SB",
    name: "Guadalcanal",
    geometry: null,
    dataset_version: "test-v1",
    boundary_status: BOUNDARY_STATUS.DEVELOPMENT_ONLY,
  });
  const honiara = createAdministrativeUnit({
    id: "SB10",
    unit_type: "city",
    parent_id: "SB",
    name: "Honiara",
    geometry: null,
    dataset_version: "test-v1",
    boundary_status: BOUNDARY_STATUS.DEVELOPMENT_ONLY,
  });
  const wardUnderGuadalcanal = createAdministrativeUnit({
    id: "SB06-W1",
    unit_type: "ward",
    parent_id: "SB06",
    name: "Test Ward",
    geometry: null,
    dataset_version: "test-v1",
    boundary_status: BOUNDARY_STATUS.DEVELOPMENT_ONLY,
  });

  return [country, guadalcanal, honiara, wardUnderGuadalcanal];
}

describe("zoneIsAffected", () => {
  const units = buildUnitGraph();

  it("matches when the subscriber's zone is itself in the affected set", () => {
    expect(zoneIsAffected("SB06", new Set(["SB06"]), units)).toBe(true);
  });

  it("matches a ward whose parent province is affected (walks parent_id up)", () => {
    expect(zoneIsAffected("SB06-W1", new Set(["SB06"]), units)).toBe(true);
  });

  it("does not match Honiara when only Guadalcanal is affected — siblings, not nested", () => {
    expect(zoneIsAffected("SB10", new Set(["SB06"]), units)).toBe(false);
  });

  it("does not match a ward under Honiara when only Guadalcanal is affected", () => {
    const wardUnderHoniara = createAdministrativeUnit({
      id: "SB10-W1",
      unit_type: "ward",
      parent_id: "SB10",
      name: "Test Honiara Ward",
      geometry: null,
      dataset_version: "test-v1",
      boundary_status: BOUNDARY_STATUS.DEVELOPMENT_ONLY,
    });
    expect(zoneIsAffected("SB10-W1", new Set(["SB06"]), [...units, wardUnderHoniara])).toBe(false);
  });

  it("returns false, not a throw, for a zone id absent from the unit graph", () => {
    expect(zoneIsAffected("SB99-DOES-NOT-EXIST", new Set(["SB06"]), units)).toBe(false);
  });
});

describe("isZoneKnown", () => {
  const units = buildUnitGraph();

  it("is true for a zone id present in the unit graph", () => {
    expect(isZoneKnown("SB06", units)).toBe(true);
  });

  it("is false for a zone id absent from the unit graph", () => {
    expect(isZoneKnown("SB99-DOES-NOT-EXIST", units)).toBe(false);
  });
});

describe("resolveRecipientSubscribers", () => {
  const units = buildUnitGraph();
  const guadalcanalUnit = units.find((u) => u.id === "SB06");
  const honiaraUnit = units.find((u) => u.id === "SB10");

  it("includes an ACTIVE, consent-GRANTED subscriber in an affected zone", () => {
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900010",
      registeredAlertZone: "SB06",
      registrationSource: RegistrationSource.WEB_FORM,
    });

    const { recipients, unresolvedZoneSubscribers } = resolveRecipientSubscribers(
      [guadalcanalUnit],
      [subscriber],
      units,
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0].subscriber_id).toBe(subscriber.subscriber_id);
    expect(unresolvedZoneSubscribers).toHaveLength(0);
  });

  it("excludes a subscriber whose zone isn't affected", () => {
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900011",
      registeredAlertZone: "SB10", // Honiara
      registrationSource: RegistrationSource.WEB_FORM,
    });

    const { recipients, unresolvedZoneSubscribers } = resolveRecipientSubscribers(
      [guadalcanalUnit],
      [subscriber],
      units,
    );
    expect(recipients).toHaveLength(0);
    expect(unresolvedZoneSubscribers).toHaveLength(0);
  });

  it("reports a subscriber whose registered_alert_zone doesn't exist in the current unit graph as unresolved, not as a plain non-match", () => {
    // Simulates dataset version drift: a subscriber registered against a
    // unit id (e.g. from an older boundary dataset) that the currently
    // loaded AdministrativeUnit graph no longer has. This must never look
    // like "genuinely not affected" — it's an operational problem to
    // reconcile, and the whole point of this test is that it doesn't
    // silently vanish.
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900099",
      registeredAlertZone: "SB99-DOES-NOT-EXIST",
      registrationSource: RegistrationSource.WEB_FORM,
    });

    const { recipients, unresolvedZoneSubscribers } = resolveRecipientSubscribers(
      [guadalcanalUnit],
      [subscriber],
      units,
    );
    expect(recipients).toHaveLength(0);
    expect(unresolvedZoneSubscribers).toHaveLength(1);
    expect(unresolvedZoneSubscribers[0].subscriber_id).toBe(subscriber.subscriber_id);
  });

  it("excludes a PENDING-consent subscriber (ICT Assistant, unapproved) even if their zone is affected", () => {
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900012",
      registeredAlertZone: "SB06",
      registrationSource: RegistrationSource.PROVINCIAL_ICT_ASSISTANT,
    });

    const { recipients, unresolvedZoneSubscribers } = resolveRecipientSubscribers(
      [guadalcanalUnit],
      [subscriber],
      units,
    );
    expect(recipients).toHaveLength(0);
    expect(unresolvedZoneSubscribers).toHaveLength(0);
  });

  it("does not report an unresolved zone for a subscriber who'd be filtered out by status/consent anyway", () => {
    // An UNSUBSCRIBED or PENDING subscriber is never a recipient regardless
    // of zone resolution, so their zone shouldn't show up as an
    // operational problem to chase — only ACTIVE+GRANTED subscribers are
    // actually eligible, so only their zones are worth reconciling.
    const pendingWithBadZone = registerSubscriber({
      phoneNumber: "+67799900098",
      registeredAlertZone: "SB99-DOES-NOT-EXIST",
      registrationSource: RegistrationSource.PROVINCIAL_ICT_ASSISTANT,
    });

    const { recipients, unresolvedZoneSubscribers } = resolveRecipientSubscribers(
      [guadalcanalUnit],
      [pendingWithBadZone],
      units,
    );
    expect(recipients).toHaveLength(0);
    expect(unresolvedZoneSubscribers).toHaveLength(0);
  });

  it("excludes an UNSUBSCRIBED-status subscriber even with GRANTED consent in an affected zone", () => {
    const active = registerSubscriber({
      phoneNumber: "+67799900013",
      registeredAlertZone: "SB06",
      registrationSource: RegistrationSource.WEB_FORM,
    });
    const unsubscribed = { ...active, status: "UNSUBSCRIBED" };

    const { recipients } = resolveRecipientSubscribers([guadalcanalUnit], [active, unsubscribed], units);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].subscriber_id).toBe(active.subscriber_id);
  });

  it("handles multiple affected units and multiple subscribers together", () => {
    const inGuadalcanal = registerSubscriber({
      phoneNumber: "+67799900014",
      registeredAlertZone: "SB06",
      registrationSource: RegistrationSource.WEB_FORM,
    });
    const inHoniara = registerSubscriber({
      phoneNumber: "+67799900015",
      registeredAlertZone: "SB10",
      registrationSource: RegistrationSource.WEB_FORM,
    });

    const { recipients } = resolveRecipientSubscribers(
      [guadalcanalUnit, honiaraUnit],
      [inGuadalcanal, inHoniara],
      units,
    );
    expect(recipients.map((s) => s.subscriber_id).sort()).toEqual(
      [inGuadalcanal.subscriber_id, inHoniara.subscriber_id].sort(),
    );
  });
});

describe("toRecipient", () => {
  it("produces the {recipientId, phoneNumber} shape NotificationService.send() expects", () => {
    const subscriber = registerSubscriber({
      phoneNumber: "+67799900016",
      registeredAlertZone: "SB06",
      registrationSource: RegistrationSource.WEB_FORM,
    });

    expect(toRecipient(subscriber)).toEqual({
      recipientId: subscriber.subscriber_id,
      phoneNumber: "+67799900016",
    });
  });
});
