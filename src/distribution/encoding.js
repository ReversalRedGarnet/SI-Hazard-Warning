/**
 * GSM 03.38 default alphabet detection and SMS segment-count math.
 * docs/PROJECT_HANDOFF.md: "Keep messages under 160 characters (GSM-7) —
 * one segment, one price" and "reject anything that unexpectedly crosses a
 * segment boundary (a single Unicode character can do it)".
 *
 * Known simplification: UCS-2 character counting here counts UTF-16 code
 * units, not Unicode codepoints — a character outside the Basic
 * Multilingual Plane (e.g. most emoji) would be a surrogate pair and count
 * as 2 here, which happens to match how real SMS UCS-2 encoding counts it
 * too (each 16-bit unit is one encoded unit), so this isn't a bug, but it's
 * not full grapheme-aware counting either. Good enough for the plain-text
 * English/Pijin templates this system sends; flagging in case anyone
 * extends this to arbitrary user-supplied text.
 */

const GSM_7_BASIC_CHARS = new Set(
  "@£$¥èéùìòÇ\nØø\rÅå" +
    "Δ_ΦΓΛΩΠΨΣΘΞ" + // no entry for ESC (0x1B) here — that's the extension-table escape, not a printable character
    "ÆæßÉ" +
    " !\"#¤%&'()*+,-./" +
    "0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNO" +
    "PQRSTUVWXYZÄÖÑÜ§" +
    "¿abcdefghijklmno" +
    "pqrstuvwxyzäöñüà",
);

/** Each of these costs 2 septets in GSM-7 (an escape byte plus the character byte). */
const GSM_7_EXTENDED_CHARS = new Set("|^€{}[]~\\\f");

export const Encoding = Object.freeze({
  GSM_7: "GSM_7",
  UCS_2: "UCS_2",
});

/**
 * @param {string} text
 * @returns {string} one of Encoding's values
 */
export function detectEncoding(text) {
  for (const char of text) {
    if (!GSM_7_BASIC_CHARS.has(char) && !GSM_7_EXTENDED_CHARS.has(char)) {
      return Encoding.UCS_2;
    }
  }
  return Encoding.GSM_7;
}

/** GSM-7 septet count — basic chars cost 1, extension-table chars cost 2. */
function gsm7Length(text) {
  let length = 0;
  for (const char of text) {
    length += GSM_7_EXTENDED_CHARS.has(char) ? 2 : 1;
  }
  return length;
}

const SEGMENT_LIMITS = {
  [Encoding.GSM_7]: { single: 160, multipart: 153 },
  [Encoding.UCS_2]: { single: 70, multipart: 67 },
};

/**
 * @param {string} text
 * @param {string} [encoding] Pass a pre-computed value from detectEncoding to avoid rescanning; otherwise it's detected here.
 * @returns {{ encoding: string, characterCount: number, segments: number }}
 */
export function computeSegments(text, encoding = detectEncoding(text)) {
  // UCS-2 count = text.length (UTF-16 code units) — see the module comment
  // on why that's the right unit here, not a codepoint count.
  const characterCount = encoding === Encoding.GSM_7 ? gsm7Length(text) : text.length;
  const limits = SEGMENT_LIMITS[encoding];

  const segments = characterCount <= limits.single ? 1 : Math.ceil(characterCount / limits.multipart);

  return { encoding, characterCount, segments };
}
