import { generateKeyPairSync } from "node:crypto";
import { SignedXml } from "xml-crypto";

/**
 * Generates a fresh RSA keypair for signing test fixtures. Deliberately not
 * a certificate (no X.509 wrapping) — verifyCapSignature() accepts a plain
 * public key PEM just as well (xml-crypto's own README: "the certificate
 * or public key to verify with"), and a bare keypair is simpler to
 * generate correctly in a test than a self-signed cert, with no loss of
 * coverage for what's being tested here (the verification logic, not
 * certificate parsing).
 */
export function generateTestKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

/**
 * Signs a CAP-shaped XML string with a real, standard XML-DSig enveloped
 * signature (Exclusive C14N, RSA-SHA256, SHA-256 digest) — the same
 * algorithms the live SIMS/Alert Hub feed's own payloads declare, produced
 * correctly here via xml-crypto's signing API rather than by hand.
 *
 * @param {string} xml
 * @param {string} privateKeyPem
 * @returns {string} The signed XML, with a <Signature> element appended inside the root.
 */
export function signCapXml(xml, privateKeyPem) {
  const signer = new SignedXml({
    privateKey: privateKeyPem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: "/*",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  signer.computeSignature(xml);
  return signer.getSignedXml();
}

/** A CAP-shaped body — real element names/structure, fabricated content — to sign in tests. */
export const TEST_CAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <cap:identifier>urn:oid:test.signature.1</cap:identifier>
  <cap:sender>forecast@met.gov.sb</cap:sender>
  <cap:sent>2026-09-22T08:00:00+11:00</cap:sent>
  <cap:status>Actual</cap:status>
  <cap:msgType>Alert</cap:msgType>
  <cap:scope>Public</cap:scope>
  <cap:info>
    <cap:event>Strong Wind</cap:event>
    <cap:urgency>Immediate</cap:urgency>
    <cap:severity>Severe</cap:severity>
    <cap:certainty>Likely</cap:certainty>
    <cap:expires>2026-09-23T08:00:00+11:00</cap:expires>
    <cap:headline>Test Warning</cap:headline>
    <cap:instruction>Move to higher ground.</cap:instruction>
    <cap:area>
      <cap:areaDesc>Test area</cap:areaDesc>
    </cap:area>
  </cap:info>
</cap:alert>`;
