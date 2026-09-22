import { HazardSource } from "./HazardSource.js";
import { parseRssIndex } from "../shared/rss.js";
import { parseCapXml, capToAlertFields } from "../shared/capParser.js";
import { verifyCapSignature, CapSignatureStatus } from "../shared/capSignature.js";
import { createAlert } from "../normalization/Alert.js";

const DEFAULT_RSS_URL = "https://cap-sources.s3.amazonaws.com/sb-met-en/rss.xml";

/**
 * Primary hazard source: the Solomon Islands Meteorological Service (SIMS)
 * CAP feed. SIMS is the WMO-registered alerting authority for Solomon
 * Islands, so its alerts are authoritative for local warning dissemination
 * (see docs/PROJECT_HANDOFF.md — RSMC Nadi/JTWC are cross-check only).
 *
 * Fetches the RSS index, then fetches and normalizes each linked CAP 1.2
 * item into an Alert. Does not dedup across polls or track source health —
 * that's normalization-stage work, out of scope here.
 *
 * CAP signature verification (audit finding H3) — `trustedCapCertPem` is an
 * opt-in constructor option, **off by default**, not a design shortcut.
 * Investigating the live feed directly (fetched 2026-09-22) found two
 * independent, unresolved problems, either one enough to block this being
 * safely on-by-default today:
 *
 *  1. Key trust: every live item's `<ds:KeyInfo>` carries the *same*
 *     self-signed X.509 certificate (sha256 fingerprint
 *     D4:0E:3E:B0:1A:B4:C9:78:0E:F7:83:07:16:10:8C:D4:02:68:9E:88:EB:0B:E3:
 *     36:76:A6:0A:30:48:82:31:F6), issued to `CN=Eliot Christian,
 *     O=alert-hub.org` — the operator of alert-hub.appspot.com, the CAP
 *     aggregation hub this feed is served through (confirmed by the RSS
 *     index's own `<atom:link rel="hub" href="//alert-hub.appspot.com"/>`),
 *     not SIMS, NDMO, or any solomonislands.gov.sb identity. No
 *     independent, out-of-band page publishing this fingerprint (or any
 *     genuine SIMS-specific key) was found — trusting this cert only
 *     proves a payload passed through the Alert Hub relay with its own
 *     key, not that SIMS actually issued it. This is exactly the "forged
 *     payload carries its own valid signature" hole verifyCapSignature.js
 *     is written to refuse to fall back into — but there's currently
 *     nothing legitimate to pin *instead*.
 *  2. Even setting (1) aside: the live signatures don't verify. Manually
 *     reconstructing the Exclusive-C14N-plus-enveloped-signature digest
 *     the payload itself declares (`http://www.w3.org/2001/10/xml-exc-c14n#`,
 *     `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`), using
 *     xml-crypto's own canonicalizer, does not reproduce the recorded
 *     `<ds:DigestValue>` for a real, unmodified, freshly-fetched item —
 *     tried against the exact bytes S3 serves (byte count matched the
 *     `Content-Length` header, ruling out a transport artifact), inclusive
 *     vs. exclusive canonicalization, with and without the leading
 *     `xml-stylesheet` processing instruction, and a literal-substring
 *     reconstruction — none matched. verifyCapSignature() itself is
 *     correct (proven separately against a signature this codebase
 *     generates and signs itself, in tests/) — whatever is actually
 *     signing these live payloads does not appear to implement standard
 *     XML-DSig canonicalization, so a correct verifier cannot confirm them
 *     regardless of which key it's given.
 *
 * Net effect: turning `trustedCapCertPem` on today, against *any* real
 * certificate, would currently quarantine every live item as INVALID —
 * not because anything is actually being tampered with, but because the
 * upstream signing process itself doesn't appear to produce standard,
 * independently-verifiable XML-DSig. This needs a real answer from
 * SIMS/NDMO/whoever operates their side of the Alert Hub integration
 * (what actually signs these, and where a real public key could be
 * obtained out-of-band) before this can be a code fix rather than a
 * standing quarantine of the real feed. Until then, this option exists,
 * is fully implemented and tested against signatures this codebase
 * controls end-to-end (tests/ingestion/), and stays off by default.
 */
export class SIMSCAPAdapter extends HazardSource {
  /**
   * @param {{ rssUrl?: string, fetchImpl?: typeof fetch, trustedCapCertPem?: string }} [options]
   */
  constructor(options = {}) {
    super();
    this.rssUrl = options.rssUrl ?? DEFAULT_RSS_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.trustedCapCertPem = options.trustedCapCertPem ?? null;
  }

  get sourceName() {
    return "SIMS";
  }

  /**
   * Fetches the RSS index, then fetches and normalizes each linked item.
   * docs/PROJECT_HANDOFF.md's acceptance criterion "malformed or untrusted
   * input is rejected or quarantined" — each item gets its own error
   * boundary here: a single malformed/unreachable CAP item is skipped and
   * reported in `failures` rather than throwing and losing every other
   * item in the same poll. Chose skip-and-log as the default (not, say,
   * throwing on the first bad item, or retrying it inline) — a bad item is
   * reported with enough detail to investigate (its URL, the error, when
   * it happened) without letting one bad source response block delivery of
   * everything else that parsed fine. A total failure of the index fetch
   * itself (fetchIndex() below) is a different, harder failure — that still
   * throws, since there's no partial batch to salvage at all.
   *
   * @returns {Promise<{
   *   alerts: import("../normalization/Alert.js").Alert[],
   *   failures: Array<{ url: string, error: string, occurredAt: string }>,
   * }>}
   */
  async fetchAlerts() {
    const items = await this.fetchIndex();
    const alerts = [];
    const failures = [];

    for (const item of items) {
      try {
        alerts.push(await this.fetchAlert(item));
      } catch (err) {
        failures.push({
          url: item.link,
          error: err instanceof Error ? err.message : String(err),
          occurredAt: new Date().toISOString(),
        });
      }
    }

    return { alerts, failures };
  }

  /** @returns {Promise<import("../shared/rss.js").RssItem[]>} */
  async fetchIndex() {
    const response = await this.fetchImpl(this.rssUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch SIMS RSS index: HTTP ${response.status}`);
    }
    const xml = await response.text();
    return parseRssIndex(xml);
  }

  /**
   * Fetches and normalizes a single CAP item linked from the RSS index.
   * When `trustedCapCertPem` is configured (see this class's own module
   * comment for why it isn't by default), a payload whose signature isn't
   * MISSING or valid against that pinned cert throws here — which
   * fetchAlerts()'s per-item try/catch (audit finding H1) then reports in
   * `failures` and excludes from the batch, the exact same severity and
   * path as any other malformed-input rejection.
   *
   * @param {import("../shared/rss.js").RssItem} item
   * @returns {Promise<import("../normalization/Alert.js").Alert>}
   */
  async fetchAlert(item) {
    const response = await this.fetchImpl(item.link);
    if (!response.ok) {
      throw new Error(`Failed to fetch CAP item ${item.link}: HTTP ${response.status}`);
    }
    const rawPayload = await response.text();
    const retrievedAt = new Date().toISOString();

    if (this.trustedCapCertPem) {
      const { status, reason } = verifyCapSignature(rawPayload, { trustedCertPem: this.trustedCapCertPem });
      if (status !== CapSignatureStatus.VALID) {
        throw new Error(`CAP signature verification failed (${status}): ${reason}`);
      }
    }

    const capDoc = parseCapXml(rawPayload);
    const fields = capToAlertFields(capDoc, {
      authoritativeForLocalWarning: true,
      rawPayload,
      rawSourceUrl: item.link,
      retrievedAt,
      sourceMetadata: {
        rss: {
          title: item.title,
          guid: item.guid,
          pubDate: item.pubDate,
        },
      },
    });

    return createAlert({ ...fields, source: this.sourceName });
  }
}
