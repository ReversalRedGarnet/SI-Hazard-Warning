import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import { SignedXml } from "xml-crypto";

/**
 * CAP XML-DSig verification (audit finding H3, docs/AUDIT_2026-09-22.md).
 * Real, audited-library-based verification (xml-crypto) — no hand-rolled
 * canonicalization or RSA. See src/ingestion/SIMSCAPAdapter.js's own module
 * comment for what was found investigating the *live* feed's actual
 * signatures and why this is wired in as an opt-in, not a default-on gate.
 *
 * Deliberately requires a caller-supplied `trustedCertPem` — a certificate
 * or public key obtained through some channel this module doesn't control —
 * and never falls back to whatever certificate happens to be embedded in
 * the payload's own `<KeyInfo>`. Trusting an embedded cert would let a
 * forged payload simply carry its own "valid" self-signed certificate and
 * pass verification against itself; `getCertFromKeyInfo: () => null` below
 * is what forces xml-crypto to use only the pinned `trustedCertPem`,
 * never the embedded one.
 */

const DSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
const SIGNATURE_XPATH = `//*[local-name(.)='Signature' and namespace-uri(.)='${DSIG_NAMESPACE}']`;

export const CapSignatureStatus = Object.freeze({
  /** Verifies against the supplied trustedCertPem. */
  VALID: "VALID",
  /** No ds:Signature element present in the document at all. */
  MISSING: "MISSING",
  /** A Signature element is present but doesn't verify (tampered, wrong key, malformed, or unparseable XML). */
  INVALID: "INVALID",
});

/**
 * @param {string} xml Raw CAP XML, exactly as fetched (verification must run against the untouched payload).
 * @param {{ trustedCertPem: string }} options `trustedCertPem` is required — see module comment on why there's no embedded-cert fallback.
 * @returns {{ status: string, reason: string|null }}
 */
export function verifyCapSignature(xml, { trustedCertPem }) {
  if (!trustedCertPem) {
    throw new Error(
      "verifyCapSignature requires trustedCertPem — verifying against a payload's own embedded certificate " +
        "would let a forged payload carry its own valid signature (see module comment)",
    );
  }

  let doc;
  try {
    // A silent onError: xmldom's own default logs every warning/error to
    // the console, which would spam real operational logs (and test
    // output) every time a malformed payload is checked. A fatalError
    // still throws regardless of onError — that's what the catch below
    // relies on — only the console noise is suppressed.
    doc = new DOMParser({ onError: () => {} }).parseFromString(xml, "text/xml");
  } catch (err) {
    return { status: CapSignatureStatus.INVALID, reason: `XML did not parse: ${err.message}` };
  }

  const signatureNode = xpath.select1(SIGNATURE_XPATH, doc);
  if (!signatureNode) {
    return { status: CapSignatureStatus.MISSING, reason: "No XML-DSig Signature element present" };
  }

  const verifier = new SignedXml({ publicCert: trustedCertPem, getCertFromKeyInfo: () => null });

  try {
    verifier.loadSignature(signatureNode);
  } catch (err) {
    return { status: CapSignatureStatus.INVALID, reason: `Could not load Signature element: ${err.message}` };
  }

  let verified;
  try {
    verified = verifier.checkSignature(xml);
  } catch (err) {
    // checkSignature() throws (rather than returning false) specifically
    // when the SignatureValue itself is wrong against an otherwise-valid
    // SignedInfo — still an invalid signature, not a code error.
    return { status: CapSignatureStatus.INVALID, reason: err.message };
  }

  if (!verified) {
    return {
      status: CapSignatureStatus.INVALID,
      reason: verifier.validationErrors?.join("; ") || "Signature did not verify (reference digest mismatch)",
    };
  }

  return { status: CapSignatureStatus.VALID, reason: null };
}
