import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
});

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * @typedef {Object} RssItem
 * @property {string} title
 * @property {string} link
 * @property {string|null} description
 * @property {string|null} author
 * @property {string|null} guid
 * @property {string|null} pubDate
 */

/**
 * Parses an RSS 2.0 index (the SIMS CAP source feed's format) into its items.
 *
 * @param {string} xml
 * @returns {RssItem[]}
 */
export function parseRssIndex(xml) {
  const doc = parser.parse(xml);
  const channel = doc.rss?.channel;
  if (!channel) {
    throw new Error("Not an RSS 2.0 document (missing <rss><channel>)");
  }

  return toArray(channel.item).map((item) => ({
    title: item.title ?? null,
    link: item.link,
    description: item.description ?? null,
    author: item.author ?? null,
    guid: item.guid ?? null,
    pubDate: item.pubDate ?? null,
  }));
}
