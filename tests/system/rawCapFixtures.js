/**
 * Synthetic, hand-written RSS + CAP 1.2 XML — shaped exactly like the real
 * SIMS feed's structure (see src/shared/rss.js, src/shared/capParser.js),
 * but entirely fabricated content, used only so HazardWarningSystem's full
 * pipeline test can exercise real ingestion parsing code without any real
 * network call. The polygon text is copied verbatim from
 * tests/geo/fixtures.js's EASTERN_REGION_AREA (a real, hand-verified SIMS
 * polygon that mapping.test.js already confirms resolves to Guadalcanal,
 * Makira-Ulawa, Rennell-Bell and Temotu, not Western) so this fixture's geo
 * outcome is trustworthy without re-deriving a new polygon by hand.
 */

export const RSS_URL = "https://example.test/sb-met-en/rss.xml";
export const CAP_ITEM_URL = "https://example.test/sb-met-en/2026-09-22-08-00-00.xml";

export const RSS_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SIMS Warnings</title>
    <item>
      <title>Strong Wind Warning Number 300</title>
      <link>${CAP_ITEM_URL}</link>
      <description>Strong Wind Warning Number 300</description>
      <author>forecast@met.gov.sb</author>
      <guid>${CAP_ITEM_URL}</guid>
      <pubDate>Tue, 22 Sep 2026 08:00:00 +1100</pubDate>
    </item>
  </channel>
</rss>`;

export const CAP_ITEM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>urn:oid:test.system.300</identifier>
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
    <senderName>Solomon Islands Meteorological Service</senderName>
    <headline>Strong Wind Warning Number 300</headline>
    <description>Strong winds expected over the eastern region.</description>
    <instruction>Move to higher ground and secure loose property.</instruction>
    <eventCode>
      <valueName>OET:v1.2</valueName>
      <value>OET-300</value>
    </eventCode>
    <area>
      <areaDesc>Eastern region, south Russell and Guadalcanal</areaDesc>
      <polygon>-9.3466,159.2842 -9.3558,158.9722 -12.4516,159.0645 -12.4859,167.7305 -12.4731,171.1494 -9.9256,171.0088 -9.5054,168.0205 -9.5011,163.1250 -9.8909,163.1228 -9.7237,161.8336 -9.9440,161.8088 -9.9191,161.5078 -9.8779,161.0442 -9.8498,160.2532 -9.7589,159.6907 -9.3293,159.5775 -9.3466,159.2842</polygon>
    </area>
  </info>
</alert>`;

/**
 * A minimal Response-shaped stub (only .ok and .text() are used by
 * SIMSCAPAdapter) that dispatches on URL, so it works as `fetchImpl` for a
 * real SIMSCAPAdapter with zero network access.
 *
 * @returns {typeof fetch}
 */
export function buildStubFetch() {
  const xmlByUrl = {
    [RSS_URL]: RSS_INDEX_XML,
    [CAP_ITEM_URL]: CAP_ITEM_XML,
  };

  return async function stubFetch(url) {
    const xml = xmlByUrl[url];
    if (xml === undefined) {
      throw new Error(`Unexpected fetch in test stub: ${url}`);
    }
    return { ok: true, text: async () => xml };
  };
}
