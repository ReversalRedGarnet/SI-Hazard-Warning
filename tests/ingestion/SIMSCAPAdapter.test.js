import { describe, it, expect, beforeAll } from "vitest";
import { SIMSCAPAdapter } from "../../src/ingestion/SIMSCAPAdapter.js";
import { generateTestKeyPair, signCapXml, TEST_CAP_XML } from "../shared/capSignatureFixtures.js";

/**
 * Fixture-based (no network) coverage of audit finding H1: one malformed
 * CAP item must not take down the rest of a batch. tests/ingestion/
 * SIMSCAPAdapter.live.test.js covers the real feed; this covers the
 * per-item error boundary specifically, which the live feed has no
 * reliable way to exercise (it doesn't serve broken XML on demand).
 */

const RSS_URL = "https://example.test/sb-met-en/rss.xml";
const GOOD_ITEM_URL = "https://example.test/sb-met-en/good.xml";
const BAD_ITEM_URL = "https://example.test/sb-met-en/bad.xml";

const RSS_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Strong Wind Warning Number 400</title>
      <link>${GOOD_ITEM_URL}</link>
      <guid>${GOOD_ITEM_URL}</guid>
      <pubDate>Tue, 22 Sep 2026 08:00:00 +1100</pubDate>
    </item>
    <item>
      <title>Malformed item</title>
      <link>${BAD_ITEM_URL}</link>
      <guid>${BAD_ITEM_URL}</guid>
      <pubDate>Tue, 22 Sep 2026 08:05:00 +1100</pubDate>
    </item>
  </channel>
</rss>`;

const GOOD_CAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>urn:oid:test.ingestion.400</identifier>
  <sender>forecast@met.gov.sb</sender>
  <sent>2026-09-22T08:00:00+11:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>en-US</language>
    <category>Met</category>
    <event>Strong Wind</event>
    <urgency>Immediate</urgency>
    <severity>Severe</severity>
    <certainty>Likely</certainty>
    <expires>2026-09-23T08:00:00+11:00</expires>
    <headline>Strong Wind Warning Number 400</headline>
    <instruction>Move to higher ground.</instruction>
    <area>
      <areaDesc>Test area</areaDesc>
    </area>
  </info>
</alert>`;

// Not CAP at all — missing the <alert> root parseCapXml requires.
const BAD_ITEM_XML = `<?xml version="1.0" encoding="UTF-8"?><not-cap><oops/></not-cap>`;

function buildStubFetch() {
  const xmlByUrl = {
    [RSS_URL]: RSS_INDEX_XML,
    [GOOD_ITEM_URL]: GOOD_CAP_XML,
    [BAD_ITEM_URL]: BAD_ITEM_XML,
  };
  return async function stubFetch(url) {
    return { ok: true, text: async () => xmlByUrl[url] };
  };
}

describe("SIMSCAPAdapter.fetchAlerts() — per-item error isolation", () => {
  it("returns the valid items and reports the malformed one, rather than losing the whole batch", async () => {
    const adapter = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl: buildStubFetch() });

    const { alerts, failures } = await adapter.fetchAlerts();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_id).toBe("urn:oid:test.ingestion.400");

    expect(failures).toHaveLength(1);
    expect(failures[0].url).toBe(BAD_ITEM_URL);
    expect(failures[0].error).toBeTruthy();
    expect(typeof failures[0].occurredAt).toBe("string");
    expect(() => new Date(failures[0].occurredAt).toISOString()).not.toThrow();
  });

  it("returns an empty failures array when every item parses fine", async () => {
    const singleItemRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item><link>${GOOD_ITEM_URL}</link></item></channel></rss>`;
    const fetchImpl = async (url) => ({
      ok: true,
      text: async () => (url === RSS_URL ? singleItemRss : GOOD_CAP_XML),
    });
    const adapter = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl });

    const { alerts, failures } = await adapter.fetchAlerts();
    expect(alerts).toHaveLength(1);
    expect(failures).toHaveLength(0);
  });

  it("still throws (no partial batch to salvage) when the index fetch itself fails", async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });
    const adapter = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl });

    await expect(adapter.fetchAlerts()).rejects.toThrow(/HTTP 503/);
  });
});

describe("SIMSCAPAdapter — CAP signature verification (audit finding H3, opt-in via trustedCapCertPem)", () => {
  /** @type {{ publicKey: string, privateKey: string }} */
  let keyPair;
  let signedItemXml;

  const SIGNED_ITEM_URL = "https://example.test/sb-met-en/signed.xml";
  const UNSIGNED_ITEM_URL = "https://example.test/sb-met-en/unsigned.xml";

  beforeAll(() => {
    keyPair = generateTestKeyPair();
    signedItemXml = signCapXml(TEST_CAP_XML, keyPair.privateKey);
  });

  function buildRss(urls) {
    const items = urls.map((url) => `<item><link>${url}</link></item>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${items}</channel></rss>`;
  }

  it("is off by default — an unsigned item is accepted when trustedCapCertPem isn't configured", async () => {
    const fetchImpl = async (url) => ({
      ok: true,
      text: async () => (url === RSS_URL ? buildRss([UNSIGNED_ITEM_URL]) : TEST_CAP_XML),
    });
    const adapter = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl });

    const { alerts, failures } = await adapter.fetchAlerts();
    expect(alerts).toHaveLength(1);
    expect(failures).toHaveLength(0);
  });

  it("accepts a validly-signed item when trustedCapCertPem is configured", async () => {
    const fetchImpl = async (url) => ({
      ok: true,
      text: async () => (url === RSS_URL ? buildRss([SIGNED_ITEM_URL]) : signedItemXml),
    });
    const adapter = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl, trustedCapCertPem: keyPair.publicKey });

    const { alerts, failures } = await adapter.fetchAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_id).toBe("urn:oid:test.signature.1");
    expect(failures).toHaveLength(0);
  });

  it("rejects a tampered item (same structure, altered content) into failures, not the alert batch", async () => {
    const tamperedXml = signedItemXml.replace("Severe", "Extreme");
    const fetchImpl = async (url) => ({
      ok: true,
      text: async () => (url === RSS_URL ? buildRss([SIGNED_ITEM_URL]) : tamperedXml),
    });
    const adapter = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl, trustedCapCertPem: keyPair.publicKey });

    const { alerts, failures } = await adapter.fetchAlerts();
    expect(alerts).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].url).toBe(SIGNED_ITEM_URL);
    expect(failures[0].error).toMatch(/CAP signature verification failed/);
  });

  it("rejects an unsigned item into failures once verification is configured — not silently trusted", async () => {
    const fetchImpl = async (url) => ({
      ok: true,
      text: async () => (url === RSS_URL ? buildRss([UNSIGNED_ITEM_URL]) : TEST_CAP_XML),
    });
    const adapter = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl, trustedCapCertPem: keyPair.publicKey });

    const { alerts, failures } = await adapter.fetchAlerts();
    expect(alerts).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toMatch(/CAP signature verification failed \(MISSING\)/);
  });

  it("isolates a signature failure from an otherwise-valid batch (reuses the H1 per-item boundary)", async () => {
    const fetchImpl = async (url) => {
      if (url === RSS_URL) return { ok: true, text: async () => buildRss([SIGNED_ITEM_URL, UNSIGNED_ITEM_URL]) };
      if (url === SIGNED_ITEM_URL) return { ok: true, text: async () => signedItemXml };
      return { ok: true, text: async () => TEST_CAP_XML };
    };
    const adapter = new SIMSCAPAdapter({ rssUrl: RSS_URL, fetchImpl, trustedCapCertPem: keyPair.publicKey });

    const { alerts, failures } = await adapter.fetchAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_id).toBe("urn:oid:test.signature.1");
    expect(failures).toHaveLength(1);
    expect(failures[0].url).toBe(UNSIGNED_ITEM_URL);
  });
});
