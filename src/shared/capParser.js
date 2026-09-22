import { XMLParser } from "fast-xml-parser";
import { sha256Hex } from "./hash.js";

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  trimValues: true,
});

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** "lat,lon lat,lon ..." -> [[lat, lon], ...] */
function parsePolygon(polygonText) {
  return polygonText
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));
}

/** "lat,lon radius_km" -> {center: [lat, lon], radius} */
function parseCircle(circleText) {
  const [point, radiusStr] = circleText.trim().split(/\s+/);
  const [lat, lon] = point.split(",").map(Number);
  return { center: [lat, lon], radius: Number(radiusStr) };
}

function parseArea(areaNode) {
  return {
    description: areaNode.areaDesc ?? null,
    polygon: toArray(areaNode.polygon).map(parsePolygon),
    circle: toArray(areaNode.circle).map(parseCircle),
    geocode: toArray(areaNode.geocode).map((g) => ({ valueName: g.valueName, value: g.value })),
  };
}

/** Space-separated "sender,identifier,sent" triples on <references> */
function parseReferences(referencesText) {
  if (!referencesText) return [];
  return referencesText
    .trim()
    .split(/\s+/)
    .map((triple) => {
      const [sender, identifier, sent] = triple.split(",");
      return { sender, identifier, sent };
    });
}

/**
 * Parses a raw CAP 1.2 XML document into a plain structure that mirrors
 * CAP's own field names — this is not the Alert schema (see capToAlertFields
 * for that mapping). Fields SIMS isn't confirmed to populate (parameter,
 * circle, geocode, multiple info blocks) are still parsed generically so a
 * future CAP-based adapter (RSMC Nadi) isn't blocked by this one's shape.
 *
 * @param {string} xml
 */
export function parseCapXml(xml) {
  const doc = parser.parse(xml);
  const alertNode = doc.alert;
  if (!alertNode) {
    throw new Error("Not a CAP alert document (missing <alert> root)");
  }

  return {
    identifier: alertNode.identifier,
    sender: alertNode.sender,
    sent: alertNode.sent,
    status: alertNode.status,
    msgType: alertNode.msgType,
    scope: alertNode.scope,
    references: parseReferences(alertNode.references),
    infos: toArray(alertNode.info).map((info) => ({
      language: info.language ?? null,
      category: info.category ?? null,
      event: info.event ?? null,
      urgency: info.urgency,
      severity: info.severity,
      certainty: info.certainty,
      effective: info.effective ?? null,
      expires: info.expires ?? null,
      senderName: info.senderName ?? null,
      headline: info.headline ?? null,
      description: info.description ?? null,
      instruction: info.instruction ?? null,
      web: info.web ?? null,
      contact: info.contact ?? null,
      parameters: toArray(info.parameter).map((p) => ({ valueName: p.valueName, value: p.value })),
      areas: toArray(info.area).map(parseArea),
    })),
  };
}

/**
 * Maps a parsed CAP document to Alert schema fields (everything except
 * `source`, which the calling adapter knows and this module doesn't).
 * Uses the first <info> block — every SIMS alert observed so far carries
 * exactly one (English only).
 *
 * `event_id` has no CAP equivalent: CAP correlates messages via `references`,
 * which SIMS doesn't populate (see docs/PROJECT_HANDOFF.md — it reissues a
 * fresh identifier every cycle instead of an Update). Real event correlation
 * is normalization-stage work that doesn't exist yet, so this sets
 * event_id = alert_id, i.e. every message is treated as its own event until
 * dedup/correlation is built.
 *
 * CAP's `scope` has no field of its own in the Alert schema, so it's carried
 * in source_metadata alongside adapter-specific extras.
 *
 * @param {ReturnType<typeof parseCapXml>} capDoc
 * @param {{
 *   authoritativeForLocalWarning: boolean,
 *   rawPayload: string,
 *   rawSourceUrl: string,
 *   retrievedAt: string,
 *   sourceMetadata?: Object,
 * }} options
 */
export function capToAlertFields(capDoc, options) {
  const info = capDoc.infos[0] ?? {};

  return {
    alert_id: capDoc.identifier,
    event_id: capDoc.identifier,
    hazard_type: info.event ?? null,
    sender: capDoc.sender,
    status: capDoc.status,
    msg_type: capDoc.msgType,
    severity: info.severity,
    urgency: info.urgency,
    certainty: info.certainty,
    effective: info.effective,
    expires: info.expires,
    alert_areas: info.areas,
    instructions: info.instruction,
    references: capDoc.references,
    authoritative_for_local_warning: options.authoritativeForLocalWarning,
    raw_payload: options.rawPayload,
    source_metadata: { ...options.sourceMetadata, scope: capDoc.scope },
    raw_source_url: options.rawSourceUrl,
    retrieved_at: options.retrievedAt,
    payload_hash: sha256Hex(options.rawPayload),
  };
}
