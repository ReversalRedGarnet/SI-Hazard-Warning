import { HazardSource } from "./HazardSource.js";
import { parseRssIndex } from "../shared/rss.js";
import { parseCapXml, capToAlertFields } from "../shared/capParser.js";
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
 */
export class SIMSCAPAdapter extends HazardSource {
  /**
   * @param {{ rssUrl?: string, fetchImpl?: typeof fetch }} [options]
   */
  constructor(options = {}) {
    super();
    this.rssUrl = options.rssUrl ?? DEFAULT_RSS_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get sourceName() {
    return "SIMS";
  }

  async fetchAlerts() {
    const items = await this.fetchIndex();
    const alerts = [];
    for (const item of items) {
      alerts.push(await this.fetchAlert(item));
    }
    return alerts;
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
